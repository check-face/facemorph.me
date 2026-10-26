// Preloaded (--import) into the import side-effect sandbox (fm-7ge, gate 3); sandbox.mjs owns the process. While
// armed it records every I/O attempt from user code and keeps a snapshot of the global object to diff afterwards:
//   - Node I/O: every function of fs, fs/promises, net, tls, http, https, http2, dgram, dns, dns/promises,
//     child_process and worker_threads.Worker (the ESM bindings follow through syncBuiltinESMExports()).
//   - Web I/O: fetch, WebSocket, EventSource, XMLHttpRequest, indexedDB, caches, localStorage, sessionStorage and
//     navigator.storage are replaced by recording traps (absent ones read as undefined, as in Node).
//   - Scheduling and output: setTimeout, setInterval, setImmediate, queueMicrotask, process.on/once/addListener,
//     process.stdout/stderr.write and console.*; process.getActiveResourcesInfo() is diffed too.
// A call counts only when a frame outside node: internals and this guard is on the stack, so the module loader's
// own reads never do. Writes are found by diffing globalThis's own keys and descriptors, the built-in prototypes
// and namespaces, and process.env.
import { createRequire, syncBuiltinESMExports } from 'node:module';

const require = createRequire(import.meta.url);
const SELF = import.meta.url;
const touches = [];
let armed = false;

