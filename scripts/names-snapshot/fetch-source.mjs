// Fetch one source object, retrying network errors and 5xx. A 404 is final: missing.
export async function fetchSource(
  url,
  { attempts = 3, timeoutMs = 60_000, cache = 'default' } = {},
) {
  let last;
  for (let i = 0; i < attempts; i++) {
    if (i) await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    try {
      const res = await fetch(url, {
        cache,
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'user-agent': 'FaceMorph-names-snapshot/1' },
      });
      if (res.status === 404) return { status: 'missing' };
      if (!res.ok) {
        last = `http ${res.status}`;
        await res.body?.cancel();
        continue;
      }
      return { status: 'ok', bytes: Buffer.from(await res.arrayBuffer()) };
    } catch (e) {
      last =
        e.name === 'TimeoutError'
          ? 'timeout'
          : e.cause?.code
            ? `${e.message} (${e.cause.code})`
            : e.message;
    }
  }
  return { status: 'failed', error: last };
}
