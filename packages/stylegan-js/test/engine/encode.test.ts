// The streamed e4e encoder on the real 108 shards (fm-qjcs): onnxruntime-web's WASM backend in Node, one
// thread, through a verifying local reader over the acquired runtime's encoder-stream directory. The W+ of the
// qualification cases must be within their threshold (0.0001) of the native references; a missing or corrupt
// shard is a planted copy (one link removed, one file rewritten), not a fake. fetch is replaced by a thrower
// for every encode, so any network attempt fails the test. FACEMORPH_FULL_QUALIFY=1 runs all five cases.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test, { after } from 'node:test';
import * as onnx from 'onnxruntime-web';
import { MEMORY_BOUNDS } from '../../src/contracts/capability.ts';
import type { EncodeRequest } from '../../src/contracts/operations.ts';
import type { StageTimingEvent } from '../../src/contracts/timing.ts';
import { WorkerMessageError } from '../../src/contracts/worker-messages.ts';
import {
  admitEncoderManifest,
  EncoderUnavailable,
  EncoderUnsupported,
  loadStreamedEncoder,
  maxWPlusError,
  type EncoderOrt,
  type EncoderStreamManifest,
} from '../../src/engine/encode.ts';
import { floats } from '../../src/engine/reader.ts';
import { acquiredManifest, pathOf, RUNTIME, runtimeReader, UNTESTED } from './support/runtime.ts';

const runtime = acquiredManifest();
const stream = runtime?.manifest['encoderStream'] as { url: string } | undefined;
const DIR = stream ? join(RUNTIME, stream.url.split('/runtime/')[1]!, '..') : '';
const SKIP = !runtime || !existsSync(join(DIR, 'manifest.json')) ? UNTESTED : false;
const manifest = (): EncoderStreamManifest =>
  JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));

onnx.env.wasm.numThreads = 1;
const ort = onnx as unknown as EncoderOrt;

function request(input: Float32Array, n = 1): EncodeRequest {
  const bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  return {
    ids: { requestId: `encode-${n}`, inputRevision: n, attemptId: 0 },
    input: {
      tensor: input,
      tensorDigest: createHash('sha256').update(bytes).digest('hex'),
      policyVersion: 'crop-preprocessing-v1',
    },
    confirmedCropId: 'c'.repeat(64),
  };
}
const caseInput = (m: EncoderStreamManifest, i: number) =>
  new Float32Array(floats(readFileSync(pathOf(m.canaries[i]!.input, RUNTIME))).slice());
const caseFile = (asset: { url?: string }) => join(DIR, asset.url!.split('/').at(-1)!);

/** Runs `fn` with fetch replaced by a thrower: an encode may read only verified local bytes. */
async function offline<T>(fn: () => Promise<T>): Promise<{ value: T; fetches: number }> {
  const original = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (() => {
    fetches++;
    return Promise.reject(Error('encode must not fetch'));
  }) as typeof fetch;
  try {
    return { value: await fn(), fetches };
  } finally {
    globalThis.fetch = original;
  }
}

/**
 * A planted runtime root holding a copy of the shard directory at its manifest path: links to every file,
 * then `edit` removes or rewrites one. Returns the root a reader resolves the shard URLs against.
 */
const planted: string[] = [];
after(() => {
  for (const dir of planted) rmSync(dir, { recursive: true, force: true });
});
function plant(edit: (dir: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'encoder-plant-'));
  planted.push(root);
  const dir = join(root, relative(RUNTIME, DIR));
  mkdirSync(dir, { recursive: true });
  for (const name of readdirSync(DIR)) symlinkSync(join(DIR, name), join(dir, name));
  edit(dir);
  return root;
}

test(
  'the descriptor is admitted only as the qualified 108-shard unshared schedule',
  { skip: SKIP },
  () => {
    const m = manifest();
    assert.equal(admitEncoderManifest(m).steps.length, 108);
    const refused = (change: (x: Record<string, unknown>) => void) => {
      const x = structuredClone(m) as unknown as Record<string, unknown>;
      change(x);
      try {
        admitEncoderManifest(x);
        return null;
      } catch (error) {
        assert.ok(error instanceof EncoderUnsupported);
        return error.field;
      }
    };
    assert.equal(
      refused((x) => (x['kind'] = 'other')),
      'kind',
    );
    assert.equal(
      refused((x) => (x['sourceEncoderSha256'] = '0'.repeat(64))),
      'sourceEncoderSha256',
    );
    assert.equal(
      refused((x) => (x['maxShardBytes'] = 64 * 1024 * 1024)),
      'maxShardBytes',
    );
    assert.equal(
      refused((x) => (x['steps'] = (x['steps'] as unknown[]).slice(1))),
      'steps',
    );
    assert.equal(
      refused((x) => ((x['runtime'] as Record<string, unknown>)['unshared'] = false)),
      'runtime',
    );
  },
);

