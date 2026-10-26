// fm-vbj7: the operation trace comparator. Concrete request, attempt and job IDs are mapped to symbols in
// order of first appearance (R1, A1, J1, ...), and so are face slots (S1, ...), whose IDs can be random;
// a provider context keeps its route but not the runtime digest. Two runs compare by structure; there are
// no timestamps.
// A mismatch names the first divergent event.

export type TraceEvent = Record<string, unknown> & { readonly type: string };

export function normalizeTrace(events: readonly TraceEvent[]): TraceEvent[] {
  const maps = {
    requestId: new Map<string, string>(),
    attemptId: new Map<string, string>(),
    jobId: new Map<string, string>(),
  };
  const prefix = { requestId: 'R', attemptId: 'A', jobId: 'J' } as const;
  const slots = new Map<string, string>();
  const slot = (value: string) => {
    if (!slots.has(value)) slots.set(value, `S${slots.size + 1}`);
    return slots.get(value)!;
  };
  return events.map((event) => {
    const out: Record<string, unknown> = { ...event };
    if (Array.isArray(event['inputs']))
      out['inputs'] = (event['inputs'] as Record<string, unknown>[]).map((input) =>
        typeof input['slot'] === 'string' ? { ...input, slot: slot(input['slot']) } : input,
      );
    if (typeof event['context'] === 'string')
      out['context'] = event['context'].replace(/:[0-9a-f]{64}$/, ':runtime');
    for (const key of Object.keys(maps) as (keyof typeof maps)[]) {
      const value = event[key];
      if (typeof value !== 'string') continue;
      const map = maps[key];
      if (!map.has(value)) map.set(value, `${prefix[key]}${map.size + 1}`);
      out[key] = map.get(value);
    }
    return out as TraceEvent;
  });
}

export type TraceComparison =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly index: number;
      readonly expected: TraceEvent | undefined;
      readonly actual: TraceEvent | undefined;
      readonly message: string;
    };

export function compareTraces(
  expected: readonly TraceEvent[],
  actual: readonly TraceEvent[],
): TraceComparison {
  const a = normalizeTrace(expected);
  const b = normalizeTrace(actual);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i] === undefined ? undefined : JSON.stringify(a[i]);
    const right = b[i] === undefined ? undefined : JSON.stringify(b[i]);
    if (left !== right)
      return {
        ok: false,
        index: i,
        expected: a[i],
        actual: b[i],
        message: `first divergent event at #${i}: expected ${left ?? '(end of trace)'}, got ${right ?? '(end of trace)'}`,
      };
  }
  return { ok: true };
}
