// The actual deployed entry/SQLite binding, retained across a real workerd restart.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { Miniflare } from 'miniflare';
const fromMiniflare = createRequire(createRequire(import.meta.url).resolve('miniflare'));
const supported = fromMiniflare('workerd').compatibilityDate;
function runtime(persist) {
  return new Miniflare({
    modules: true,
    scriptPath: fileURLToPath(new URL('./entry.mjs', import.meta.url)),
    modulesRules: [{ type: 'ESModule', include: ['**/*.mjs'], fallthrough: true }],
    compatibilityDate: supported < '2026-09-16' ? supported : '2026-09-16',
    cf: false,
    bindings: { SCRAPE_TOKEN: 'local-test-secret' },
    durableObjects: { COUNTERS: { className: 'StatsCounters', useSQLite: true } },
    durableObjectsPersist: persist,
  });
}
const origin = 'https://next.facemorph.me';
const metric = 'fm_web_visits_total{app="monorepo",host="next",platform="ios",visit="first"}';
async function visit(mf) {
  return mf.dispatchFetch(`${origin}/stats/v1`, {
    method: 'POST',
    headers: { origin, 'sec-fetch-site': 'same-origin', 'user-agent': 'Mozilla/5.0' },
    body: JSON.stringify({
      v: 1,
      app: 'monorepo',
      events: [{ t: 'visit', platform: 'ios', visit: 'first' }],
    }),
  });
}
async function metrics(mf) {
  const result = await mf.dispatchFetch(`${origin}/stats/metrics`, {
    headers: { authorization: 'Bearer local-test-secret' },
  });
  assert.equal(result.status, 200);
  return result.text();
}
test('cf entry serves the existing SQLite class; counters and scrape authorization survive restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fm-stats-worker-'));
  let mf = runtime(dir);
  try {
    assert.equal((await mf.dispatchFetch(`${origin}/stats/metrics`)).status, 401);
    assert.equal((await visit(mf)).status, 204);
    assert.ok((await metrics(mf)).includes(`${metric} 1\n`));
    await mf.dispose();
    mf = runtime(dir);
    assert.ok((await metrics(mf)).includes(`${metric} 1\n`), 'the existing database is retained');
    assert.equal((await visit(mf)).status, 204);
    assert.ok((await metrics(mf)).includes(`${metric} 2\n`));
    assert.equal(
      (
        await mf.dispatchFetch(`${origin}/stats/metrics`, {
          headers: { authorization: 'Bearer wrong' },
        })
      ).status,
      401,
    );
  } finally {
    await mf.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
