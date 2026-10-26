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
// layout is compared as-is, so a missing/misplaced action or changed label still fails. Since the
// operator's card-entry correction (26 October) the card keeps its own chooser and Generate stays
// beside the field, as in the retained layout; only their names and the operation class change.
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
      if (e === action) {
        // The one operation action, in its retained place beside the field.
        changed.push({ ...action, next: ['next-face-generate', 'next-face-operation'] });
        continue;
      }
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
        // The card's own chooser, renamed: photo entry reads Encode image.
        changed.push({ ...e, attrs: { ...e.attrs, 'aria-label': 'Encode image' } });
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
    out.push(...changed);
    i = end - 1;
  }
  return out;
}

// fm-szbf's declared arrival change (defect 16): the first-visit model prompt moved out of the toast
// layer into the page below the morph controls, as a labelled region whose actions sit in their own
// row. Applied to the retained prompt only; the new layout is compared as-is, so a missing label, the
// old alert role or a missing actions row still fails.
export function arrivalPromptContract(entries) {
  const out = [];
  let inPrompt = false;
  let wrapped = false;
  for (const e of entries) {
    if (
      e.region === 'toasts' &&
      !e.tag &&
      JSON.stringify(e.next) === JSON.stringify(['next-consent-toast', 'next-model-toast']) &&
      JSON.stringify(e.attrs) === JSON.stringify({ role: 'alert' })
    ) {
      out.push({
        ...e,
        next: ['next-consent-toast', 'next-first-visit', 'next-model-toast'],
        attrs: { 'aria-label': 'Face model download', role: 'region' },
      });
      inPrompt = true;
      wrapped = false;
      continue;
    }
    if (inPrompt && e.region !== 'toasts') inPrompt = false;
    if (inPrompt && !wrapped && e.tag === 'button') {
      out.push({ region: 'toasts', next: ['next-first-visit-actions'], attrs: {}, text: '' });
      wrapped = true;
    }
    out.push(e);
  }
  return out;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const text = (region, t, next = []) => ({ region, next, attrs: {}, text: t });

// fm-36ag's declared morph options (operator, 26 October): Length counts frames per face and offers Custom, the total
// also says the video length, and a Video size choice (Standard 512 × 512 by default) follows. Applied to the
// retained options only; the new options are compared as-is.
export function morphOptionsContract(entries) {
  const out = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const option = /^(Length: \w+ · \d+) frames per segment$/.exec(e.text);
    if (option && e.region === 'faces' && !e.next.length) {
      out.push({ ...e, text: `${option[1]} frames per face` });
      if (!(entries[i + 1]?.text ?? '').endsWith('frames per segment'))
        out.push(text(e.region, 'Custom · choose frames per face'));
      continue;
    }
    const total = /^(\d+) frames total$/.exec(e.text);
    if (total && same(e.next, ['next-frame-count'])) {
      const r = e.region;
      // The Video size select is disabled exactly when Length is (while a morph runs).
      const length = [...out].reverse().find((x) => x.attrs?.['aria-label'] === 'Morph length');
      const disabled = length?.attrs?.disabled ? { disabled: length.attrs.disabled } : {};
      out.push(
        { ...e, text: `${total[1]} frames total · <ms> video` },
        text(r, '', ['next-shape-controls']),
        text(r, '', ['next-overflow-field']),
        text(r, 'Video'),
        {
          region: r,
          tag: 'select',
          next: [],
          attrs: { 'aria-label': 'Video size', ...disabled },
          text: '',
        },
        text(r, 'Standard · 512 × 512'),
        text(r, 'Full quality · up to 1024 × 1024'),
        text(r, 'Quicker, smaller files that play everywhere.', ['next-frame-count']),
      );
      continue;
    }
    out.push(e);
  }
  return out;
}

// fm-szbf's declared debug-report prompt (defect 16 and the disclosure copy): the retained consent toast becomes a
// labelled region whose actions sit in their own row, with the standing-reporting wording. Applied to the retained
// toast only; the new prompt is compared as-is.
const RETAINED_DEBUG =
  'Send debug reports: timings, device type and error codes. Never your photos, words or faces. Kept with no deletion date.';
