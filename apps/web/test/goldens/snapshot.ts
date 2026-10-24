// The shell rows' DOM as a comparable value, taken in the page by the recorder (from the control) and the replay
// (from this build). Kept: element tags and their order, the `.next-*` and other authored classes, text, link
// targets, ARIA and data attributes. Dropped: class names MUI or Emotion generate (they differ between MUI 4 and
// 9 by construction), the build's own version, and the per-device fields of the issue link (version, device).

export interface Node {
  tag: string;
  classes?: string[];
  attrs?: Record<string, string>;
  text?: string;
  children?: Node[];
}

export interface Row {
  /** Flow-row id, e.g. `shell.footer`. */
  readonly id: string;
  /** CSS selector of the row's root in the page. */
  readonly selector: string;
  /** parity rows must match exactly; repair and declared rows are owner-graded, never asserted. */
  readonly freeze: 'parity' | `repair:${number}` | `declared:${string}`;
  readonly note?: string;
}

export const SHELL_ROWS: readonly Row[] = [
  { id: 'shell.root', selector: 'main.next-product', freeze: 'parity', note: 'Root element only (classes, data-next-busy); its content is the other rows and the screens.' },
  { id: 'shell.preview-strip', selector: 'aside.next-preview-strip', freeze: 'parity' },
  { id: 'shell.header', selector: 'main.next-product > header', freeze: 'parity' },
  { id: 'shell.tagline', selector: 'p.next-tagline', freeze: 'parity' },
  { id: 'shell.footer', selector: 'footer.next-footer', freeze: 'parity', note: "The version line's value is this build's commit; the issue link's version and device fields are the visitor's." },
];

/** Evaluated in the page: (rows) => {id: Node | null}. Self-contained (no closure over module scope). */
export const SNAPSHOT_IN_PAGE = `(rows) => {
  const generated = (c) => /^(Mui|css-|jss)/.test(c);
  const issue = (href) => {
    try {
      const u = new URL(href, location.href);
      if (u.hostname !== 'github.com' || !u.pathname.endsWith('/issues/new')) return href;
      const keep = new URLSearchParams();
      for (const k of ['template', 'labels', 'title']) if (u.searchParams.has(k)) keep.set(k, u.searchParams.get(k));
      return u.origin + u.pathname + '?' + keep.toString() + ' (+' + [...u.searchParams.keys()].filter((k) => !keep.has(k)).sort().join(',') + ')';
    } catch { return href; }
  };
  const walk = (el, deep) => {
    const node = { tag: el.tagName.toLowerCase() };
    const classes = [...el.classList].filter((c) => !generated(c)).sort();
    if (classes.length) node.classes = classes;
    const attrs = {};
    for (const a of ['href', 'target', 'rel', 'role', 'aria-label', 'aria-hidden']) if (el.hasAttribute(a)) attrs[a] = a === 'href' ? issue(el.getAttribute(a)) : el.getAttribute(a);
    for (const a of el.getAttributeNames()) if (a.startsWith('data-next-')) attrs[a] = el.getAttribute(a);
    if (Object.keys(attrs).length) node.attrs = attrs;
    if (node.tag === 'svg') return node;
    const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/\\s+/g, ' ').trim()
      .replace(/^Preview version \\S+$/, 'Preview version <build>');
    if (text) node.text = text;
    if (deep) {
      const children = [...el.children].map((c) => walk(c, true));
      if (children.length) node.children = children;
    }
    return node;
  };
  const out = {};
  for (const row of rows) {
    const el = document.querySelector(row.selector);
    out[row.id] = el ? walk(el, row.id !== 'shell.root') : null;
  }
  return out;
}`;
