// The golden recorder (fm-hn9e). The spike showed the control's Elmish model is observable on every React commit
// through a DevTools hook (elmish-probe.ts) while its messages are not (dispatch is private), so a golden is a
// journey step: the input action (where it was pressed or what was typed), the model after it, and the DOM state
// a person sees (faces area, dialogs, toasts: tags, classes, text, ARIA, focus). Volatile values are normalized:
// blob URLs to their order of appearance, durations and times in status text to <ms>, the date the control seeds to <today>.
// Privacy: photo bytes never enter (files and blobs are reduced to size and type), latents never enter (typed
// arrays are reduced to their length), and the only typed inputs are the spec's synthetic words and seeds.
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from 'playwright';
import { READ_MODEL } from './elmish-probe.ts';

export const GOLDENS = new URL('../goldens/', import.meta.url);

export interface Action {
  readonly kind: 'load' | 'press' | 'touch' | 'type' | 'key' | 'wait';
  readonly target?: string;
  readonly at?: { readonly x: number; readonly y: number };
  readonly text?: string;
}

export interface Step {
  readonly step: string;
  readonly action: Action;
  readonly commits: number;
  readonly model: unknown;
  readonly dom: unknown;
  readonly focused: string | null;
}

const DOM_IN_PAGE = `(() => {
  const generated = (c) => /^(Mui|css-|jss)/.test(c);
  const walk = (el, depth) => {
    const node = { tag: el.tagName.toLowerCase() };
    const classes = [...el.classList].filter((c) => !generated(c)).sort();
    if (classes.length) node.classes = classes;
    const attrs = {};
    for (const a of ['role', 'aria-label', 'aria-expanded', 'aria-valuenow', 'aria-hidden', 'disabled', 'type', 'value']) if (el.hasAttribute(a)) attrs[a] = el.getAttribute(a);
    for (const a of el.getAttributeNames()) if (a.startsWith('data-next')) attrs[a] = el.getAttribute(a);
    if ('value' in el && typeof el.value === 'string' && el.tagName !== 'BUTTON') attrs.value = el.value;
    if (el.disabled === true) attrs.disabled = 'true';
    if (Object.keys(attrs).length) node.attrs = attrs;
    if (node.tag === 'svg' || node.tag === 'canvas' || node.tag === 'img' || node.tag === 'video') return node;
    const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/\\s+/g, ' ').trim();
    if (text) node.text = text;
    if (depth < 40) { const children = [...el.children].map((c) => walk(c, depth + 1)); if (children.length) node.children = children; }
    return node;
  };
  const pick = (sel) => [...document.querySelectorAll(sel)].map((el) => walk(el, 0));
  const f = document.activeElement;
  return {
    dom: { faces: pick('.next-faces-area'), dialogs: pick('[role=dialog], .next-download-dialog, .next-crop-dialog'), toasts: pick('.next-consent-toast'), notes: pick('.next-estimate, .next-slow-route, .next-error') },
    focused: f && f !== document.body ? f.tagName.toLowerCase() + (f.getAttribute('aria-label') ? '[' + f.getAttribute('aria-label') + ']' : '') : null,
  };
})()`;

/** Replaces volatile values so a re-recording of the same flow is comparable. */
export function normalize(value: unknown, blobs: Map<string, string> = new Map()): unknown {
  if (typeof value === 'string') {
    let s = value.replace(/blob:[^\s"')]+/g, (url) => {
      if (!blobs.has(url)) blobs.set(url, `blob:<${blobs.size + 1}>`);
      return blobs.get(url) as string;
    });
    s = s.replace(/\b\d+(\.\d+)?\s?(ms|s|seconds?|minutes?|min)\b/g, '<ms>');
    s = s.replace(/^\d{4}-\d{2}-\d{2}$/, '<today>'); // the control seeds a face with the visit's date
    return s;
  }
  if (Array.isArray(value)) return value.map((v) => normalize(v, blobs));
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v, blobs)]));
  return value;
}

export class Recorder {
  readonly steps: Step[] = [];
  readonly #blobs = new Map<string, string>();
  readonly page: Page;
  readonly rowId: string;
  constructor(page: Page, rowId: string) {
    this.page = page;
    this.rowId = rowId;
  }

  async record(step: string, action: Action): Promise<Step> {
    const { commits, model } = (await this.page.evaluate(READ_MODEL)) as {
      commits: number;
      model: unknown;
    };
    const { dom, focused } = (await this.page.evaluate(DOM_IN_PAGE)) as {
      dom: unknown;
      focused: string | null;
    };
    const s: Step = {
      step,
      action,
      commits,
      model: normalize(model, this.#blobs),
      dom: normalize(dom, this.#blobs),
      focused,
    };
    this.steps.push(s);
    return s;
  }

  /** Writes test/goldens/control/<rowId>/<nn>-<step>.json. */
  write(): string[] {
    const dir = new URL(`control/${this.rowId}/`, GOLDENS);
    mkdirSync(dir, { recursive: true });
    return this.steps.map((s, i) => {
      const name = `${String(i + 1).padStart(2, '0')}-${s.step}.json`;
      writeFileSync(new URL(name, dir), JSON.stringify(s, null, 1) + '\n');
      return `control/${this.rowId}/${name}`;
    });
  }
}