export const DECLARED_DEBUG =
  'Debug reporting sends timings, device type and error codes from now on, until you turn it off. Never your photos, words or faces. Kept with no deletion date.';
export function debugPromptContract(entries) {
  const out = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (
      e.region === 'toasts' &&
      same(e.next, ['next-consent-toast']) &&
      same(e.attrs, { role: 'alert' }) &&
      entries[i + 1]?.text === RETAINED_DEBUG &&
      entries[i + 2]?.text === 'Help us test?' &&
      entries[i + 3]?.text === 'Turn on'
    ) {
      out.push(
        {
          ...e,
          next: ['next-consent-prompt', 'next-consent-toast', 'next-first-visit'],
          attrs: { 'aria-label': 'Debug reporting', role: 'region' },
        },
        { ...entries[i + 1], text: DECLARED_DEBUG },
        entries[i + 2],
        text(e.region, '', ['next-first-visit-actions']),
        { ...entries[i + 3], text: 'Turn on debug reporting' },
      );
      i += 3;
      continue;
    }
    out.push(e);
  }
  return out;
}

// fm-25um's declared tile states: typed words show no instant picture ("Press Generate to make this face", the tile
// stays empty), and a tile holding its verified face offers no Generate until its input changes. Applied to the
// retained tiles only; the new tiles are compared as-is.
export function tileStatesContract(entries) {
  const out = [];
  let state = null;
  for (const e of entries) {
    if (e.next.includes('next-face') && e.attrs['data-next-state']) {
      state = e.attrs['data-next-state'];
      out.push(
        state === 'preview' ? { ...e, attrs: { ...e.attrs, 'data-next-state': 'empty' } } : e,
      );
      continue;
    }
    if (
      state === 'preview' &&
      same(e.next, ['next-face-img']) &&
      !e.text &&
      !Object.keys(e.attrs).length
    ) {
      out.push(text(e.region, 'Press Generate to make this face', ['next-face-hint']));
      continue;
    }
    if (state === 'filled' && e.tag === 'button' && e.next.includes('next-face-generate')) continue;
    out.push(e);
  }
  return out;
}

// fm-gbdt's declared native retirement: the notes' desktop-app link is gone (no desktop or native app is offered).
export const retiredLinksContract = (entries) =>
  entries.filter(
    (e) =>
      !(
        e.region === 'notes' &&
        e.tag === 'a' &&
        e.text === 'Desktop app capabilities and availability'
      ),
  );

// fm-vbj7's declared whole-action progress: a face generated for a morph reads "Generating this face…", not a
// face counter.
export const progressContract = (entries) =>
  entries.map((e) =>
    e.region === 'faces' &&
    /^Face \d+ of \d+$/.test(e.text) &&
    !e.next.length &&
    !Object.keys(e.attrs).length
      ? { ...e, text: 'Generating this face…' }
      : e,
  );