test(
  'real e4e: W+ within 0.0001 of the native references, one live session, no fetch, timing hooks',
  { skip: SKIP, timeout: 1_800_000 },
  async (t) => {
    const m = manifest();
    const cases = process.env['FACEMORPH_FULL_QUALIFY'] === '1' ? m.canaries.length : 1;
    const reads: string[] = [];
    const encoder = loadStreamedEncoder({
      manifest: m,
      reader: runtimeReader(RUNTIME, reads),
      ort,
    });
    for (let i = 0; i < cases; i++) {
      const c = m.canaries[i]!;
      const timings: StageTimingEvent[] = [];
      const { value: out, fetches } = await offline(() =>
        encoder.encode(request(caseInput(m, i), i + 1), undefined, (e) => timings.push(e)),
      );
      const error = maxWPlusError(out.wPlus.values, readFileSync(caseFile(c.reference)));
      t.diagnostic(
        `${c.id}: max |W+ error| ${error.toExponential(2)} (threshold ${c.threshold}); read ${Math.round(out.timings.verifiedReadMs)} ms, create ${Math.round(out.timings.sessionCreateMs)} ms, run ${Math.round(out.timings.runMs)} ms, total ${Math.round(out.timings.totalMs)} ms`,
      );
      assert.ok(error <= c.threshold && c.threshold === 0.0001, `${c.id}: ${error}`);
      assert.equal(fetches, 0);
      assert.deepEqual(out.wPlus.shape, [18, 512]);
      assert.equal(out.provider, 'cpu');
      assert.equal(out.timings.maxLiveSessions, MEMORY_BOUNDS.maxLiveEncoderSessions);
      assert.equal(timings.filter((e) => e.stage === 'encoder-session-create').length, 108);
      assert.equal(timings.filter((e) => e.stage === 'encoder-run').length, 108);
      assert.ok(timings.every((e) => e.operation === 'encode' && e.completedAtMs >= e.startedAtMs));
    }
    const shards = new Set(m.steps.map((s) => s.sha256));
    assert.equal(
      reads.filter((r) => shards.has(r)).length,
      108 * cases,
      'each shard read once per encode',
    );
    assert.deepEqual([encoder.inspect().liveSessions, encoder.inspect().maxLiveSessions], [0, 1]);
    assert.equal(encoder.inspect().sessionsCreated, encoder.inspect().sessionsReleased);
    await encoder.dispose();
    await assert.rejects(
      encoder.encode(request(caseInput(m, 0))),
      (e: unknown) => e instanceof EncoderUnavailable && e.kind === 'disposed',
    );
  },
);

test(
  'a missing or corrupt shard after admission settles typed, releases, and never fetches',
  { skip: SKIP, timeout: 600_000 },
  async () => {
    const m = manifest();
    const missing = m.steps[5]!,
      corrupt = m.steps[3]!;
    for (const [code, dir] of [
      ['cache-miss', plant((d) => rmSync(join(d, missing.file)))],
      [
        'corrupt',
        plant((d) => {
          const bytes = readFileSync(join(DIR, corrupt.file));
          bytes[bytes.length >> 1] = (bytes[bytes.length >> 1] ?? 0) ^ 0xff;
          rmSync(join(d, corrupt.file));
          writeFileSync(join(d, corrupt.file), bytes);
        }),
      ],
    ] as const) {
      const encoder = loadStreamedEncoder({ manifest: m, reader: runtimeReader(dir), ort });
      const { value: error, fetches } = await offline(() =>
        encoder.encode(request(caseInput(m, 0))).then(
          () => null,
          (e: unknown) => e,
        ),
      );
      assert.ok(error instanceof EncoderUnavailable, String(error));
      assert.deepEqual([error.kind, error.code], ['local-asset', code]);
      assert.equal(fetches, 0);
      const s = encoder.inspect();
      assert.deepEqual(
        [s.liveSessions, s.running, s.sessionsCreated === s.sessionsReleased],
        [0, false, true],
      );
      await encoder.dispose();
    }
  },
);

test(
  'cancel between sessions settles within one step and releases; dispose mid-encode settles disposed',
  { skip: SKIP, timeout: 600_000 },
  async () => {
    const m = manifest();
    for (const how of ['abort-signal', 'abort()', 'dispose()'] as const) {
      const encoder = loadStreamedEncoder({ manifest: m, reader: runtimeReader(RUNTIME), ort });
      const controller = new AbortController();
      let runs = 0,
        stoppedAt = 0,
        stepMs = 0;
      const pending = encoder
        .encode(request(caseInput(m, 0)), controller.signal, (e) => {
          if (e.stage !== 'encoder-run') return;
          stepMs = Math.max(stepMs, e.completedAtMs - e.startedAtMs);
          if (++runs !== 4) return;
          stoppedAt = performance.now();
          if (how === 'abort-signal') controller.abort();
          else if (how === 'abort()') encoder.abort();
          else void encoder.dispose();
        })
        .then(
          () => null,
          (e: unknown) => e,
        );
      const error = await pending;
      const settleMs = performance.now() - stoppedAt;
      assert.ok(error instanceof EncoderUnavailable, `${how}: ${String(error)}`);
      assert.equal(error.kind, how === 'dispose()' ? 'disposed' : 'cancelled', how);
      assert.equal(runs, 4, `${how}: no session ran after the cancel`);
      assert.ok(settleMs < 2000 + stepMs, `${how}: settled in ${Math.round(settleMs)} ms`);
      const s = encoder.inspect();
      assert.deepEqual(
        [s.liveSessions, s.running, s.sessionsCreated, s.sessionsReleased],
        [0, false, 4, 4],
        how,
      );
      await encoder.dispose();
    }
  },
);

test('an invalid request is refused before any shard is read', { skip: SKIP }, async () => {
  const reads: string[] = [];
  const encoder = loadStreamedEncoder({
    manifest: manifest(),
    reader: runtimeReader(RUNTIME, reads),
    ort,
  });
  const bad = request(new Float32Array(196608));
  await assert.rejects(
    encoder.encode({ ...bad, input: { ...bad.input, tensor: new Float32Array(10) } }),
    WorkerMessageError,
  );
  await assert.rejects(encoder.encode({ ...bad, confirmedCropId: 'x' }), WorkerMessageError);
  assert.deepEqual(reads, []);
  await encoder.dispose();
});
