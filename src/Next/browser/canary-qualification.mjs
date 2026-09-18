import { Sha256 } from '../Assets/sha256.mjs';
import { decodeReferencePng } from './png.mjs';
import { rgba1024 } from './identity.mjs';

const digestJson = value => { const hash = new Sha256(); hash.update(new TextEncoder().encode(value)); return hash.hex(); };

export const CANARY_RECORD_SCHEMA = 'checkface-canary-qualification-v1';

/** The asset digests a provider bundle carries, ignoring transport URLs and release labels. */
function bundleDigest(bundle) {
  const shas = [];
  const walk = (value, depth) => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.sha256 === 'string') { shas.push(value.sha256); return; }
    if (depth >= 4) return;
    if (Array.isArray(value)) { for (const item of value) walk(item, depth + 1); return; }
    for (const key of Object.keys(value).sort()) walk(value[key], depth + 1);
  };
  walk(bundle, 0);
  return digestJson(shas.join('\n'));
}

function validChecks(checks, canaries) {
  return Array.isArray(checks) && checks.length <= canaries.length && checks.every((c, i) =>
    Boolean(c) && c.passed === true && c.name === canaries[i].name && Number.isFinite(c.maxRgb) && Number.isFinite(c.maxFloat));
}

/**
 * C-03: correctness qualification, keyed by (manifest digest, route, canary set) and persisted
 * per device. A device that passed every canary yesterday on an unchanged bundle has not become
 * numerically different overnight, so a warm qualification runs none; a genuinely cold device
 * pays for exactly one canary to gate admission, and the remaining ones finish after the first
 * face via `runNext`. Every entry of the identity is content: transport URLs and release labels
 * do not change it, but a tampered reference digest changes the key and forces a fresh run whose
 * comparison then fails the route. The gates themselves are fixed: RGB max <= 1, sampled float
 * <= 0.002.
 */
export function createCanaryQualification({ manifest, manifestSha256, provider, bundle, records, acquireBytes, runSynthesis, decodeReference, full = false, forceFail = false }) {
  if (!manifest || !Array.isArray(manifest.canaries) || manifest.canaries.length < 1) throw Error('Canary qualification requires a manifest with canaries');
  if (!manifestSha256 || typeof manifestSha256 !== 'string') throw Error('Canary qualification requires the runtime manifest digest');
  if (!records || typeof acquireBytes !== 'function' || typeof runSynthesis !== 'function') throw Error('Canary qualification requires a record store, an asset reader and a synthesis step');
  const canaries = manifest.canaries;
  const decode = decodeReference ?? decodeReferencePng;
  const identity = JSON.stringify({
    schema: CANARY_RECORD_SCHEMA, manifestSha256, provider, bundleVersion: manifest.bundleVersion ?? null,
    bundle: bundleDigest(bundle), sampleIndices: manifest.sampleIndices?.sha256 ?? null,
    canaries: canaries.map(c => ({ name: c.name, w: c.w?.sha256 ?? null, noise: c.noise ?? null, samples: c.samples?.sha256 ?? null, reference: c.reference?.sha256 ?? null }))
  });
  const key = `canary-qualification:${digestJson(identity)}`;
  let checks = [], adopted = false;
  async function adopt() {
    if (adopted) return checks;
    adopted = true;
    try {
      const record = await records.get(key);
      // A full (CI) run re-proves everything regardless of what is recorded.
      if (!full && record?.schema === CANARY_RECORD_SCHEMA && record.manifestSha256 === manifestSha256 && record.provider === provider && validChecks(record.checks, canaries))
        checks = record.checks;
    } catch { /* a recorded qualification is an optimisation; a failed read just re-runs */ }
    return checks;
  }
  async function runNext(onEvent) {
    const index = checks.length;
    if (index >= canaries.length) return null;
    const c = canaries[index];
    onEvent?.({ name: c.name, loaded: index, total: canaries.length });
    const wBytes = await acquireBytes(c.w);
    const raw = await runSynthesis(new Float32Array(wBytes.buffer, wBytes.byteOffset, wBytes.byteLength / 4), c.noise || 'original');
    const indices = new Uint32Array((await acquireBytes(manifest.sampleIndices)).buffer);
    const sampleBytes = await acquireBytes(c.samples), samples = new Float32Array(sampleBytes.buffer, sampleBytes.byteOffset, sampleBytes.byteLength / 4);
    const expected = (await decode(await acquireBytes(c.reference))).rgba, actual = rgba1024(raw);
    let maxRgb = 0, maxFloat = 0;
    for (let i = 0; i < actual.length; i++) if (i % 4 !== 3) maxRgb = Math.max(maxRgb, Math.abs(actual[i] - expected[i]));
    for (let i = 0; i < indices.length; i++) maxFloat = Math.max(maxFloat, Math.abs(raw[indices[i]] - samples[i]));
    const check = { name: c.name, maxRgb, maxFloat, passed: Number.isFinite(maxFloat) && maxRgb <= 1 && maxFloat <= .002 };
    // Test-only forcing (next-e2e routeRejectionNamed): the e2e host passes forceFail so the
    // comparison fails without touching the tolerances. Never set in production.
    check.passed = forceFail === true ? false : check.passed;
    if (!check.passed) throw Error(`Device correctness check failed: ${c.name}`);
    checks = [...checks, check];
    // Progress persists as it lands, so a session that ends mid-qualification resumes instead
    // of paying for the same canaries twice. A failed write is never fatal.
    try { await records.put(key, { schema: CANARY_RECORD_SCHEMA, manifestSha256, provider, bundleVersion: manifest.bundleVersion ?? null, checks, validatedAt: new Date().toISOString() }); } catch { }
    return check;
  }
  return { key, checks: () => checks.slice(), complete: () => checks.length >= canaries.length, adopt, runNext };
}
