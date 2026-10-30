// Export names for one session (fm-eeki): the app's known export set over the contracts' identity and
// filename rules (contracts/export-identity.ts). No DOM, no Save/Share: the app hands in what a result is
// made of and gets back the filename, MIME type and identity digest to use for every Save and Share of it.
// The same identity always gets the name it got first; a different identity whose name would collide is
// given a longer suffix. Labels live only in the filename: nothing here logs, stores or reports them.
import {
  exportIdentity,
  labelFromSource,
  sha256Hex,
  suggestFilename,
  withEditedName,
  type ExportIdentity,
  type ExportIdentityInput,
  type ExportJson,
  type ExportKind,
  type ExportLabelSource,
  type ExportName,
  type KnownExport,
} from '../contracts/export-identity.ts';

/** A blend's saved recipe as export naming needs it (stylegan-js BlendRecipe; this module also runs unbundled). */
export interface BlendRecipeFacts {
  readonly slots: readonly { readonly kind: string; readonly latentSha256: string; readonly weight: number }[];
}
/** stylegan-js blendExportInputs: each slot's kind, latent digest and weight; the label `blend-<n>-faces`. */
const blendInputs = (recipe: BlendRecipeFacts): string[] =>
  recipe.slots.map((s) => `blend:${s.kind}:${s.latentSha256}:${JSON.stringify(s.weight)}`);

export interface NamedExport extends ExportName {
  readonly digest: string;
  readonly identity: ExportIdentity;
}

export interface ExportNamer {
  /** The name for this identity in the session's known set; recorded so later exports never take it. */
  readonly name: (input: ExportIdentityInput, label?: ExportLabelSource, retainedDigest?: string) => NamedExport;
  /** A person's edit of the name: their text, the identity's own suffix and the real extension. */
  readonly rename: (identity: ExportIdentity, editedName: string) => NamedExport;
  readonly known: () => readonly KnownExport[];
}

export function exportNamer(): ExportNamer {
  const known: KnownExport[] = [];
  const kinds = new Map<string, ExportKind>();
  const record = (identity: ExportIdentity): NamedExport => {
    if (kinds.has(identity.digest) && kinds.get(identity.digest) !== identity.kind)
      throw new Error('A retained export digest cannot identify different formats.');
    const name = suggestFilename(identity, known);
    const at = known.findIndex((k) => k.digest === identity.digest);
    if (at < 0) known.push({ digest: identity.digest, filename: name.filename });
    kinds.set(identity.digest, identity.kind);
    return { ...name, digest: identity.digest, identity };
  };
  return {
    name(input, label, retainedDigest) {
      const identity = exportIdentity(input, label);
      if (retainedDigest !== undefined) {
        if (typeof retainedDigest !== 'string' || !/^[0-9a-f]{64}$/u.test(retainedDigest))
          throw new Error('A retained export digest must be a lowercase SHA-256.');
        return record({ ...identity, digest: retainedDigest });
      }
      return record(identity);
    },
    rename(identity, editedName) {
      const edited = withEditedName(identity, editedName);
      // The edited name replaces the identity's earlier name in the known set.
      const at = known.findIndex((k) => k.digest === identity.digest);
      if (at >= 0) known.splice(at, 1);
      return record(edited);
    },
    known: () => [...known],
  };
}

/** Only identity digests survive reload: labels, names and source facts never enter this map. */
export type StillExportDigests = Readonly<Partial<Record<'webp' | 'png', string>>>;
export function retainedExportDigests(value: unknown): StillExportDigests {
  if (!value || typeof value !== 'object') return {};
  const source = value as Record<string, unknown>;
  const clean: Partial<Record<'webp' | 'png', string>> = {};
  for (const format of ['webp', 'png'] as const) {
    const digest = source[format];
    if (typeof digest === 'string' && /^[0-9a-f]{64}$/u.test(digest)) clean[format] = digest;
  }
  // Valid identities include their format; an ambiguous imported map is not reusable.
  if (clean.webp && clean.webp === clean.png) return {};
  return clean;
}