// fm-qrfz's declared change: the face model's size counts the correctness canaries and sample indices the worker
// fetches before the first face (model-inventory.mjs routeAssets), so for the same pinned runtime the subject shows
// about 10 MB more than the control. Only that figure is replaced, on both sides; its value is pinned against the
// runtime manifest by model-inventory.test.mjs and apps/web/src/consent/requests.test.ts.
const FACE_MODEL_SIZE = /(face model once(?: \(|: ))\d+(?:\.\d+)? (?:MB|GB)/;
const DOWNLOAD_SIZE = /^(Download · )\d+(?:\.\d+)? (?:MB|GB)$/;
export function modelSizeContract(entries) {
  return entries.map((e) =>
    typeof e.text !== 'string'
      ? e
      : FACE_MODEL_SIZE.test(e.text)
        ? { ...e, text: e.text.replace(FACE_MODEL_SIZE, '$1<face model size>') }
        : e.tag === 'button' && DOWNLOAD_SIZE.test(e.text)
          ? { ...e, text: e.text.replace(DOWNLOAD_SIZE, '$1<face model size>') }
          : e,
  );
}

// fm-36ag/fm-fy2.9's declared result disclosure: the video's actual size sits beside its Share and Save, and the
// default video is 512 × 512.
export function videoFormatContract(entries) {
  const out = [];
  for (let i = 0; i < entries.length; i++) {
    out.push(entries[i]);
    if (
      same(entries[i].next, ['next-actions']) &&
      entries[i + 1]?.tag === 'button' &&
      entries[i + 1].text === 'Share morph' &&
      !entries.some((e) => e.next.includes('next-video-format'))
    )
      out.push({
        region: entries[i].region,
        next: ['next-video-format'],
        attrs: { 'data-next-video-width': '512' },
        text: 'MP4 · 512 × 512',
      });
  }
  return out;
}

// fm-25um's declared seed field: a numeric text field (inputmode numeric) that keeps what was typed literally.
export const seedFieldContract = (entries) =>
  entries.map((e) =>
    e.region === 'faces' && e.tag === 'input' && same(e.attrs, { type: 'number' })
      ? { ...e, attrs: { type: 'text' } }
      : e,
  );

// fm-25um's declared mode switch (controller 'switching to seed keeps literal text, including a date; it never strips
// digits into another seed'): the seed.generate row switches a tile holding today's date to Numeric seed, where the
// retained number field showed nothing to fix. The tile now keeps the date, says what a seed is and cannot Generate.
// Scoped to that one recorded step.
export function seedLiteralContract(entries) {
  const out = [];
  let face = null;
  for (const e of entries) {
    if (e.next.includes('next-face') && e.attrs['data-next-face']) face = e.attrs['data-next-face'];
    if (
      face === 'face-2' &&
      same(e.next, ['next-face-hint']) &&
      e.text === 'Press Generate to make this face'
    ) {
      out.push({ ...e, text: '' });
      continue;
    }
    if (
      face === 'face-2' &&
      e.tag === 'button' &&
      e.attrs['aria-label'] === 'Generate Morph to' &&
      !e.attrs.disabled
    ) {
      out.push(text(e.region, 'Use a whole number from 0 to 4294967295.'), {
        ...e,
        attrs: { 'aria-label': e.attrs['aria-label'], disabled: 'true', type: e.attrs.type },
      });
      continue;
    }
    out.push(e);
  }
  return out;
}
// fm-25um's declared Retry: a cancelled tile offers Retry (the same input, no keystroke) as its operation action.
// Scoped to the retry-unchanged row's recorded cancellation.
export const cancelledRetryContract = (entries) =>
  entries.map((e) =>
    e.tag === 'button' &&
    e.next.includes('next-face-operation') &&
    e.attrs['aria-label'] === 'Generate Morph to' &&
    !e.attrs.disabled
      ? { ...e, attrs: { ...e.attrs, 'aria-label': 'Retry Morph to' }, text: 'Retry' }
      : e,
  );
const DECLARED_STEPS = {
  'seed.generate/seed-mode': seedLiteralContract,
  'retry-unchanged/cancelled': cancelledRetryContract,
};

// fm-25um's declared running tile: its one operation action becomes Cancel while it runs (enabled, named for the
// tile), replacing the retained status Cancel beside a disabled Generate. Applied to the retained running tile only.
export function runningCancelContract(entries) {
  const out = [];
  let running = false;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.next.includes('next-face') && e.attrs['data-next-face']) running = false;
    if (
      e.tag === 'button' &&
      e.text === 'Cancel' &&
      !e.next.length &&
      same(e.attrs, { type: 'button' }) &&
      entries[i - 2]?.next.includes('next-tile-status')
    ) {
      running = true;
      continue;
    }
    if (
      running &&
      e.tag === 'button' &&
      e.next.includes('next-face-operation') &&
      e.attrs.disabled
    ) {
      const label = String(e.attrs['aria-label']).replace(/^Generate /, '');
      out.push({
        ...e,
        attrs: { 'aria-label': `Cancel ${label}`, type: e.attrs.type },
        text: 'Cancel',
      });
      continue;
    }
    out.push(e);
  }
  return out;
}

const DOWNLOADING = /^Downloading model files…( \d+ MB of \d+ MB)?$/;
/**
 * fm-vbj7's declared whole-action progress: the action reports its own stages (the model download with bytes, then
 * 'Generating…') on its status line and a determinate bar, where the retained app showed the action's start with an
 * indeterminate bar. Only in a step where the control showed the action starting, those stage lines read as that
 * start and the bars as the retained indeterminate bar; every other entry of the step still compares.
 */
