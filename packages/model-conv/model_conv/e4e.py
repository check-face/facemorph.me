"""e4e photo encoder: official checkpoint -> encoder.onnx and the bounded sequential "encoder stream".

Ported from classic (PROVENANCE.json): self-host/encoder.py (loading semantics), experiment/onnx/e4e_export.py
(the ONNX export) and photo-runtime/encoder-stream/export.py (the partitioning). The stream splits the unchanged
FP32 ONNX DAG into many small sessions, each owning at most `stream_max_initializer_mib` of initializers, with every
tensor that crosses a partition an explicit input/output, so a browser holds one small session at a time.
Nothing is rewritten, no weight is requantised and the latent average is added once, inside the exported graph.

The partitioning and liveness rules are pure functions over plain lists so they are tested by calling them.
Output is complete only when manifest.json exists (the staging rule of convert.py). The checkpoint is a
pickle: it is loaded only after its size and SHA-256 match the declaration.
"""
import gc
import hashlib
import json
import math
import os
import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace

from .manifest import HEX64, sha256

SCHEMA = 'facemorph-model-conv-encoder-v1'
STREAM_KIND = 'e4e-onnx-sequential-shards-v1'
STREAM_PRODUCER = 'checkface-e4e-graph-stream-v1'
INPUT_SHAPE, OUTPUT_SHAPE = [1, 3, 256, 256], [1, 18, 512]
HOSTED_ENCODER_SHA256 = 'd525a985a43e4d49ef4590a8b8cc6f487992065bee00014fe8c6f8ab4ac291b1'
HOSTED_ENCODER_BYTES = 1068862265
HOSTED_STREAM_MANIFEST_SHA256 = '3d27df84fd1bb14c777652edf80c9c6788541cb3b02ac7a31d1d19fb651a60bf'
HOSTED_STREAM_MANIFEST_URL = 'https://next.facemorph.me/runtime/encoder-stream/417811d879ac9ef5a8714f38a453571d86e7168047e3d22b7d809b74905bf468/manifest.json'
BYTE_WIDTHS = {'FLOAT': 4, 'DOUBLE': 8, 'FLOAT16': 2, 'INT64': 8, 'INT32': 4, 'BOOL': 1, 'UINT8': 1, 'INT8': 1}


@dataclass(frozen=True)
class EncoderDeclaration:
    key: str
    architecture: str
    source_sha256: str
    source_bytes: int
    source_url: str
    source_terms: str
    licence: str
    opset: int
    w_plus_tolerance: float        # frozen; never widened to admit a result
    stream_max_initializer_mib: int


E4E_FFHQ_ENCODE = EncoderDeclaration(
    key='e4e-ffhq-encode',
    architecture='Encoder4Editing, 50 layers, ir_se, FFHQ 1024 px W+ (pSp encoder, 256 px input)',
    source_sha256='2ace1d9a8c05c10a399bcd500b8dda118f759ff1aac89dbdab7435f2136a0999',
    source_bytes=1201649680,
    source_url='https://github.com/omertov/encoder4editing (README links the e4e_ffhq_encode.pt Google Drive file; no stable direct URL)',
    source_terms='Code MIT (omertov/encoder4editing). Model trained on FFHQ (CC BY-NC-SA 4.0). Never bundled or redistributed here.',
    licence='MIT code; weights trained on FFHQ, CC BY-NC-SA 4.0',
    opset=17, w_plus_tolerance=0.0001, stream_max_initializer_mib=16)

ENCODERS = {E4E_FFHQ_ENCODE.key: E4E_FFHQ_ENCODE}


def encoder_declaration(key: str) -> EncoderDeclaration:
    if key not in ENCODERS:
        raise KeyError(f'unknown encoder {key!r}; declared: {", ".join(ENCODERS)}')
    return ENCODERS[key]


# ---- pure logic: partitioning and liveness (the classic rule, unchanged) -------------------------------------

