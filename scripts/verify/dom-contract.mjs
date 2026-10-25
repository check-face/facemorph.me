// The DOM contract the parity harness compares between the control and a subject (fm-q007): what a person and
// assistive technology meet, not how the tree is built. The port renders with a different React/MUI, so wrapper
// elements and generated classes differ legitimately; the contract keeps, in document order, each node that carries
// a `.next-*` class, an ARIA attribute, a role, a disabled state, visible text, or is an interactive element.
// Input: the serialised DOM of apps/web/test/goldens/*/<row>/<project>/NN-<step>.json (`dom`: named regions of
// {tag, classes?, attrs?, text?, children?}). Pure functions.

const INTERACTIVE = new Set([
  'button',
  'input',
  'select',
  'textarea',
  'a',
  'video',
  'details',
  'summary',
  'dialog',
]);
const CONTRACT_ATTRS = /^(aria-|role$|disabled$|type$|data-next-)/;

// Reviewed MUI 4 → 9 restyles (fm-zz2i): button-label spans became direct text,
// and outlined inputs gained an aria-hidden zero-width sentinel. Preserve labels/ARIA
// and all real controls while ignoring only those presentation changes.
const sentinel = (node) =>
  node?.tag === 'span' &&
  node.attrs?.['aria-hidden'] === 'true' &&
  node.text === '\u200b' &&
  !node.children?.length;
const transparentLabel = (node) =>
  node?.tag === 'span' &&
  !(node.classes ?? []).some((c) => c.startsWith('next-')) &&
  !Object.keys(node.attrs ?? {}).length;
const labelText = (node) =>
  [node.text ?? '', ...(node.children ?? []).filter(transparentLabel).map(labelText)]
    .filter(Boolean)
    .join(' ');

function normalText(text) {
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
}

/** One contract entry per kept node, in document order: {region, tag?, next[], attrs{}, text}. */
export function contractOf(dom) {
  const out = [];
  const visit = (node, region, checkboxLabel) => {
    if (!node || typeof node !== 'object' || sentinel(node)) return;
    if (node.tag === 'input' && node.attrs?.type === 'hidden') return;
    // Explicit provider retirement (fm-x6h5), not an arbitrary option/label exception.
    if (
      node.tag === 'option' &&
      node.attrs?.value === 'webgl' &&
      normalText(node.text) === 'WebGL GPU'
    )
      return;
    const next = (node.classes ?? []).filter((c) => c.startsWith('next-')).sort();
    // MUI 4 put the Checkbox aria-label on its presentation span; MUI 9 puts it
    // on the native checkbox. Carry only that label to the same actual control.
    const containsCheckbox = (n) =>
      (n.children ?? []).some(
        (c) => (c.tag === 'input' && c.attrs?.type === 'checkbox') || containsCheckbox(c),
      );
    const labelCarrier =
      node.tag === 'span' &&
      !next.length &&
      Object.keys(node.attrs ?? {}).length === 1 &&
      node.attrs?.['aria-label'] &&
      containsCheckbox(node);
    if (labelCarrier) {
      for (const child of node.children ?? []) visit(child, region, node.attrs['aria-label']);
      return;
    }
    const attrs = Object.fromEntries(
      Object.entries(node.attrs ?? {})
        .filter(([k]) => CONTRACT_ATTRS.test(k))
        .sort(([a], [b]) => (a < b ? -1 : 1)),
    );
    if (
      checkboxLabel &&
      node.tag === 'input' &&
      node.attrs?.type === 'checkbox' &&
      !attrs['aria-label']
    )
      attrs['aria-label'] = checkboxLabel;
    // A native range exposes the same slider role as MUI 4's thumb. Its hidden
    // form input was metadata; the visible role/value/label remain the contract.
    const slider =
      attrs.role === 'slider' || (node.tag === 'input' && node.attrs?.type === 'range');
    if (slider) {
      attrs.role = 'slider';
      attrs.type = 'range';
    }
    const text = normalText(node.tag === 'button' ? labelText(node) : node.text);
    const interactive = INTERACTIVE.has(node.tag) || slider;
    if (next.length || Object.keys(attrs).length || text || interactive) {
      out.push({
        region,
        ...(interactive ? { tag: slider ? 'input' : node.tag } : {}),
        next,
        attrs: Object.fromEntries(Object.entries(attrs).sort(([a], [b]) => (a < b ? -1 : 1))),
        text,
      });
    }
    for (const child of node.children ?? []) {
      if (node.tag === 'button' && transparentLabel(child)) {
        // Text already belongs to the button; retain any nested meaningful nodes.
        for (const nested of child.children ?? [])
          if (!transparentLabel(nested)) visit(nested, region, checkboxLabel);
      } else visit(child, region, checkboxLabel);
    }
  };
  for (const [region, roots] of Object.entries(dom ?? {}))
    for (const root of [].concat(roots)) {
      // MUI 4 retained the closed consent Snackbar during its exit transition; MUI 9
      // unmounts it. The model/failure toast owns the visible slot in both versions.
      const priorityToast =
        region === 'toasts' &&
        []
          .concat(roots)
          .some((r) =>
            (r.classes ?? []).some((c) => c === 'next-model-toast' || c === 'next-failure-toast'),
          );
      if (
        priorityToast &&
        (root.classes ?? []).includes('next-consent-toast') &&
        !(root.classes ?? []).some((c) => c === 'next-model-toast' || c === 'next-failure-toast')
      )
        continue;
      visit(root, region);
    }
  return out;
}

