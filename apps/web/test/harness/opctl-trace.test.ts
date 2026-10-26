// fm-vbj7: the trace comparator maps IDs consistently, accepts an equal trace and names the first divergence,
// including a deliberately swapped permit/reservation pair in the committed expected trace.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compareTraces, normalizeTrace, type TraceEvent } from './opctl-trace.ts';

const expected = JSON.parse(
  readFileSync(new URL('./opctl-expected-trace.json', import.meta.url), 'utf8'),
) as TraceEvent[];

test('concrete IDs map to symbols in order of first appearance', () => {
  const trace = normalizeTrace([
    { type: 'request', requestId: 'request:7', attemptId: 'attempt:7' },
    { type: 'permit-acquire', jobId: '41' },
    { type: 'settled', requestId: 'request:7', attemptId: 'attempt:7' },
    { type: 'request', requestId: 'request:9', attemptId: 'attempt:9' },
  ]);
  assert.deepEqual(
    trace.map((e) => [e['requestId'], e['attemptId'], e['jobId']]),
    [
      ['R1', 'A1', undefined],
      [undefined, undefined, 'J1'],
      ['R1', 'A1', undefined],
      ['R2', 'A2', undefined],
    ],
  );
});

test('the committed expected trace equals itself, and differently numbered IDs compare equal', () => {
  assert.ok(expected.length > 20, 'the committed trace covers the whole run');
  assert.deepEqual(compareTraces(expected, expected), { ok: true });
  const renumbered = expected.map((event) => {
    const out: Record<string, unknown> = { ...event };
    for (const key of ['requestId', 'attemptId', 'jobId'])
      if (typeof out[key] === 'string') out[key] = `x-${out[key]}`;
    return out as TraceEvent;
  });
  assert.deepEqual(compareTraces(expected, renumbered), { ok: true });
});

test('a deliberately swapped permit/reservation event fails and names the first divergence', () => {
  const index = expected.findIndex((e) => e.type === 'reservation-acquire');
  assert.ok(index >= 0 && expected[index + 1]?.type === 'permit-acquire');
  const swapped = [...expected];
  [swapped[index], swapped[index + 1]] = [swapped[index + 1]!, swapped[index]!];
  const result = compareTraces(expected, swapped);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.index, index);
    assert.match(result.message, /first divergent event at #\d+: expected .*reservation-acquire/);
  }
});

test('a missing settlement is a divergence at the end of the trace', () => {
  const result = compareTraces(expected, expected.slice(0, -1));
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /\(end of trace\)/);
});
