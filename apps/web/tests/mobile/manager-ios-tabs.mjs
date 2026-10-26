// Native Safari documents/workers only. simctl opens the helper; visibility and document identity are observed,
// never emulated. Fixture-ledger evidence covers model endpoints; controller/module requests are separate traffic.
const params = new URLSearchParams(location.search);
const runId = params.get('run');
const role = params.get('role');
const documentIdentity = window.managerTabIdentity;
const documentUrl = location.href;
const sha256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const backends = ['opfs', 'cache-storage'];
const phaseMs = 30000;
let backend, currentPhase = 'startup', channel;
const check = (condition, message) => { if (!condition) throw Error(message); };
const same = (actual, expected, message) => check(JSON.stringify(actual) === JSON.stringify(expected), message);
const nameFor = value => `mobile-ios-tabs-${runId}-${value}`;
const rpc = (method, options) => window.managerTab(method, options);

async function phase(label, work) {
  currentPhase = label;
  const controller = new AbortController();
  const started = Date.now();
  let timer;
  const expired = () => Error(`Native iOS tab phase exceeded 30 seconds: ${label}`);
  try {
    const value = await Promise.race([
      Promise.resolve().then(() => work(controller.signal)),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
          const error = expired();
          controller.abort(error);
          reject(error);
        }, phaseMs);
      }),
    ]);
    // Safari can throttle a hidden document's timers. A delayed timer cannot turn an over-budget resume into a pass.
    if (Date.now() - started > phaseMs) {
      const error = expired();
      controller.abort(error);
      throw error;
    }
    return value;
  } finally { clearTimeout(timer); }
}