export function acquisitionPair(control, subject) {
  const starting = new Set(
    control.filter((e) => /^Generating this face…$/.test(e.text)).map((e) => e.text),
  );
  const reporting = subject.some((e) => DOWNLOADING.test(e.text) || e.text === 'Generating…');
  if (!starting.size || !reporting) return [control, subject];
  const start = [...starting][0];
  return [
    control,
    subject.map((e) => {
      // The download, and then synthesis ('Generating…'), are the action's own stages.
      if (DOWNLOADING.test(e.text) || e.text === 'Generating…') return { ...e, text: start };
      if (same(e.next, ['next-progress-fill']))
        return { ...e, next: ['next-progress-fill', 'next-progress-indeterminate'] };
      if (e.next.includes('next-face-progress') && e.attrs['aria-valuenow'] !== undefined) {
        const { 'aria-valuenow': _, ...attrs } = e.attrs;
        return { ...e, attrs };
      }
      if (e.next.includes('next-face-progress-determinate'))
        return { ...e, next: e.next.filter((c) => c !== 'next-face-progress-determinate') };
      return e;
    }),
  ];
}

/** Entries of the debug-report prompt (as declared) or the first-visit model prompt, by their root's classes. */
function promptSpans(entries, root) {
  const spans = [];
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].region !== 'toasts' || !root(entries[i].next)) continue;
    let j = i + 1;
    while (
      j < entries.length &&
      entries[j].region === 'toasts' &&
      !entries[j].next.includes('next-consent-toast')
    )
      j++;
    spans.push([i, j]);
    i = j - 1;
  }
  return spans;
}
const isDebugPrompt = (next) => next.includes('next-consent-prompt');
const isModelPrompt = (next) => next.includes('next-model-toast');
const without = (entries, spans) =>
  entries.filter((_, k) => !spans.some(([a, b]) => k >= a && k < b));

/**
 * fm-szbf's declared one-prompt rule (defect 16: the first visit stacked two bottom prompts): before the first face
 * the model prompt is the one prompt shown, and debug reporting is asked afterwards. Where the control showed its
 * debug prompt instead of the model prompt, neither prompt is compared for that step; the first-visit row compares
 * the arrival prompt exactly, and every other control and step still compares as-is.
 */
export function onePromptPair(control, subject) {
  const cDebug = promptSpans(control, isDebugPrompt),
    cModel = promptSpans(control, isModelPrompt),
    sDebug = promptSpans(subject, isDebugPrompt),
    sModel = promptSpans(subject, isModelPrompt);
  // Either order: before the first face the one prompt is the model prompt, and during it the debug prompt may follow.
  if (cDebug.length && !cModel.length && sModel.length && !sDebug.length)
    return [without(control, cDebug), without(subject, sModel)];
  if (cModel.length && !cDebug.length && sDebug.length && !sModel.length)
    return [without(control, cModel), without(subject, sDebug)];
  return [control, subject];
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
  // The declared changes apply wherever their controls appear, not only on arrival (fm-fy2.5).
  const declared = [
    arrivalTileContract, // fm-25um, fm-fy2.17.1
    arrivalPromptContract, // fm-szbf
    tileStatesContract, // fm-25um
    morphOptionsContract, // fm-36ag
    debugPromptContract, // fm-szbf
    retiredLinksContract, // fm-gbdt
    progressContract, // fm-vbj7
    videoFormatContract, // fm-36ag, fm-fy2.9
    seedFieldContract, // fm-25um
    runningCancelContract, // fm-25um
    modelSizeContract, // fm-qrfz
  ];
  const contract = (dom, step) =>
    [...declared, ...[DECLARED_STEPS[`${row.rowId}/${step}`] ?? []].flat()].reduce(
      (entries, f) => f(entries),
      contractOf(dom),
    );
  const steps = controlSteps.map((c, i) => ({
    step: c.step,
    diffs: diffContracts(
      ...acquisitionPair(
        ...onePromptPair(contract(c.dom, c.step), contract(subjectSteps[i].dom, c.step)),
      ),
    ),
  }));
  const failing = steps.filter((s) => s.diffs.length);
  return failing.length
    ? { rowId: row.rowId, verdict: 'failed', steps: failing }
    : { rowId: row.rowId, verdict: 'passed', steps: steps.length };
}
