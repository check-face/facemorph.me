// fm-vbj7: the morph progress release gate (operator, 21 September; round-3 R3-03), proved through the
// operation service rather than by regexes over bridge source. While a morph renders its line reads
// "Generating X / Y images" and nothing else: X counts finished frames, never decreases in any order and
// ends at Y; "Encoding" and "Generating images" never appear in it; other stages never write it; MP4
// preparation is reported so the action never ends in silence; the whole-action bar is one monotonic
// fraction per attempt that never resets on a stage change and completes only at the playable MP4.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFrameCounter, morphCounter } from '../Next/stage-labels.mjs';
import { createOperationService } from './bridge-service.ts';
import { fakeBridge, flush, morph, output } from './fake-bridge.ts';
import type { OperationEvent } from './service.ts';

function infill(total: number): number[] {
  const order = [0, total - 1];
  const seen = new Set(order);
  for (let step = total; step > 1; step = Math.ceil(step / 2))
    for (let i = 0; i < total; i += Math.max(1, Math.floor(step / 2)))
      if (!seen.has(i)) {
        seen.add(i);
        order.push(i);
      }
  for (let i = 0; i < total; i++) if (!seen.has(i)) order.push(i);
  return order;
}

/** Drives one real morph through the service; the fake bridge emits what product-bridge emits. */
async function render(total: number, order: readonly number[]) {
  const fake = fakeBridge();
  const service = createOperationService({ bridge: fake.bridge });
  const events: Extract<OperationEvent, { type: 'progress' }>[] = [];
  const all: OperationEvent[] = [];
  const handle = service.requestMorph(morph('a', 'b'));
  service.subscribe((event) => {
    if (event.intent.requestId !== handle.requestId) return;
    all.push(event);
    if (event.type === 'progress') events.push(event);
  });
  await flush();
  // The two prerequisite faces, with their own stages (which the morph line must not speak).
  for (const slot of ['a', 'b']) {
    const execution = fake.executions.at(-1)!;
    assert.equal(execution.request.target, slot);
    fake.progress(execution.request.jobId, 'face', 'Generating this face…', {
      loaded: 0,
      total: 1,
    });
    execution.resolve(output([slot]));
    await flush();
  }
  const job = fake.executions.at(-1)!;
  assert.equal(job.request.action, 'morph');
  const id = job.request.jobId;
  // Acquisition and admission interleave with frames, exactly as the runtime emits them.
  fake.progress(id, 'route-attempt', '', {});
  fake.progress(id, 'route-admitted', 'cpu');
  const counter = createFrameCounter(total);
  const first = counter.start();
  fake.progress(id, 'morph', first.text, { loaded: first.done, total });
  for (const index of order) {
    fake.progress(id, 'synthesis-complete', 'Face generated.', { elapsedMs: 40 });
    fake.progress(id, 'face', 'Encoding your photo…');
    const finished = counter.complete(index);
    fake.progress(id, 'morph', finished.text, { loaded: finished.done, total });
  }
  fake.progress(id, 'export', 'Encoding your video…');
  fake.progress(id, 'export', 'Finishing your video…');
  job.resolve({ ...output(), videoUrl: 'blob:video', projectJson: '{"schemaVersion":1}' });
  const result = await handle.done;
  await service.dispose();
  return { events, all, result };
}

for (const [name, total, order] of [
  ['path order', 26, [...Array(26).keys()]],
  ['infill order', 26, infill(26)],
  ['infill order, 64 frames', 64, infill(64)],
  ['a repeated frame', 4, [0, 3, 3, 1, 2]],
] as const)
  test(`morph line and bar through the operation service: ${name}`, async () => {
    const { events, all, result } = await render(total, order);
    assert.equal(result.status, 'completed');
    // The line: only the frame counter, then MP4 preparation.
    const lines = events.map((e) => e.line).filter((line): line is string => line !== null);
    const counted = lines.filter((line) => line.startsWith('Generating'));
    let previous = -1;
    for (const line of counted) {
      const match = /^Generating (\d+) \/ (\d+) images$/.exec(line);
      assert.ok(match, `the line reads "${line}"`);
      assert.ok(!/\bEncoding\b|Generating images/i.test(line), `banned wording in "${line}"`);
      assert.equal(Number(match[2]), total);
      assert.ok(Number(match[1]) >= previous, `the count went backwards: ${line}`);
      previous = Number(match[1]);
    }
    assert.equal(previous, total, `the count ends at ${previous}, not ${total}`);
    for (const line of lines)
      assert.ok(
        line.startsWith('Generating ') ||
          line === 'Encoding your video…' ||
          line === 'Finishing your video…',
        `a non-morph stage wrote the morph line: "${line}"`,
      );
    assert.ok(
      lines.includes('Finishing your video…'),
      'MP4 preparation is reported, so the morph never ends in silence',
    );
    // The bar: one monotonic fraction per attempt, no reset on any stage change, complete only at the MP4.
    let bar = 0;
    for (const event of events) {
      assert.equal(event.action.attemptId, events[0]!.action.attemptId, 'one attempt');
      if (event.action.fraction === null) continue;
      assert.ok(event.action.fraction >= bar, `the bar went back at ${event.progress.stage}`);
      bar = event.action.fraction;
      assert.equal(event.action.complete, false, 'not complete before the playable MP4');
    }
    const fileReady = all.findIndex((e) => e.type === 'file-ready');
    assert.ok(fileReady > 0, 'the playable MP4 is the completion boundary');
  });

test('the counter wording itself', () => {
  assert.equal(morphCounter(3, 26), 'Generating 3 / 26 images');
});
