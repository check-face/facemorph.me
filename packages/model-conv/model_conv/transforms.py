"""ONNX graph transforms that turn the exported synthesis into the candidate's shipped synthesis-spatial graph.

Ported from facemorph.me-classic at a42829b (paths and digests in PROVENANCE.json); the arithmetic is unchanged,
only the classic workspace paths became arguments:
  simplify             experiment/onnx/simplify_model.py           ORT basic (shape/constant) optimisation
  remove_dead_spatial  experiment/onnx/remove_dead_spatial_ops.py  drop identity Pad/Slice, fold zero Pad into Conv
  precompute_energy    experiment/onnx/precompute_demodulation.py  demodulation weight energy as an FP32 constant
"""
from pathlib import Path

import numpy as np
import onnx
from onnx import helper, numpy_helper


def simplify(source: Path, target: Path) -> dict:
    import onnxruntime as ort
    options = ort.SessionOptions()
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_BASIC
    options.optimized_model_filepath = str(target)
    options.intra_op_num_threads = 4
    ort.InferenceSession(str(source), options, providers=['CPUExecutionProvider'])
    model = onnx.load(target)
    onnx.checker.check_model(model)
    onnx.save(model, target)
    return {'step': 'simplify', 'nodes': len(model.graph.node)}


def remove_dead_spatial(source: Path, target: Path) -> dict:
    m = onnx.shape_inference.infer_shapes(onnx.load(source))
    initial = {v.name: numpy_helper.to_array(v) for v in m.graph.initializer}
    shapes = {v.name: [d.dim_value for d in v.type.tensor_type.shape.dim] for v in list(m.graph.input) + list(m.graph.value_info) + list(m.graph.output)}
    removed, mapping, keep = [], {}, []

    def actual(name):
        while name in mapping:
            name = mapping[name]
        return name

    for n in m.graph.node:
        for i, k in enumerate(n.input):
            n.input[i] = actual(k)
        shape = shapes.get(n.input[0], []) if n.input else []
        identity = False
        if n.op_type == 'Pad' and n.input[1] in initial and np.all(initial[n.input[1]] == 0):
            identity = True
        if n.op_type == 'Slice' and len(n.input) >= 3 and all(k in initial for k in n.input[1:] if k) and shape and all(shape):
            start = initial[n.input[1]].ravel()
            end = initial[n.input[2]].ravel()
            axes = initial[n.input[3]].ravel() if len(n.input) > 3 and n.input[3] else np.arange(len(start))
            steps = initial[n.input[4]].ravel() if len(n.input) > 4 and n.input[4] else np.ones(len(start), dtype=np.int64)
            identity = all(slice(int(a), int(b), int(st)).indices(shape[int(ax)]) == (0, shape[int(ax)], 1) for a, b, ax, st in zip(start, end, axes, steps))
        if identity:
            mapping[n.output[0]] = n.input[0]
            removed.append({'name': n.name, 'op': n.op_type, 'input_shape': shape})
            shapes[n.output[0]] = shape
        else:
            keep.append(n)
    for n in keep:
        for i, k in enumerate(n.input):
            n.input[i] = actual(k)
    # Fold an explicit spatial constant-zero Pad into its sole Conv consumer.
    uses = {}
    for n in keep:
        for k in n.input:
            uses.setdefault(k, []).append(n)
    folded, filtered = [], []
    for n in keep:
        targets = uses.get(n.output[0], [])
        if n.op_type == 'Pad' and len(targets) == 1 and targets[0].op_type == 'Conv':
            pads = initial.get(n.input[1])
            value = initial.get(n.input[2], np.array(0)) if len(n.input) > 2 and n.input[2] else np.array(0)
            attrs = {a.name: helper.get_attribute_value(a) for a in n.attribute}
            if pads is not None and len(pads) == 8 and all(pads[[0, 1, 4, 5]] == 0) and np.all(value == 0) and attrs.get('mode', b'constant') == b'constant':
                conv = targets[0]
                ca = {a.name: helper.get_attribute_value(a) for a in conv.attribute}
                new = (np.array(ca.get('pads', [0, 0, 0, 0])) + pads[[2, 3, 6, 7]]).tolist()
                conv.input[0] = n.input[0]
                retained = [a for a in conv.attribute if a.name not in ['pads', 'auto_pad']]
                del conv.attribute[:]
                conv.attribute.extend(retained)
                conv.attribute.append(helper.make_attribute('pads', new))
                folded.append({'pad': n.name, 'conv': conv.name, 'pads': new})
                continue
        filtered.append(n)
    for out in m.graph.output:
        if out.name in mapping:
            filtered.append(helper.make_node('Identity', [actual(out.name)], [out.name]))
    del m.graph.node[:]
    m.graph.node.extend(filtered)
    onnx.checker.check_model(m)
    onnx.save(m, target)
    return {'step': 'remove_dead_spatial', 'nodes': len(filtered), 'removed_identity_ops': len(removed), 'folded_pads': len(folded), 'weights_changed': False}


def precompute_energy(source: Path, target: Path) -> dict:
    m = onnx.load(source)
    constants = {i.name: numpy_helper.to_array(i) for i in m.graph.initializer}
    producer = {k: n for n in m.graph.node for k in n.output}
    nodes, records = [], []
    for n in m.graph.node:
        if n.op_type != 'ReduceSum':
            nodes.append(n)
            continue
        square = producer[n.input[0]]
        assert square.op_type == 'Mul' and square.input[0] == square.input[1]
        modulation = producer[square.input[0]]
        assert modulation.op_type == 'Mul'
        const = next(k for k in modulation.input if k in constants)
        weight = constants[const]
        assert weight.ndim == 5 and weight.shape[0] == 1 and weight.dtype == np.float32
        reshape = producer[next(k for k in modulation.input if k != const)]
        assert reshape.op_type == 'Reshape'
        style = reshape.input[0]
        attrs = {a.name: helper.get_attribute_value(a) for a in n.attribute}
        axes = attrs.get('axes', constants.get(n.input[1]) if len(n.input) > 1 else None)
        assert list(axes) == [2, 3, 4] and attrs.get('keepdims', 1) == 0
        energy = (weight[0].astype(np.float64) ** 2).sum(axis=(2, 3)).T.astype(np.float32)
        name = n.name + '__energy'
        squared, matrix = name + '_style_squared', name + '_matrix'
        m.graph.initializer.append(numpy_helper.from_array(energy, matrix))
        nodes.extend([helper.make_node('Mul', [style, style], [squared], name=name + '_square'),
                      helper.make_node('MatMul', [squared, matrix], list(n.output), name=name + '_matmul')])
        records.append({'node': n.name, 'original_weight_shape': list(weight.shape), 'energy_shape': list(energy.shape)})
    needed = {o.name for o in m.graph.output}
    kept = []
    for n in reversed(nodes):
        if needed.intersection(n.output):
            kept.append(n)
            needed.update(n.input)
    kept.reverse()
    del m.graph.node[:]
    m.graph.node.extend(kept)
    initial = [i for i in m.graph.initializer if i.name in needed]
    del m.graph.initializer[:]
    m.graph.initializer.extend(initial)
    del m.graph.value_info[:]
    onnx.checker.check_model(m)
    onnx.save(m, target)
    return {'step': 'precompute_energy', 'nodes': len(kept), 'rewrites': len(records), 'precision': 'energy in FP64, rounded to FP32; FP32 runtime; changed reduction order'}
