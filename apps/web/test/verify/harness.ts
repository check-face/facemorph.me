// The integrated-verification harness's plain values (fm-48bj): the width sweep and grid counts every layout case
// uses, the text-input and seed variants, breakpoints read from the built CSS, and the case manifest each verify
// bead declares. No browser here; the operated input and the artifact fixture are in operated.ts and artifact.ts.

/** Viewport widths of the sweep, in CSS px (identical to face.many, fm-id4c, which imports them from here). */
export const SWEEP_WIDTHS = [320, 360, 390, 480, 600, 768, 900, 1024, 1280, 1920, 2560] as const;
/** Face counts of the grid cases. */
export const GRID_COUNTS = [1, 2, 3, 4, 8, 30, 64, 150] as const;
/** Repeating-control counts: faces and blend slots at 0 or 1, 2, 3 and many. */
export const FACE_COUNTS = [1, 2, 3, 30, 64, 150] as const;
export const SLOT_COUNTS = [0, 1, 2, 3, 16, 40, 100] as const;
/** A comfortable touch target; smaller ones are reported, never silently passed. */
export const TOUCH_TARGET_PX = 44;

export interface Viewport {
  readonly width: number;
  readonly height: number;
  readonly hasTouch: boolean;
  readonly isMobile: boolean;
}

/** The sweep's viewports: widths at or below the phone/tablet breakpoint run with touch emulation. */
export function sweepViewports(touchBreakpoint: number, height = 900): Viewport[] {
  return SWEEP_WIDTHS.map((width) => ({
    width,
    height,
    hasTouch: width <= touchBreakpoint,
    isMobile: width <= touchBreakpoint,
  }));
}

const utf8 = (s: string) => new TextEncoder().encode(s).length;

/** `bytes` UTF-8 bytes of text made of `unit` (multibyte allowed), padded with ASCII to land exactly. */
export function textOfBytes(bytes: number, unit = 'é'): string {
  let s = '';
  while (utf8(s + unit) <= bytes) s += unit;
  return s + 'a'.repeat(bytes - utf8(s));
}

export interface TextVariant {
  readonly id: string;
  readonly text: string;
  /** How it is entered: typed key by key, pasted at once, or composed through an IME. */
  readonly entry: 'type' | 'paste' | 'ime';
}

/** The text-input variants: empty, whitespace only, exactly 512 and 513 UTF-8 bytes with multibyte characters,
 * pasted, and IME composition. */
export function textVariants(): TextVariant[] {
  return [
    { id: 'empty', text: '', entry: 'type' },
    { id: 'whitespace', text: ' \t  ', entry: 'type' },
    { id: 'bytes-512', text: textOfBytes(512, '顔'), entry: 'paste' },
    { id: 'bytes-513', text: textOfBytes(513, '顔'), entry: 'paste' },
    { id: 'pasted', text: 'pasted words', entry: 'paste' },
    { id: 'ime', text: '顔写真', entry: 'ime' },
  ];
}

/** Numeric seed inputs: the uint32 range edges, just past them, a fraction, and pasted digits with spaces. */
export const SEEDS: readonly { readonly id: string; readonly text: string }[] = [
  { id: 'zero', text: '0' },
  { id: 'uint32-max', text: '4294967295' },
  { id: 'uint32-max-plus-1', text: '4294967296' },
  { id: 'minus-one', text: '-1' },
  { id: 'fraction', text: '1.5' },
  { id: 'pasted-spaces', text: ' 12 34 ' },
];

const REM_PX = 16;

function toPx(value: string, unit: string): number {
  const n = Number(value);
  return unit === 'px' ? n : n * REM_PX; // em and rem in media and container queries are the initial font size
}

/** Width breakpoints in px from built CSS: every min-width/max-width (and range-syntax width) in @media and
 * @container queries, px, em or rem. */
export function breakpoints(css: string): number[] {
  const found = new Set<number>();
  for (const rule of css.matchAll(/@(?:media|container)\b([^{]*)\{/g)) {
    const query = rule[1] ?? '';
    for (const m of query.matchAll(/(?:min|max)-width\s*:\s*([\d.]+)(px|r?em)\b/g))
      found.add(toPx(m[1] as string, m[2] as string));
    for (const m of query.matchAll(/width\s*(?:<=|>=|<|>)\s*([\d.]+)(px|r?em)\b/g))
      found.add(toPx(m[1] as string, m[2] as string));
    for (const m of query.matchAll(/([\d.]+)(px|r?em)\s*(?:<=|>=|<|>)\s*width\b/g))
      found.add(toPx(m[1] as string, m[2] as string));
  }
  return [...found].sort((a, b) => a - b);
}

/** Each breakpoint at -1, 0 and +1 px, deduplicated and sorted. */
export function aroundBreakpoints(points: readonly number[]): number[] {
  return [...new Set(points.flatMap((p) => [p - 1, p, p + 1]))].sort((a, b) => a - b);
}

/** A verify case: its steps and the flow-matrix rows or candidate defects it grades. */
export interface Case {
  readonly id: string;
  readonly steps: readonly string[];
  readonly rows?: readonly string[];
  readonly defects?: readonly number[];
  /** Lab cells it runs on (eris-webgpu, eris-cpu, phone-webgpu, phone-cpu) and emulated widths. */
  readonly cells?: readonly string[];
  readonly widths?: readonly number[];
}

export interface CaseManifest {
  readonly bead: string;
  readonly cases: readonly Case[];
}

export const LAB_CELLS = ['eris-webgpu', 'eris-cpu', 'phone-webgpu', 'phone-cpu'] as const;

/** Step IDs are `<bead key>/<case id>/<step>`. */
export const stepId = (bead: string, caseId: string, step: string) => `${bead}/${caseId}/${step}`;

/** Problems with a manifest; empty when it is valid. A case must grade at least one row or defect. */
export function manifestProblems(m: CaseManifest, knownRows?: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const name = /^[a-z0-9][a-z0-9.-]*$/;
  if (!name.test(m.bead)) out.push(`bead key ${JSON.stringify(m.bead)} is not a plan key`);
  const ids = new Set<string>();
  for (const c of m.cases) {
    const at = `${m.bead}/${c.id}`;
    if (!name.test(c.id)) out.push(`${at}: case id is not lower-case words`);
    if (ids.has(c.id)) out.push(`${at}: duplicate case id`);
    ids.add(c.id);
    if (!c.steps.length) out.push(`${at}: no steps`);
    for (const s of c.steps)
      if (!name.test(s)) out.push(`${at}/${s}: step is not lower-case words`);
    if (!(c.rows?.length || c.defects?.length))
      out.push(`${at}: maps to no flow-matrix row or candidate defect`);
    for (const r of c.rows ?? [])
      if (knownRows && !knownRows.has(r)) out.push(`${at}: unknown flow-matrix row ${r}`);
    for (const d of c.defects ?? [])
      if (!Number.isInteger(d) || d < 1) out.push(`${at}: defect ${d} is not a defect number`);
    for (const cell of c.cells ?? [])
      if (!(LAB_CELLS as readonly string[]).includes(cell))
        out.push(`${at}: unknown lab cell ${cell}`);
    for (const w of c.widths ?? [])
      if (!Number.isInteger(w) || w < 1) out.push(`${at}: width ${w} is not a px width`);
  }
  return out;
}