def plan_groups(node_inputs: list[list[str]], sizes: dict[str, int], cap: int) -> list[list[int]]:
    """Consecutive node groups. A group owns each initializer once; a node that would take the owned bytes past
    `cap` opens the next group, which then owns the initializers that node reads. `sizes` maps initializer name -> bytes."""
    groups, group, owned, size = [], [], set(), 0
    for i, inputs in enumerate(node_inputs):
        new = {n for n in inputs if n in sizes and n not in owned}
        extra = sum(sizes[n] for n in new)
        if group and size + extra > cap:
            groups.append(group)
            group, owned, size = [], set(), 0
            new = {n for n in inputs if n in sizes}
            extra = sum(sizes[n] for n in new)
        group.append(i)
        owned.update(new)
        size += extra
    if group:
        groups.append(group)
    return groups


def consumers_of(node_inputs: list[list[str]], graph_outputs) -> dict[str, list[int]]:
    """Node indexes reading each tensor; a graph output is read by a virtual node after the last."""
    consumers = {}
    for i, inputs in enumerate(node_inputs):
        for name in inputs:
            if name:
                consumers.setdefault(name, []).append(i)
    for name in graph_outputs:
        consumers.setdefault(name, []).append(len(node_inputs))
    return consumers


def group_boundary(indexes: list[int], node_inputs: list[list[str]], node_outputs: list[list[str]], sizes: dict, consumers: dict):
    """(inputs, outputs, weights) of one group: inputs come from outside it, outputs are read after it."""
    last = indexes[-1]
    internal = {n for i in indexes for n in node_outputs[i] if n}
    weights = {n for i in indexes for n in node_inputs[i] if n in sizes}
    inputs = sorted({n for i in indexes for n in node_inputs[i] if n and n not in internal and n not in weights})
    outputs = sorted(n for n in internal if any(j > last for j in consumers.get(n, [])))
    return inputs, outputs, sorted(weights)


def tensor_bytes(spec: dict) -> int:
    if spec['dtype'] not in BYTE_WIDTHS:
        raise ValueError('Unaccounted type ' + spec['dtype'])
    return math.prod(spec['shape']) * BYTE_WIDTHS[spec['dtype']]


def liveness(steps: list[dict], input_specs: list[dict], graph_outputs, last_use: dict) -> int:
    """Fills liveBoundaryBytes* and releaseAfter on each step in place; returns the largest live boundary in bytes."""
    live = {v['name']: v for v in input_specs}
    maximum = 0
    for step in steps:
        for v in step['outputs']:
            live[v['name']] = v
        step['liveBoundaryBytesBeforeRelease'] = sum(tensor_bytes(v) for v in live.values())
        maximum = max(maximum, step['liveBoundaryBytesBeforeRelease'])
        step['releaseAfter'] = [n for n in live if last_use.get(n, -1) <= step['id'] and n not in graph_outputs]
        for n in step['releaseAfter']:
            del live[n]
        step['liveBoundaryBytesAfterRelease'] = sum(tensor_bytes(v) for v in live.values())
    return maximum


def file_digest(path: Path) -> str:
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def stream_problems(stream: dict, directory: Path) -> list[str]:
    """Everything wrong with a stream manifest against the files beside it; empty means consistent."""
    out = []
    if stream.get('kind') != STREAM_KIND:
        out.append(f'stream kind is not {STREAM_KIND}')
    steps = stream.get('steps', [])
    if not steps or [s.get('id') for s in steps] != list(range(len(steps))):
        out.append('stream steps are missing or not numbered from 0')
    for s in steps:
        p = directory / s.get('file', '')
        if not p.is_file() or p.stat().st_size != s.get('size') or file_digest(p) != s.get('sha256'):
            out.append(f"{s.get('file')}: missing, wrong size or digest mismatch")
    if stream.get('sourceNodeCount') != sum(s.get('sourceNodeCount', 0) for s in steps):
        out.append('stream node counts do not add up to the source graph')
    return out


# ---- checkpoint -------------------------------------------------------------------------------------------