// fm-25um/fm-fy2.17.1's declared arrival changes, applied to the retained layout only. The new
// layout is compared as-is, so a missing/misplaced action or changed label still fails.
// Frozen goldens remain untouched; all unrelated first-visit entries compare exactly.
export function arrivalTileContract(entries) {
  const out = [];
  for (let i = 0; i < entries.length; i++) {
    if (!entries[i].next.includes('next-face')) {
      out.push(entries[i]);
      continue;
    }
    const end = entries.findIndex((e, j) => j > i && e.next.includes('next-face-actions'));
    if (end < 0) {
      out.push(entries[i]);
      continue;
    }
    const face = entries.slice(i, end);
    const action = face.find(
      (e) =>
        e.tag === 'button' &&
        e.next.length === 1 &&
        e.next[0] === 'next-face-generate' &&
        e.text === 'Generate',
    );
    if (!action || face.some((e) => e.next.includes('next-face-operation'))) {
      out.push(...face);
      i = end - 1;
      continue;
    }
    const changed = [];
    for (let j = 0; j < face.length; j++) {
      const e = face[j];
      if (e === action) continue;
      if (
        e.next.length === 1 &&
        e.next[0] === 'next-sr' &&
        e.text === 'Cached preview' &&
        !Object.keys(e.attrs).length
      )
        continue;
      if (
        e.tag === 'input' &&
        e.attrs.type === 'file' &&
        e.attrs['aria-label'] === 'Choose photo'
      ) {
        // The chooser now lives in the Encode source dialog. first-visit operates
        // that actual dialog and checks its chooser before returning to the tile.
        continue;
      } else if (
        e.tag === 'button' &&
        e.next.length === 1 &&
        e.next[0] === 'next-face-empty' &&
        e.attrs['aria-label'] === 'Choose photo' &&
        e.text === 'Drop a photo, or tap to choose'
      ) {
        changed.push({
          region: e.region,
          next: ['next-face-hint'],
          attrs: {},
          text: 'Press Generate to make this face',
        });
        const icon = face[j + 1];
        if (
          icon &&
          !icon.tag &&
          !icon.next.length &&
          !icon.text &&
          JSON.stringify(icon.attrs) === '{"aria-hidden":"true"}'
        )
          j++;
      } else changed.push(e);
    }
    const at = changed.findIndex(
      (e) => e.next.includes('next-face-close') || e.next.includes('next-input-row'),
    );
    if (at >= 0)
      changed.splice(at, 0, { ...action, next: ['next-face-generate', 'next-face-operation'] });
    else changed.push(action);
    out.push(...changed);
    i = end - 1;
  }
  return out;
}

const key = (e) => JSON.stringify(e);

/**
 * Differences between two contracts as an ordered edit script over whole entries (longest common subsequence), so an
 * inserted, removed or changed control reports once, in place, instead of shifting every later comparison.
 * Returns [] when they are equal.
 */
export function diffContracts(control, subject) {
  const a = control.map(key),
    b = subject.map(key);
  const n = a.length,
    m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const diffs = [];
  let i = 0,
    j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (j < m && (i === n || lcs[i][j + 1] >= lcs[i + 1][j])) {
      diffs.push({ op: 'added', at: i, entry: subject[j] });
      j++;
    } else {
      diffs.push({ op: 'missing', at: i, entry: control[i] });
      i++;
    }
  }
  // An entry missing and one added at the same place is a change: report the pair together.
  const merged = [];
  for (let k = 0; k < diffs.length; k++) {
    const d = diffs[k],
      e = diffs[k + 1];
    if (
      d.op === 'missing' &&
      e?.op === 'added' &&
      e.at === d.at + 1 &&
      d.entry.region === e.entry.region
    ) {
      merged.push({ op: 'changed', at: d.at, control: d.entry, subject: e.entry });
      k++;
    } else if (
      d.op === 'added' &&
      e?.op === 'missing' &&
      e.at === d.at &&
      d.entry.region === e.entry.region
    ) {
      merged.push({ op: 'changed', at: d.at, control: e.entry, subject: d.entry });
      k++;
    } else merged.push(d);
  }
  return merged;
}

/**
 * Grade one row's steps. Parity rows compare exactly (any contract difference or a different step sequence fails);
 * changed and new rows are never compared to the control: they are emitted owner-graded with their owner.
 */
export function gradeRow(row, controlSteps, subjectSteps) {
  if (row.tag !== 'parity')
    return { rowId: row.rowId, verdict: 'owner-graded', owner: row.owner ?? null, tag: row.tag };
  if (!controlSteps.length)
    return { rowId: row.rowId, verdict: 'untested', reason: 'no control golden for this row' };
  const names = (steps) => steps.map((s) => s.step);
  if (JSON.stringify(names(controlSteps)) !== JSON.stringify(names(subjectSteps)))
    return {
      rowId: row.rowId,
      verdict: 'failed',
      reason: 'different step sequence',
      control: names(controlSteps),
      subject: names(subjectSteps),
    };
  const contract = (dom) =>
    row.rowId === 'first-visit' ? arrivalTileContract(contractOf(dom)) : contractOf(dom);
  const steps = controlSteps.map((c, i) => ({
    step: c.step,
    diffs: diffContracts(contract(c.dom), contract(subjectSteps[i].dom)),
  }));
  const failing = steps.filter((s) => s.diffs.length);
  return failing.length
    ? { rowId: row.rowId, verdict: 'failed', steps: failing }
    : { rowId: row.rowId, verdict: 'passed', steps: steps.length };
}