/** The face facts the app holds, as plain values. */
export interface FaceExportFacts {
  readonly source?: { readonly mode?: string; readonly value?: string; readonly fileName?: string } | undefined;
  /** SHA-256 of the latent when the runtime reported it; otherwise `latentValues` is hashed here. */
  readonly latentSha256?: string | undefined;
  readonly latentValues?: Float32Array | undefined;
  readonly modelIdentity: string;
  /** A blend view result's recipe (fm-2kse): each slot's kind, latent digest and weight. */
  readonly blend?: BlendRecipeFacts | undefined;
}

/** The latent's identity: the reported digest, or SHA-256 over its float bytes. */
export function latentIdentity(facts: Pick<FaceExportFacts, 'latentSha256' | 'latentValues'>): string {
  if (facts.latentSha256 && /^[0-9a-f]{64}$/u.test(facts.latentSha256)) return facts.latentSha256;
  const values = facts.latentValues;
  if (!values) throw new Error('A face export needs its latent.');
  return sha256Hex(new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
}

/**
 * What a face was made from, as the synthesis consumed it: the entered text or seed when there is one, and
 * always the latent it shows. These are hashed into the identity, never written out.
 */
export function inputIdentities(facts: FaceExportFacts): string[] {
  const source = facts.source;
  // A blend is named by its slots and weights, so blends differing in any weight get different identities.
  if (facts.blend) return [...blendInputs(facts.blend), `latent:${latentIdentity(facts)}`];
  const given = (source?.mode === 'text' || source?.mode === 'seed') && source.value ? [`${source.mode}:${source.value}`] : [];
  return [...given, `latent:${latentIdentity(facts)}`];
}

/** The best label a face has: entered text, its seed, or the photo's basename; none after a restore. */
export function faceLabel(source: FaceExportFacts['source'], blend?: BlendRecipeFacts): ExportLabelSource | undefined {
  if (blend) return { origin: 'result-name', text: `blend-${blend.slots.length}-faces` };
  if (!source) return undefined;
  if (source.mode === 'text' && source.value) return { origin: 'entered-text', text: source.value };
  if (source.mode === 'seed' && source.value) return { origin: 'seed', text: source.value };
  if (source.mode === 'photo' && source.fileName) return { origin: 'source-basename', text: source.fileName };
  return undefined;
}

/** The identity input for a still: the latent it shows, the model, the container and its options. */
export function stillExport(
  facts: FaceExportFacts,
  kind: Exclude<ExportKind, 'mp4'>,
  encodingOptions: ExportJson,
): ExportIdentityInput {
  return {
    kind,
    crops: [],
    orderedInputs: inputIdentities(facts),
    modelIdentity: facts.modelIdentity,
    format: kind,
    encodingOptions,
  };
}

/** The identity input for a morph video: its ordered faces, mode and settings, model and encoder. */
export function morphExport(
  faces: readonly FaceExportFacts[],
  morph: { readonly mode: string; readonly settings: ExportJson },
  modelIdentity: string,
  encodingOptions: ExportJson,
): ExportIdentityInput {
  return {
    kind: 'mp4',
    crops: [],
    orderedInputs: faces.flatMap(inputIdentities),
    morph,
    modelIdentity,
    format: 'mp4',
    encodingOptions,
  };
}

/**
 * A morph's label: the first and last faces' labels, the face count when there are more than two, and
 * the mode, e.g. `emma-noah-linear`. Faces without a label are left out; none at all means `morph`.
 */
export function morphLabel(faces: readonly FaceExportFacts[], mode: string): ExportLabelSource | undefined {
  const words = faces.map((f) => {
    const label = faceLabel(f.source);
    return label ? labelFromSource(label) : '';
  });
  const first = words[0] ?? '',
    last = words.at(-1) ?? '';
  if (!first && !last) return undefined;
  const parts = [first, last].filter(Boolean);
  if (faces.length > 2) parts.push(`${faces.length}-faces`);
  parts.push(mode);
  return { origin: 'result-name', text: parts.join('-') };
}
