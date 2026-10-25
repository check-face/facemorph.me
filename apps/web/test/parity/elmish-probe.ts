// Observing the control's state without rebuilding it (fm-hn9e golden spike). The control is Fable Elmish on
// React 17: Elmish.React renders the view through a lazy component whose props carry the whole model. A React
// DevTools hook installed before the bundle loads sees every commit, so each commit's model can be read off the
// root fibre. Messages themselves are not observable (the dispatch closure is private); a step is recorded as
// the model before and after the input.

/** Installed with page.addInitScript before the control loads. Keeps the last model and a commit counter. */
export const INSTALL_HOOK = `(() => {
  const findModel = (fiber) => {
    for (let f = fiber, depth = 0; f && depth < 30; f = f.child, depth++) {
      const p = f.memoizedProps;
      if (p && typeof p === 'object' && 'model' in p && p.model && typeof p.model === 'object') return p.model;
      // React port: observe the actual useSyncExternalStore-backed controller through Product props.
      // This only reads getState; it neither dispatches nor replaces a runtime/browser operation.
      if (p && typeof p.store?.getState === 'function') return p.store.getState();
    }
    return null;
  };
  window.__elmish = { commits: 0, model: null };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, isDisabled: false, renderers: new Map(),
    inject(renderer) { this.renderers.set(1, renderer); return 1; },
    checkDCE() {}, onScheduleFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
    onCommitFiberRoot(_id, root) {
      const model = findModel(root.current);
      if (model) { window.__elmish.model = model; window.__elmish.commits++; }
    },
  };
})();`;

/** Evaluated in the page: the current model as plain JSON. F# lists become arrays, records become objects, files
 * and blobs are reduced to their size and type (never their bytes), typed arrays to their length, functions dropped. */
export const READ_MODEL = `(() => {
  const seen = new WeakSet();
  const plain = (v, depth) => {
    if (v === null || v === undefined || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v ?? null;
    if (typeof v === 'function' || depth > 8) return undefined;
    if (typeof Blob !== 'undefined' && v instanceof Blob) return { blob: true, size: v.size, type: v.type };
    if (ArrayBuffer.isView(v)) return { typedArray: v.constructor.name, length: v.length };
    if (seen.has(v)) return '[cycle]';
    seen.add(v);
    if (v.constructor && v.constructor.name === 'FSharpList' || ('head' in v && 'tail' in v && Object.keys(v).length <= 3)) {
      const out = [];
      for (let n = v; n && n.tail !== undefined && out.length < 1000; n = n.tail) if ('head' in n) out.push(plain(n.head, depth + 1));
      return out;
    }
    if (Array.isArray(v)) return v.map((x) => plain(x, depth + 1));
    // F# Map and Set (Fable: { comparer, tree } over MapTree/SetTree nodes { k, v?, left, right }): their entries in order.
    if ('comparer' in v && 'tree' in v) {
      const entries = [];
      const visit = (n) => { if (!n || entries.length > 1000) return; visit(n.left); entries.push('v' in n ? [plain(n.k, depth + 1), plain(n.v, depth + 1)] : plain(n.k, depth + 1)); visit(n.right); };
      visit(v.tree);
      return { fsharp: entries.length && Array.isArray(entries[0]) ? 'map' : 'set', entries };
    }
    if (v instanceof Map) return { fsharp: 'map', entries: [...v].map(([k, x]) => [plain(k, depth + 1), plain(x, depth + 1)]) };
    if (v instanceof Set) return { fsharp: 'set', entries: [...v].map((x) => plain(x, depth + 1)) };
    if ('tag' in v && 'fields' in v && Array.isArray(v.fields)) return { union: v.tag, name: v.cases?.()[v.tag], fields: v.fields.map((x) => plain(x, depth + 1)) };
    const out = {};
    for (const k of Object.keys(v)) { const x = plain(v[k], depth + 1); if (x !== undefined) out[k] = x; }
    return out;
  };
  return { commits: window.__elmish.commits, model: plain(window.__elmish.model, 0) };
})()`;