def load_encoder(checkpoint: Path, decl: EncoderDeclaration):
    """(net, latent_avg) from the official checkpoint, with classic self-host/encoder.py semantics: strict
    state dict from the `encoder.` keys; the latent average is returned, to be added once by the caller."""
    import torch
    from .vendor.e4e.models.encoders.psp_encoders import Encoder4Editing
    size = checkpoint.stat().st_size
    if size != decl.source_bytes or file_digest(checkpoint) != decl.source_sha256:
        raise ValueError(f'{checkpoint.name} is not the declared checkpoint ({decl.source_bytes} bytes, SHA-256 {decl.source_sha256}); refusing to unpickle it')
    ck = torch.load(checkpoint, map_location='cpu', weights_only=False)
    opts = SimpleNamespace(**ck['opts'])
    if opts.encoder_type != 'Encoder4Editing' or opts.stylegan_size != 1024:
        raise ValueError('Unexpected encoder architecture')
    net = Encoder4Editing(50, 'ir_se', opts)
    state = {k.removeprefix('encoder.'): v for k, v in ck['state_dict'].items() if k.startswith('encoder.')}
    net.load_state_dict(state, strict=True)
    net.eval().requires_grad_(False)
    average = ck['latent_avg'] if opts.start_from_latent_avg else None
    return net, average


def reference_w(net, average, image):
    """The PyTorch reference W+ for a float32 [1,3,256,256] numpy image, as classic encoder.py computes it."""
    import torch
    with torch.inference_mode():
        codes = net(torch.from_numpy(image))
        if average is not None:
            codes = codes + average.unsqueeze(0)
    return codes.numpy()


# ---- export -----------------------------------------------------------------------------------------------

def export_full(net, average, path: Path, opset: int) -> None:
    """experiment/onnx/e4e_export.py: net(image) + latent_avg, image [1,3,256,256] -> w [1,18,512]."""
    import numpy as np
    import onnx
    import torch

    class ExportEncoder(torch.nn.Module):
        def __init__(self, net, average):
            super().__init__()
            self.net = net
            self.register_buffer('average', average.unsqueeze(0))

        def forward(self, image):
            return self.net(image) + self.average

    x = torch.from_numpy(np.random.RandomState(0).uniform(-1, 1, INPUT_SHAPE).astype('<f4'))
    with torch.inference_mode():
        torch.onnx.export(ExportEncoder(net, average).eval(), (x,), str(path), input_names=['image'], output_names=['w'], opset_version=opset, dynamo=False)
    onnx.checker.check_model(str(path))