const fromUserCode = () => {
  const stack = new Error().stack?.split('\n').slice(2) ?? [];
  return stack.some(
    (l) => /(?:file:\/\/|\s\/)/.test(l) && !l.includes(SELF) && !l.includes('node:'),
  );
};
const record = (what) => {
  if (!armed || !fromUserCode()) return;
  armed = false; // building the stack string must not recurse into a trap
  try {
    const at = new Error().stack?.split('\n').find((l) => /file:\/\//.test(l) && !l.includes(SELF));
    touches.push({ what, at: at?.trim() ?? null });
  } finally {
    armed = true;
  }
};

function wrapObject(label, obj) {
  for (const key of Object.getOwnPropertyNames(obj)) {
    const d = Object.getOwnPropertyDescriptor(obj, key);
    if (!d || typeof d.value !== 'function' || !d.writable) continue;
    const orig = d.value;
    const isClass = /^[A-Z]/.test(key);
    const wrapped = isClass
      ? new Proxy(orig, {
          construct(t, args, nt) {
            record(`new ${label}.${key}`);
            return Reflect.construct(t, args, nt);
          },
          apply(t, self, args) {
            record(`${label}.${key}`);
            return Reflect.apply(t, self, args);
          },
        })
      : function (...args) {
          record(`${label}.${key}`);
          return Reflect.apply(orig, this, args);
        };
    try {
      obj[key] = wrapped;
    } catch {
      /* non-writable in this Node: left alone */
    }
  }
}

for (const m of ['fs', 'net', 'tls', 'http', 'https', 'http2', 'dgram', 'dns', 'child_process'])
  wrapObject(`node:${m}`, require(m));
wrapObject('node:fs/promises', require('fs/promises'));
wrapObject('node:dns/promises', require('dns/promises'));
{
  const wt = require('worker_threads');
  wrapObject('node:worker_threads', { Worker: wt.Worker });
  const W = wt.Worker;
  wt.Worker = new Proxy(W, {
    construct(t, a, nt) {
      record('new node:worker_threads.Worker');
      return Reflect.construct(t, a, nt);
    },
  });
}
syncBuiltinESMExports();

const trapGlobal = (name, owner = globalThis, label = name) => {
  let value;
  try {
    value = owner[name];
  } catch {
    value = undefined;
  }
  const replacement =
    typeof value === 'function'
      ? new Proxy(value, {
          apply(t, self, args) {
            record(label);
            return Reflect.apply(t, self, args);
          },
          construct(t, args, nt) {
            record(`new ${label}`);
            return Reflect.construct(t, args, nt);
          },
        })
      : value;
  try {
    Object.defineProperty(owner, name, {
      configurable: true,
      enumerable: false,
      get() {
        record(label);
        return replacement;
      },
      set(v) {
        record(`${label} =`);
        Object.defineProperty(owner, name, { configurable: true, writable: true, value: v });
      },
    });
  } catch {
    /* a non-configurable global: diffing still catches a write */
  }
};
for (const g of [
  'fetch',
  'WebSocket',
  'EventSource',
  'XMLHttpRequest',
  'indexedDB',
  'caches',
  'localStorage',
  'sessionStorage',
])
  trapGlobal(g);
try {
  if (globalThis.navigator) trapGlobal('storage', globalThis.navigator, 'navigator.storage');
} catch {
  /* no navigator */
}

const settleImmediate = globalThis.setImmediate;
for (const g of ['setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask']) {
  const orig = globalThis[g];
  globalThis[g] = function (...args) {
    record(g);
    return Reflect.apply(orig, this, args);
  };
}
for (const m of ['on', 'once', 'addListener', 'prependListener']) {
  const orig = process[m];
  process[m] = function (...args) {
    record(`process.${m}(${String(args[0])})`);
    return Reflect.apply(orig, this, args);
  };
}
for (const s of [process.stdout, process.stderr]) {
  const orig = s.write;
  const label = s === process.stdout ? 'process.stdout.write' : 'process.stderr.write';
  s.write = function (...args) {
    record(label);
    return Reflect.apply(orig, this, args);
  };
}
for (const m of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir', 'table']) {
  const orig = console[m];
  console[m] = function (...args) {
    record(`console.${m}`);
    return Reflect.apply(orig, this, args);
  };
}

const BUILTINS = Object.entries({
  Object,
  'Object.prototype': Object.prototype,
  'Function.prototype': Function.prototype,
  Array,
  'Array.prototype': Array.prototype,
  'String.prototype': String.prototype,
  'Number.prototype': Number.prototype,
  'Boolean.prototype': Boolean.prototype,
  Symbol,
  'Symbol.prototype': Symbol.prototype,
  Promise,
  'Promise.prototype': Promise.prototype,
  'Map.prototype': Map.prototype,
  'Set.prototype': Set.prototype,
  'WeakMap.prototype': WeakMap.prototype,
  'RegExp.prototype': RegExp.prototype,
  'Date.prototype': Date.prototype,
  Error,
  'Error.prototype': Error.prototype,
  JSON,
  Math,
  Reflect,
  'ArrayBuffer.prototype': ArrayBuffer.prototype,
  'TypedArray.prototype': Object.getPrototypeOf(Uint8Array.prototype),
  'Uint8Array.prototype': Uint8Array.prototype,
  'Float32Array.prototype': Float32Array.prototype,
  'DataView.prototype': DataView.prototype,
  'Iterator.prototype': globalThis.Iterator?.prototype,
}).filter(([, v]) => v);
const keyName = (k) => (typeof k === 'symbol' ? k.toString() : k);
const describe = (obj) => {
  const out = new Map();
  for (const k of Reflect.ownKeys(obj)) {
    const d = Object.getOwnPropertyDescriptor(obj, k);
    out.set(k, d && ('value' in d ? d.value : [d.get, d.set]));
  }
  return out;
};
const same = (a, b) =>
  Array.isArray(a) && Array.isArray(b) ? a[0] === b[0] && a[1] === b[1] : Object.is(a, b);
const diff = (before, after) => {
  const added = [];
  const changed = [];
  const removed = [];
  for (const [k, v] of after)
    if (!before.has(k)) added.push(keyName(k));
    else if (!same(before.get(k), v)) changed.push(keyName(k));
  for (const k of before.keys()) if (!after.has(k)) removed.push(keyName(k));
  return { added, changed, removed };
};
const tally = (list) => list.reduce((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});

const KEY = Symbol.for('facemorph.consumer-gates.sandbox');
Object.defineProperty(globalThis, KEY, {
  configurable: false,
  enumerable: false,
  value: Object.freeze({
    arm() {
      // Materialise Node's lazy globals (each turns into a data property on first read) before the snapshot.
      for (const k of Reflect.ownKeys(globalThis)) {
        if (k === KEY) continue;
        const d = Object.getOwnPropertyDescriptor(globalThis, k);
        if (d && d.get && d.configurable && !String(d.get).includes('record(')) {
          try {
            void globalThis[k];
          } catch {
            /* a throwing getter stays an accessor */
          }
        }
      }
      const snapshot = {
        global: describe(globalThis),
        builtins: BUILTINS.map(([, b]) => describe(b)),
        env: { ...process.env },
        resources: tally(process.getActiveResourcesInfo()),
      };
      armed = true;
      return snapshot;
    },
    /** One macrotask turn through the unwrapped setImmediate, so promise jobs a module queued have run. */
    settle() {
      return new Promise((r) => settleImmediate(r));
    },
    disarm(snapshot) {
      armed = false;
      const global = diff(snapshot.global, describe(globalThis));
      const builtins = BUILTINS.map(([object, b], i) => ({
        object,
        ...diff(snapshot.builtins[i], describe(b)),
      })).filter((d) => d.added.length || d.changed.length || d.removed.length);
      const env = [...new Set([...Object.keys(snapshot.env), ...Object.keys(process.env)])].filter(
        (k) => snapshot.env[k] !== process.env[k],
      );
      const now = tally(process.getActiveResourcesInfo());
      const resources = Object.keys(now).filter((k) => now[k] > (snapshot.resources[k] ?? 0));
      return { touches: [...touches], global, builtins, env, resources };
    },
  }),
});
