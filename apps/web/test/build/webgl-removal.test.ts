// WebGL removal (fm-x6h5): no WebGL execution path remains in the closure; webgl route requests are a typed
// refusal; a saved webgl preference reads as Automatic and other saved values are kept; and check-next-artifact.sh's
// probe finds the Processing mode select by name, inside the control's closed <details> (from the recorded control
// DOM in the goldens) or outside any (the destination shape), with the routes its artifact label expects.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const web = (p: string) => new URL(`../../${p}`, import.meta.url);
const read = (p: string) => readFileSync(web(p), 'utf8');
const code = (p: string) => read(p).replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '');

test('no WebGL execution path remains in the runtime, worker, route selection or bridge', () => {
  const runtime = code('src/Next/browser/runtime.mjs');
  const worker = code('src/Next/browser/ort-worker.mjs');
  for (const [name, src] of [
    ['runtime', runtime],
    ['worker', worker],
    ['priors', code('src/Next/browser/route-priors.mjs')],
    ['bridge', code('src/Next/product-bridge.mjs')],
  ] as const) {
    assert.doesNotMatch(src, /webgl2|createHybridSession|'webgl-only'|webgl\?\['webgl'\]/, name);
    assert.doesNotMatch(src, /order: \[[^\]]*'webgl'/, `${name}: no route order names webgl`);
  }
  assert.doesNotMatch(runtime, /\['auto','cpu','webgl','webgpu'\]|'webgl'\]:\[\]/);
  // manifest.webgl stays: the direct WebGPU engine's coefficient bundle and canary identity.
  assert.match(worker, /gpuEngine==='direct'\?manifest\.webgl:manifest\.webgpu/);
  assert.match(worker, /createDirectWebGpuSession\(\{config:manifest\.webgl/);
  assert.match(worker, /if\(!\['wasm','webgpu'\]\.includes\(request\.provider\)\)throw/);
});

test('webgl route requests are a typed refusal; saved webgl preferences migrate to Automatic, others unchanged', () => {
  // The class as the runtime declares it (importing the runtime would start its module graph's timers).
  const decl = /export class RemovedRouteError extends Error\{[^\n]*\}\}/
    .exec(read('src/Next/browser/runtime.mjs'))![0]
    .replace('export ', '');
  const RemovedRouteError = new Function(
    `${decl}; return RemovedRouteError;`,
  )() as new () => Error & { code: string };
  const e = new RemovedRouteError();
  assert.equal(e.name, 'RemovedRouteError');
  assert.equal(e.code, 'route-removed');
  const runtime = read('src/Next/browser/runtime.mjs');
  assert.match(
    runtime,
    /setPreferredRoute:\(requested\)=>\{[^}]*if\(requested==='webgl'\)throw new RemovedRouteError\(\)/,
  );
  assert.match(
    runtime,
    /qualify:\(requestedRoute='cpu',options=\{\}\)=>afterDelivery\(operation\(async progress=>\{if\(requestedRoute==='webgl'\)throw new RemovedRouteError\(\)/,
  );
  // The bridge's migration, run as the bridge runs it (a pure export of the bridge module's source).
  const bridge = read('src/Next/product-bridge.mjs');
  const fn = /export function migrateRoutePreference\(settings\)\{[^\n]*\}/
    .exec(bridge)![0]
    .replace('export ', '');
  const migrate = new Function(`${fn}; return migrateRoutePreference;`)() as (
    s: unknown,
  ) => unknown;
  assert.deepEqual(migrate({ provider: 'webgl', kind: 'linear' }), {
    provider: 'auto',
    kind: 'linear',
  });
  for (const provider of ['auto', 'cpu', 'webgpu']) {
    const saved = { provider, kind: 'linear' };
    assert.equal(migrate(saved), saved, `${provider} is kept as saved`);
  }
  assert.match(
    bridge,
    /const settings=migrateRoutePreference\(saved\.settings\);\n sessionView=\{\.\.\.settings,[^\n]*\n if\(settings!==saved\.settings\)retainSession\(\);/,
    'written back once',
  );
});

// The recorded control DOM (goldens, morph.settings-start-cancel/desktop/01-settings) rendered back to HTML.
type Node = {
  tag?: string;
  text?: string;
  classes?: string[];
  attrs?: Record<string, string>;
  children?: Node[];
};
const html = (n: Node): string => {
  if (!n.tag) return n.text ?? '';
  const attrs = Object.entries({
    ...n.attrs,
    ...(n.classes?.length ? { class: n.classes.join(' ') } : {}),
  })
    .filter(([k]) => k !== 'value' || n.tag !== 'select')
    .map(([k, v]) => ` ${k}="${String(v).replace(/"/g, '&quot;')}"`)
    .join('');
  return `<${n.tag}${attrs}>${n.text ?? ''}${(n.children ?? []).map(html).join('')}</${n.tag}>`;
};
const find = (v: unknown, pred: (n: Node) => boolean): Node | undefined => {
  if (Array.isArray(v)) return v.map((c) => find(c, pred)).find(Boolean);
  if (!v || typeof v !== 'object') return undefined;
  const n = v as Node;
  if (n.tag) return pred(n) ? n : find(n.children ?? [], pred);
  return find(Object.values(v), pred);
};

test('check-next-artifact probe: the control and destination shapes give the routes their label expects', async (t) => {
  const require = createRequire(import.meta.url);
  let chromium: {
    launch: () => Promise<{
      newPage: () => Promise<{
        setContent: (h: string) => Promise<void>;
        addScriptTag: (o: object) => Promise<unknown>;
        evaluate: (f: string) => Promise<unknown>;
      }>;
      close: () => Promise<void>;
    }>;
  };
  try {
    ({ chromium } = require('playwright'));
  } catch {
    return t.skip('untested here: playwright is not installed');
  }
  const browser = await chromium.launch().catch(() => null);
  if (!browser) return t.skip('untested here: no Playwright Chromium on this runner');
  try {
    const golden = JSON.parse(
      read('test/goldens/control/morph.settings-start-cancel/desktop/01-settings.json'),
    ) as Node;
    const details = find(
      (golden as { dom?: unknown }).dom,
      (n) => n.tag === 'details' && (n.classes ?? []).includes('next-advanced'),
    )!;
    assert.ok(details, 'the recorded control has its Advanced details');
    const expected = JSON.parse(read('build/provider-routes.json')) as Record<
      'control' | 'destination',
      string[]
    >;
    const probe = read('build/provider-probe.js');
    const run = async (body: string) => {
      const page = await browser.newPage();
      await page.setContent(body);
      await page.addScriptTag({ content: probe });
      return (await page.evaluate('__probeProvider()')) as {
        found: number;
        routes: string[];
        providerLocation: { region: string; inClosedDetails: boolean; classes: string[] };
      };
    };
    const control = await run(`<!doctype html><main>${html(details)}</main>`);
    assert.deepEqual(control.routes.sort(), [...expected.control].sort());
    assert.deepEqual(control.providerLocation, {
      region: 'details',
      inClosedDetails: true,
      classes: ['next-advanced'],
    });
    const destination = await run(read('test/fixtures/next-artifact/destination.html'));
    assert.deepEqual(destination.routes.sort(), [...expected.destination].sort());
    assert.equal(
      destination.providerLocation.inClosedDetails,
      false,
      'found outside .next-advanced, nothing opened',
    );
    assert.equal(destination.providerLocation.region, 'section');
    assert.notDeepEqual(
      control.routes.sort(),
      expected.destination,
      'a control artifact would fail the destination expectation',
    );
  } finally {
    await browser.close();
  }
  assert.doesNotMatch(
    read('scripts/check-next-artifact.sh'),
    /next-advanced/,
    'no hard-coded .next-advanced remains',
  );
});

test('kept behaviour: the visible-time stall watchdog (paused while hidden, restarted on return) is unchanged', () => {
  const runtime = read('src/Next/browser/runtime.mjs');
  assert.match(runtime, /const hidden=\(\)=>globalThis\.document\?\.hidden===true;/);
  assert.match(
    runtime,
    /const timeout=\(\)=>\{if\(hidden\(\)\)\{task\.timer=setTimeout\(timeout,stall\);return;\}stop\(/,
    'reschedules instead of firing while hidden',
  );
  assert.match(
    runtime,
    /addEventListener\?\.\('visibilitychange',\(\)=>\{\n  if\(!hidden\(\)\)for\(const task of pending\.values\(\)\)task\.reset\?\.\(\);/,
    'becoming visible restarts the window',
  );
});