def build_stream(source: Path, out: Path, work: Path, *, max_initializer_mib: int, preprocessing_sha256: str | None = None, log=print) -> dict:
    """photo-runtime/encoder-stream/export.py: split `source` into out/part-NNN.onnx and write out/manifest.json."""
    import numpy as np
    import onnx
    import onnxruntime as ort
    from onnx import helper
    if preprocessing_sha256 is not None and not HEX64.match(preprocessing_sha256):
        raise ValueError('Invalid preprocessing identity')
    out.mkdir(parents=True, exist_ok=True)
    source_sha = file_digest(source)
    inferred = work / 'shape-inferred.work.onnx'
    log('inferring static graph boundary types')
    onnx.shape_inference.infer_shapes_path(str(source), str(inferred), check_type=True, strict_mode=True, data_prop=True)
    model = onnx.load(inferred)
    graph = model.graph
    initializers = {t.name: t for t in graph.initializer}
    sizes = {n: t.ByteSize() for n, t in initializers.items()}
    types = {v.name: v for v in list(graph.value_info) + list(graph.input) + list(graph.output)}
    graph_inputs, graph_outputs = {v.name for v in graph.input}, {v.name for v in graph.output}
    nodes = list(graph.node)
    node_inputs, node_outputs = [list(n.input) for n in nodes], [list(n.output) for n in nodes]
    consumers = consumers_of(node_inputs, graph_outputs)
    groups = plan_groups(node_inputs, sizes, max_initializer_mib * 1024 * 1024)
    last_use = {n: 0 for n in graph_inputs}
    observed, steps = {}, []

    def spec(name):
        if name not in types:
            raise ValueError('Missing inferred boundary type ' + name)
        t = types[name].type.tensor_type
        if not t.elem_type:
            raise ValueError('Missing element type ' + name)
        shape = []
        for d in t.shape.dim:
            if not d.HasField('dim_value'):
                if name not in observed:
                    raise ValueError('Boundary lacks inferred or executed shape: ' + name)
                shape = list(observed[name].shape)
                break
            shape.append(d.dim_value)
        return {'name': name, 'dtype': onnx.TensorProto.DataType.Name(t.elem_type), 'shape': shape}

    for v in graph.input:
        s = spec(v.name)
        if s['dtype'] != 'FLOAT':
            raise ValueError('Unexpected source input dtype')
        observed[v.name] = np.zeros(s['shape'], dtype=np.float32)
    for step, indexes in enumerate(groups):
        first, last = indexes[0], indexes[-1]
        inputs, outputs, weights = group_boundary(indexes, node_inputs, node_outputs, sizes, consumers)
        if not outputs:
            raise ValueError('Dead partition')
        for n in inputs:
            last_use[n] = step
        sub = helper.make_graph([nodes[i] for i in indexes], f'e4e-stream-{step:03d}', [types[n] for n in inputs], [types[n] for n in outputs], [initializers[n] for n in weights])
        submodel = helper.make_model(sub, opset_imports=model.opset_import, producer_name=STREAM_PRODUCER)
        submodel.ir_version = model.ir_version
        onnx.checker.check_model(submodel, full_check=True)
        # Shape inference leaves symbolic sizes after the exported Expand/Transpose construction: resolve them by
        # executing each unchanged shard once on the zero-input profile (INT64 shape values preserved).
        o = ort.SessionOptions()
        o.intra_op_num_threads = o.inter_op_num_threads = 1
        o.enable_cpu_mem_arena = o.enable_mem_pattern = False
        o.add_session_config_entry('session.disable_prepacking', '1')
        session = ort.InferenceSession(submodel.SerializeToString(), sess_options=o, providers=['CPUExecutionProvider'])
        values = session.run(outputs, {n: observed[n] for n in inputs})
        for name, value in zip(outputs, values):
            if value.dtype.kind == 'f' and not np.isfinite(value).all():
                raise ValueError('Nonfinite shape-profile output')
            observed[name] = value
            if name in types:
                tensor = types[name].type.tensor_type
                for i, d in enumerate(tensor.shape.dim):
                    if d.HasField('dim_value') and d.dim_value != value.shape[i]:
                        raise ValueError('Inferred shape disagrees with execution')
                del tensor.shape.dim[:]
                for dimension in value.shape:
                    tensor.shape.dim.add().dim_value = dimension
        del session, values
        for v in submodel.graph.input:
            v.CopyFrom(types[v.name])
        for v in submodel.graph.output:
            v.CopyFrom(types[v.name])
        onnx.checker.check_model(submodel, full_check=True)
        name = f'part-{step:03d}.onnx'
        path = out / name
        onnx.save(submodel, path)
        steps.append({'id': step, 'file': name, 'sha256': file_digest(path), 'size': path.stat().st_size, 'sourceNodeFirst': first, 'sourceNodeLast': last,
                      'sourceNodeCount': len(indexes), 'initializerBytes': sum(sizes[n] for n in weights),
                      'inputs': [spec(n) for n in inputs], 'outputs': [spec(n) for n in outputs]})
        for key in list(observed):
            if key not in graph_outputs and not any(j > last for j in consumers.get(key, [])):
                del observed[key]
        del submodel, sub
        gc.collect()
    for name in graph_outputs:
        last_use[name] = len(steps)
    maximum = liveness(steps, [spec(v.name) for v in graph.input], graph_outputs, last_use)
    manifest = {
        'schemaVersion': 1, 'kind': STREAM_KIND, 'sourceSha256': source_sha, 'sourceEncoderSha256': source_sha, 'preprocessingSha256': preprocessing_sha256,
        'boundaryShapeEvidence': 'Native ORT execution with fixed [1,3,256,256] zero input; independent real photo controls required',
        'qualifiedReferenceEvidence': None, 'phoneAdmitted': False, 'sourceBytes': source.stat().st_size,
        'input': [spec(v.name) for v in graph.input], 'output': [spec(v.name) for v in graph.output], 'steps': steps,
        'maxShardBytes': max(s['size'] for s in steps), 'totalShardBytes': sum(s['size'] for s in steps), 'maxLiveBoundaryBytes': maximum,
        'sourceNodeCount': len(nodes), 'exportedNodeCount': sum(s['sourceNodeCount'] for s in steps),
        'precision': 'unchanged FP32 ONNX', 'latentAverage': 'Preserved in original final graph nodes; do not add again',
        'wasmMemoryStatus': 'Unmeasured; one live session required, release does not shrink heap capacity',
        'qualification': 'Not qualified here; verify-encoder judges W+ <=0.0001 against the PyTorch reference, browser/device memory is separate'}
    if manifest['sourceNodeCount'] != manifest['exportedNodeCount']:
        raise RuntimeError('stream drops or duplicates source nodes')
    (out / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    inferred.unlink()  # disposable intermediate, never a source model
    return manifest


def convert_encoder(decl: EncoderDeclaration, checkpoint: Path, out: Path, *, force: bool = False, log=print) -> dict:
    from .convert import STAGING_PREFIX, clear_stale_staging, versions  # convert imports onnx at module level
    out = out.resolve()
    if (out / 'manifest.json').exists() and not force:
        raise FileExistsError(f'{out} already holds a complete conversion; pass --force to rebuild it')
    out.parent.mkdir(parents=True, exist_ok=True)
    for name in clear_stale_staging(out):
        log(f'removed incomplete staging {name}')
    started = time.time()
    staging = out.parent / f'{STAGING_PREFIX}{out.name}-{os.getpid()}'
    work = staging / 'work'
    work.mkdir(parents=True)
    try:
        log('loading the checkpoint (trusted pickles only, after its SHA-256 matches)')
        net, average = load_encoder(checkpoint, decl)
        if average is None:
            raise ValueError('checkpoint has no latent average to add')
        result = staging / 'result'
        (result / 'stream').mkdir(parents=True)
        log('exporting encoder.onnx')
        export_full(net, average, result / 'encoder.onnx', decl.opset)
        del net
        gc.collect()
        log('building the encoder stream')
        stream = build_stream(result / 'encoder.onnx', result / 'stream', work, max_initializer_mib=decl.stream_max_initializer_mib, log=log)
        found = stream_problems(stream, result / 'stream')
        encoder_sha = file_digest(result / 'encoder.onnx')
        if stream['sourceSha256'] != encoder_sha:
            found.append('stream source is not encoder.onnx')
        if found:
            raise RuntimeError('stream inconsistent: ' + '; '.join(found))
        provenance = {
            'checkpoint': {'path': checkpoint.name, 'sha256': decl.source_sha256, 'size': decl.source_bytes, 'url': decl.source_url, 'terms': decl.source_terms},
            'image': os.environ.get('MODEL_CONV_IMAGE', 'unrecorded (not run from the container)'),
            'versions': versions(),
            'flags': {'opset': decl.opset, 'dynamo': False, 'inputShape': INPUT_SHAPE, 'outputShape': OUTPUT_SHAPE, 'latentAverage': 'added once inside the exported graph',
                      'streamMaxInitializerMiB': decl.stream_max_initializer_mib, 'exportTraceInput': 'uniform(-1,1) float32, seed 0'},
            'seconds': round(time.time() - started, 1)}
        manifest = {
            'schemaVersion': 1, 'schema': SCHEMA, 'bundleVersion': f'model-conv-{decl.key}', 'modelSourceSha256': decl.source_sha256,
            'model': {'key': decl.key, 'architecture': decl.architecture, 'opset': decl.opset, 'sourceSha256': decl.source_sha256, 'licence': decl.licence},
            'encoder': {'file': 'encoder.onnx', 'sha256': encoder_sha, 'size': (result / 'encoder.onnx').stat().st_size,
                        'inputs': {'image': INPUT_SHAPE}, 'outputs': {'w': OUTPUT_SHAPE}},
            'stream': {'manifest': 'stream/manifest.json', 'manifestSha256': file_digest(result / 'stream' / 'manifest.json'), 'kind': STREAM_KIND,
                       'sessions': len(stream['steps']), 'maxShardBytes': stream['maxShardBytes'], 'totalShardBytes': stream['totalShardBytes'],
                       'maxInitializerMiB': decl.stream_max_initializer_mib},
            'tolerance': {'wPlus': decl.w_plus_tolerance},
            'provenance': provenance}
        if out.exists():
            shutil.rmtree(out)
        result.rename(out)
        (out / 'manifest.json.tmp').write_text(json.dumps(manifest, indent=2) + '\n')
        (out / 'manifest.json.tmp').rename(out / 'manifest.json')
        return manifest
    finally:
        shutil.rmtree(staging, ignore_errors=True)


# ---- verify -----------------------------------------------------------------------------------------------

def qualification_dir() -> Path:
    env = os.environ.get('MODEL_CONV_E4E_QUALIFICATION')
    return Path(env) if env else Path(__file__).resolve().parents[1] / 'tests' / 'e4e-qualification'


def load_cases(directory: Path) -> list[dict]:
    """Planted qualification inputs: float32 [1,3,256,256] tensors and the recorded classic reference W+."""
    import numpy as np
    report = json.loads((directory / 'report.json').read_text())
    cases = []
    for c in report['cases']:
        raw_in, raw_ref = (directory / c['inputFile']).read_bytes(), (directory / c['referenceFile']).read_bytes()
        if sha256(raw_in) != c['inputSha256'] or sha256(raw_ref) != c['referenceSha256']:
            raise ValueError(f"{c['id']}: qualification input or reference differs from its recorded digest")
        cases.append({'id': c['id'], 'image': np.frombuffer(raw_in, dtype='<f4').reshape(INPUT_SHAPE).copy(),
                      'recorded': np.frombuffer(raw_ref, dtype='<f4').reshape(OUTPUT_SHAPE).copy()})
    return cases


def errors(a, b) -> dict:
    import numpy as np
    d = np.abs(a.astype(np.float64) - b.astype(np.float64))
    return {'max': float(d.max()), 'mean': float(d.mean())}


PRODUCT_PROFILE, DEFAULT_PROFILE = 'product-session-options', 'ort-defaults'


def session_options(profile: str):
    """Product: the options the browser creates every encoder session with (classic photo-runtime/encoder-stream/
    execute.mjs: no CPU arena, no memory pattern, prepacking disabled) and the classic verify.py used, single-threaded.
    Defaults: ORT's own defaults, run as a second, informational profile."""
    import onnxruntime as ort
    o = ort.SessionOptions()
    if profile == PRODUCT_PROFILE:
        o.intra_op_num_threads = o.inter_op_num_threads = 1
        o.enable_cpu_mem_arena = o.enable_mem_pattern = False
        o.add_session_config_entry('session.disable_prepacking', '1')
    else:
        o.intra_op_num_threads = 4
    return o


def run_full(path: Path, cases: list[dict], profile: str) -> list:
    import onnxruntime as ort
    session = ort.InferenceSession(str(path), session_options(profile), providers=['CPUExecutionProvider'])
    got = [session.run(['w'], {'image': c['image']})[0] for c in cases]
    del session
    return got


def run_stream(directory: Path, stream: dict, cases: list[dict], profile: str) -> list:
    """Sequential sessions, one at a time and released after use, exactly the order and releases the manifest declares."""
    import numpy as np
    import onnxruntime as ort
    live = [{s['name']: c['image'] for s in stream['input']} for c in cases]
    for step in stream['steps']:
        session = ort.InferenceSession(str(directory / step['file']), session_options(profile), providers=['CPUExecutionProvider'])
        names = [v['name'] for v in step['outputs']]
        for tensors in live:
            for name, value in zip(names, session.run(names, {v['name']: tensors[v['name']] for v in step['inputs']})):
                tensors[name] = value
        del session
        for tensors in live:
            for name in step['releaseAfter']:
                tensors.pop(name, None)
    final = stream['output'][0]['name']
    return [np.asarray(t[final]) for t in live]


def hosted_stream_manifest(log=print):
    import urllib.request
    try:
        # Cloudflare refuses urllib's default user agent.
        with urllib.request.urlopen(urllib.request.Request(HOSTED_STREAM_MANIFEST_URL, headers={'User-Agent': 'facemorph-model-conv'}), timeout=60) as r:
            data = r.read()
        return json.loads(data), sha256(data)
    except Exception as e:  # network is best effort; the comparison is recorded as unavailable
        log(f'hosted stream manifest unavailable: {e}')
        return None, None


def compare_stream(mine: dict, hosted: dict | None, hosted_sha: str | None) -> dict:
    if hosted is None:
        return {'available': False}
    key = lambda s: [s[k] for k in ('sourceNodeFirst', 'sourceNodeLast', 'sourceNodeCount', 'initializerBytes', 'inputs', 'outputs')]  # noqa: E731
    same = [a['sha256'] == b['sha256'] for a, b in zip(mine['steps'], hosted['steps'])]
    return {'available': True, 'url': HOSTED_STREAM_MANIFEST_URL, 'hostedManifestFileSha256': hosted_sha, 'expectedHostedManifestFileSha256': HOSTED_STREAM_MANIFEST_SHA256,
            'hostedSourceSha256': hosted.get('sourceSha256'), 'sessions': {'mine': len(mine['steps']), 'hosted': len(hosted['steps'])},
            'partitioningIdentical': len(mine['steps']) == len(hosted['steps']) and all(key(a) == key(b) for a, b in zip(mine['steps'], hosted['steps'])),
            'sessionFilesByteIdentical': sum(same), 'sessionFilesCompared': len(same),
            'sourceNodeCount': {'mine': mine['sourceNodeCount'], 'hosted': hosted.get('sourceNodeCount')},
            'differingTopLevelFields': sorted(k for k in set(mine) | set(hosted) if mine.get(k) != hosted.get(k))}


def verify_encoder(checkpoint: Path, out: Path, log=print) -> dict:
    import numpy as np
    from .convert import versions
    manifest = json.loads((out / 'manifest.json').read_text())
    decl = encoder_declaration(manifest['model']['key'])
    problems = []
    enc = manifest['encoder']
    if file_digest(out / enc['file']) != enc['sha256'] or (out / enc['file']).stat().st_size != enc['size']:
        problems.append('encoder.onnx: digest or size mismatch')
    if file_digest(out / manifest['stream']['manifest']) != manifest['stream']['manifestSha256']:
        problems.append('stream manifest: digest mismatch')
    stream = json.loads((out / manifest['stream']['manifest']).read_text())
    problems += stream_problems(stream, out / 'stream')
    if stream.get('sourceSha256') != enc['sha256']:
        problems.append('stream source is not encoder.onnx')
    report = {'model': decl.key, 'descriptor': manifest['model'], 'manifestSha256': sha256((out / 'manifest.json').read_bytes()),
              'tolerance': manifest['tolerance'], 'files': problems or 'all digests match',
              'container': {'image': os.environ.get('MODEL_CONV_IMAGE', 'unrecorded (not run from the container)'), 'baseImage': os.environ.get('MODEL_CONV_BASE_IMAGE', 'unrecorded')},
              'versions': versions(), 'conversionFlags': manifest['provenance'].get('flags'),
              'reference': {'implementation': 'vendored omertov/encoder4editing psp_encoders (model_conv/vendor/e4e) running the original checkpoint in PyTorch',
                            'checkpoint': checkpoint.name, 'checkpointSha256': decl.source_sha256}, 'cases': [], 'sessions': len(stream['steps'])}
    if problems:
        report['passed'] = False
        return report
    cases = load_cases(qualification_dir())
    log('building the PyTorch reference from the original checkpoint')
    net, average = load_encoder(checkpoint, decl)
    refs = [reference_w(net, average, c['image']) for c in cases]
    del net
    tol = decl.w_plus_tolerance
    results = {}
    for profile in (PRODUCT_PROFILE, DEFAULT_PROFILE):
        log(f'[{profile}] running encoder.onnx under ONNX Runtime CPU')
        full = run_full(out / enc['file'], cases, profile)
        log(f"[{profile}] running the {len(stream['steps'])} stream sessions sequentially")
        results[profile] = (full, run_stream(out / 'stream', stream, cases, profile))
    worst = {p: 0.0 for p in results}
    for i, (c, ref) in enumerate(zip(cases, refs)):
        row = {'id': c['id'], 'shape': list(ref.shape), 'referenceVsRecordedClassic': errors(ref, c['recorded']), 'profiles': {}}
        for profile, (full, streamed) in results.items():
            f, s = full[i], streamed[i]
            r = {'finite': bool(np.isfinite(f).all() and np.isfinite(s).all()), 'shape': list(s.shape),
                 'fullVsTorch': errors(f, ref), 'streamVsTorch': errors(s, ref), 'streamVsFull': errors(s, f),
                 'fullVsRecordedClassic': errors(f, c['recorded']), 'streamVsRecordedClassic': errors(s, c['recorded'])}
            r['passed'] = r['finite'] and r['shape'] == OUTPUT_SHAPE and all(r[k]['max'] <= tol for k in ('fullVsTorch', 'streamVsTorch', 'fullVsRecordedClassic', 'streamVsRecordedClassic'))
            worst[profile] = max(worst[profile], *(r[k]['max'] for k in ('fullVsTorch', 'streamVsTorch', 'fullVsRecordedClassic', 'streamVsRecordedClassic')))
            row['profiles'][profile] = r
        row['passed'] = row['profiles'][PRODUCT_PROFILE]['passed']
        log(json.dumps(row))
        report['cases'].append(row)
    hosted, hosted_sha = hosted_stream_manifest(log)
    report['maxWPlusAbsError'] = worst[PRODUCT_PROFILE]
    report['maxWPlusAbsErrorByProfile'] = worst
    report['gate'] = f'{PRODUCT_PROFILE} (the options the browser creates sessions with); {DEFAULT_PROFILE} is reported, not gating'
    report['defaultProfilePassed'] = all(r['profiles'][DEFAULT_PROFILE]['passed'] for r in report['cases'])
    report['hosted'] = {'encoder': {'expectedSha256': HOSTED_ENCODER_SHA256, 'expectedBytes': HOSTED_ENCODER_BYTES, 'mySha256': enc['sha256'], 'myBytes': enc['size'],
                                    'identical': enc['sha256'] == HOSTED_ENCODER_SHA256 and enc['size'] == HOSTED_ENCODER_BYTES},
                        'stream': compare_stream(stream, hosted, hosted_sha)}
    # The conversion is judged as the plan's FFHQ rule says: identical digests to the qualified hosted encoder and
    # stream, or numerical parity within the frozen W+ tolerance. Numerical results are reported either way; a
    # numerical miss on byte-identical files is a property of the hosted artifact on this platform, recorded as
    # a finding for the providers, never a reason to widen the tolerance.
    s = report['hosted']['stream']
    identical = (report['hosted']['encoder']['identical'] and s.get('available') is True
                 and s.get('hostedManifestFileSha256') == HOSTED_STREAM_MANIFEST_SHA256 and s.get('partitioningIdentical') is True
                 and s.get('sessionFilesByteIdentical') == s.get('sessionFilesCompared') == s['sessions']['hosted'])
    numerical = all(r['passed'] for r in report['cases'])
    report['digestsIdenticalToHosted'] = identical
    report['numericalParityPassed'] = numerical
    report['paritySatisfiedBy'] = 'numerical parity' if numerical else 'identical digests to the qualified hosted encoder and stream' if identical else None
    if not numerical:
        failing = [r['id'] for r in report['cases'] if not r['passed']]
        report['finding'] = (f'{", ".join(failing)}: W+ error above {tol} under ONNX Runtime CPU ({PRODUCT_PROFILE}) on this machine'
                             + (' with files byte-identical to the hosted encoder, so the hosted artifact behaves the same here' if identical else ''))
    report['passed'] = numerical or identical
    return report
