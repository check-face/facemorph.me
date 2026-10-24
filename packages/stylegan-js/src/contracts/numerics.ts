// Synthesis numerical and export-quality rules. Raw pre-compression synthesis is compared with the
// independent qualified reference (same model, latent, noise, preprocessing and workload) on each
// qualified CPU/WebGPU route; these tolerances never widen. Research suites (full31 and others)
// keep their own frozen tolerances, other models need their own references, and encoder lab checks
// stay in lab/CI rather than running per visitor. Model, artifact and asset hashes bind inputs,
// manifests, packages and deployments; an export-integrity hash validates one file only.

export interface ToleranceSource {
  /** Candidate file (classic a42829b) that enforces the value today. */
  readonly file: string;
  /** Suite whose comparisons it governs. */
  readonly suite: string;
}

/** Product canaries: raw synthesis against the qualified reference. */
export const PRODUCT_CANARY_TOLERANCE = Object.freeze({
  /** Largest RGB channel difference on 0-255, alpha excluded. */
  maxRgbDiff: 1,
  /** Largest error of the sampled raw float output. */
  maxSampledRawFloatError: 0.002,
  source: Object.freeze({
    file: 'src/Next/browser/canary-qualification.mjs',
    suite: 'product synthesis canaries (route qualification before user work)',
  }) satisfies ToleranceSource,
});

/** Photo encoder (e4e) W+ latent against the pinned reference. */
export const E4E_LATENT_TOLERANCE = Object.freeze({
  maxAbsError: 0.0001,
  source: Object.freeze({
    file: 'src/Next/browser/encoder-preflight.mjs',
    suite: 'photo encoder canary (pinned input tensor and reference W+)',
  }) satisfies ToleranceSource,
});

/** A comparison's raw differences, not only its verdict. */
export interface NumericalCheckResult {
  readonly name: string;
  readonly route: string;
  readonly maxRgbDiff?: number;
  readonly maxSampledRawFloatError?: number;
  readonly maxAbsError?: number;
  readonly passed: boolean;
}

export function checkSynthesis(
  name: string,
  route: string,
  maxRgbDiff: number,
  maxSampledRawFloatError: number,
): NumericalCheckResult {
  const t = PRODUCT_CANARY_TOLERANCE;
  return {
    name,
    route,
    maxRgbDiff,
    maxSampledRawFloatError,
    passed:
      Number.isFinite(maxRgbDiff) &&
      Number.isFinite(maxSampledRawFloatError) &&
      maxRgbDiff <= t.maxRgbDiff &&
      maxSampledRawFloatError <= t.maxSampledRawFloatError,
  };
}

export function checkE4eLatent(
  name: string,
  route: string,
  maxAbsError: number,
): NumericalCheckResult {
  return {
    name,
    route,
    maxAbsError,
    passed: Number.isFinite(maxAbsError) && maxAbsError <= E4E_LATENT_TOLERANCE.maxAbsError,
  };
}

export type ExportQualityRuleId =
  | 'dimensions'
  | 'orientation'
  | 'valid-format-and-playback'
  | 'lossless-decode-equals-supplied-pixels'
  | 'recovery-envelope-regenerated'
  | 'encoded-byte-identity'
  | 'decoded-lossy-equality';

export interface ExportQualityRule {
  readonly id: ExportQualityRuleId;
  /** A gate fails the export; a non-gate is reported only. */
  readonly isGate: boolean;
  readonly rule: string;
}

/**
 * Exported image compression and container bytes may differ between routes and browsers, so the
 * candidate's inherited image-hash assertions map to the two `isGate: false` rules.
 */
export const EXPORT_QUALITY_RULES: readonly ExportQualityRule[] = Object.freeze(
  (
    [
      { id: 'dimensions', isGate: true, rule: 'The file has the declared width and height.' },
      {
        id: 'orientation',
        isGate: true,
        rule: 'The file displays upright, with no orientation transform left to apply.',
      },
      {
        id: 'valid-format-and-playback',
        isGate: true,
        rule: 'The file decodes as its declared format; a video plays to its end.',
      },
      {
        id: 'lossless-decode-equals-supplied-pixels',
        isGate: true,
        rule: 'A lossless export decodes to exactly the supplied pixels.',
      },
      {
        id: 'recovery-envelope-regenerated',
        isGate: true,
        rule: 'Re-encoding regenerates the recovery envelope; an obsolete integrity hash is never copied.',
      },
      {
        id: 'encoded-byte-identity',
        isGate: false,
        rule: 'Encoded bytes match a reference file (informational).',
      },
      {
        id: 'decoded-lossy-equality',
        isGate: false,
        rule: 'A lossy export decodes to the reference pixels (informational).',
      },
    ] satisfies ExportQualityRule[]
  ).map((r) => Object.freeze(r)),
);