const control = message => phase(`controller ${message.action}`, async signal => {
  const response = await fetch('/tabs-control', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId, ...message }), signal,
  });
  check(response.ok, `Native iOS controller refused ${message.action}: ${response.status}`);
});
const ledger = () => phase('model fixture ledger', async signal => {
  const response = await fetch('/fixture/ledger', { signal });
  check(response.ok, 'Native model fixture ledger unavailable');
  const value = await response.json();
  check(value.version === 1 && Array.isArray(value.transfers), 'Invalid native model fixture ledger');
  return value.transfers;
});
const poll = async (signal, predicate) => {
  for (;;) {
    if (signal.aborted) throw signal.reason;
    const result = await predicate();
    if (signal.aborted) throw signal.reason;
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
};
const unchangedDocument = () => {
  check(window.managerTabIdentity === documentIdentity && location.href === documentUrl,
    'Primary Safari document changed while the helper was active');
  const navigations = performance.getEntriesByType('navigation');
  check(navigations.length === 1 && navigations[0].type !== 'reload', 'Primary Safari document reloaded');
};

async function primary() {
  const sessionKey = `mobile-ios-tabs-primary:${runId}`;
  check(sessionStorage.getItem(sessionKey) === null, 'Primary protocol restarted in a reloaded document');
  sessionStorage.setItem(sessionKey, documentIdentity);
  const rows = [];
  try {
    for (backend of backends) {
      const name = nameFor(backend);
      const before = await ledger();
      let hidden = false, returned = false, helperIdentity;
      const visibility = [];
      const observeVisibility = () => {
        const state = document.visibilityState;
        visibility.push({ state, at: Date.now() });
        if (state === 'hidden') hidden = true;
        if (state === 'visible' && hidden) returned = true;
      };
      const helperDone = ({ data }) => {
        if (data?.type !== 'helper-deleted' || data.runId !== runId || data.backend !== backend
          || data.name !== name || data.primaryIdentity !== documentIdentity) return;
        helperIdentity = data.helperIdentity;
      };
      document.addEventListener('visibilitychange', observeVisibility);
      channel.addEventListener('message', helperDone);
      let row;
      try {
        const identity = await phase(`${backend} initialize`, () => rpc('init', { backend, name }));
        check(identity.secureContext === true && isSecureContext, 'Native Safari storage is not in a secure context');
        await phase(`${backend} seed and verified read`, async () => {
          await rpc('seed');
          same(await rpc('read'), { ok: true, bytes: [97, 98, 99] }, 'Primary local bytes differ');
        });
        await phase(`${backend} hold native lease`, () => rpc('lease'));
        await phase(`${backend} primary visible before helper`, signal => poll(signal, () => document.visibilityState === 'visible'));
        unchangedDocument();
        // Ignore earlier focus changes during preparation. Only this helper journey may satisfy the row.
        hidden = false; returned = false; visibility.length = 0;
        await control({ action: 'open-helper', backend, name, primaryIdentity: documentIdentity });
        await phase(`${backend} helper journey and native visibility return`, signal =>
          poll(signal, () => hidden && returned && document.visibilityState === 'visible'
            && typeof helperIdentity === 'string' && helperIdentity));
        check(helperIdentity !== documentIdentity, 'The helper reused the primary document');
        unchangedDocument();
        const invalidations = await phase(`${backend} typed native invalidation`, signal => poll(signal, async () => {
          const value = await rpc('invalidations');
          return value.length ? value : false;
        }));
        same(invalidations, [{ cause: 'cross-tab-deletion', code: 'invalidated' }], 'Unexpected native deletion invalidation');
        const missing = await phase(`${backend} local evicted miss`, () => rpc('read'));
        check(missing.ok === false && missing.error?.code === 'evicted', 'Deleted native asset did not produce an evicted local miss');
        same(await phase(`${backend} release native lease`, () => rpc('release')), [], 'Native lease registry retained an asset');
        await phase(`${backend} native exclusive reacquisition`, signal => poll(signal, () => rpc('exclusive')));
        same(await ledger(), before, 'Native iOS cross-tab journey transferred model fixture bytes');
        row = {
          id: `${backend}.cross-tab`, backend, lane: identity.userAgent, status: 'pass',
          network: { requests: 0, bytes: 0, paths: [], measurement: 'native-server-ledger', hostSeparation: false },
          details: {
            controller: 'actual-ios-safari-simctl', independentDocuments: [documentIdentity, helperIdentity],
            primaryVisibility: visibility, primaryDocumentUnchanged: true, nativeWebLocksReleased: true,
            invalidation: 'cross-tab-deletion', localRead: 'evicted',
            scope: 'native storage/leases; fixture ledger excludes controller/module traffic; external HTTP and loaded inference disposal are not asserted',
          },
        };
      } finally {
        document.removeEventListener('visibilitychange', observeVisibility);
        channel.removeEventListener('message', helperDone);
        await phase(`${backend} native primary cleanup`, () => rpc('cleanup'));
      }
      unchangedDocument();
      same(await ledger(), before, 'Native iOS cross-tab cleanup transferred model fixture bytes');
      check(document.visibilityState === 'visible', 'Primary Safari document is not foregrounded at completion');
      rows.push(row); // cleanup must succeed before this backend can contribute a pass
    }
    await control({ action: 'complete', rows });
  } finally { sessionStorage.removeItem(sessionKey); }
}

async function helper() {
  backend = params.get('backend');
  const name = params.get('name'), primaryIdentity = params.get('primaryIdentity');
  check(backends.includes(backend) && name === nameFor(backend), 'Helper fixture identity differs from this run');
  check(typeof primaryIdentity === 'string' && primaryIdentity.length > 0 && primaryIdentity !== documentIdentity,
    'Helper is not an independent Safari document');
  try {
    const identity = await phase(`${backend} helper initialize`, () => rpc('init', { backend, name }));
    check(identity.secureContext === true && isSecureContext, 'Helper Safari storage is not in a secure context');
    same(await phase(`${backend} helper verified read`, () => rpc('read')),
      { ok: true, bytes: [97, 98, 99] }, 'Helper cannot read the primary native bytes');
    same(await phase(`${backend} respect native primary lease`, () => rpc('evict')),
      { removed: [], kept: [sha256] }, 'Helper evicted the primary tab\'s leased native bytes');
    same(await phase(`${backend} explicit native deletion`, () => rpc('remove')), [sha256], 'Helper failed to delete the native asset');
  } finally { await phase(`${backend} native helper cleanup`, () => rpc('cleanup')); }
  const message = { action: 'helper-deleted', backend, name, primaryIdentity, helperIdentity: documentIdentity };
  await control(message);
  channel.postMessage({ ...message, runId, type: 'helper-deleted' });
}

try {
  check(typeof runId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(runId), 'Invalid native iOS tab run ID');
  check(role === 'primary' || role === 'helper', 'Invalid native iOS tab role');
  check(typeof documentIdentity === 'string' && typeof window.managerTab === 'function', 'Native worker RPC is absent');
  channel = new BroadcastChannel(`facemorph-mobile-ios-tabs:${runId}`);
  if (role === 'primary') await primary();
  else await helper();
} catch (error) {
  const failure = { action: 'failed', role, backend, primaryIdentity: role === 'primary' ? documentIdentity : params.get('primaryIdentity'),
    documentIdentity, phase: currentPhase, error: String(error.stack || error) };
  console.error(failure);
  try { await control(failure); } catch (reportError) { console.error(reportError); }
} finally {
  channel?.close();
  if (role === 'helper') window.close();
}
