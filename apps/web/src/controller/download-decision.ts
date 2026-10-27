// Presentation only: callers own admission, the selected bundle and acquisition grants.
import type { Downloads } from './state.ts';
import { downloadMegabytes } from './derived.ts';

export type DownloadBundle = 'route' | 'photo';

export interface DownloadDecisionInput {
  readonly downloads: Downloads;
  readonly requiredScope: DownloadBundle;
  readonly selectedBundle: DownloadBundle;
  /** Zero is valid for optional preparation before any photo is chosen. */
  readonly photoCount: number;
  /** Missing pinned codec bytes, supplied only after the caller determines it needs the fallback. */
  readonly codecMissingBytes?: number;
}

export interface DownloadPurposeRow {
  readonly purpose: 'generate' | 'encode';
  readonly label: 'Generate' | 'Encode';
  /** Null means inventory is unknown; zero still requires verification before use. */
  readonly bytes: number | null;
  readonly amount: string | null;
  readonly status: 'unknown' | 'cached' | 'missing';
  readonly downloadLabel: string;
  readonly workLabel: string;
  readonly batchLabel: string | null;
  readonly text: string;
}

export interface DownloadDecision {
  readonly rows: readonly DownloadPurposeRow[];
  readonly totalBytes: number | null;
  readonly amount: string | null;
  /** A generation-only decision cannot resume an action requiring fresh photo encoding. */
  readonly photoPaused: boolean;
  readonly downloadCaveat: string;
  readonly setupCaveat: string;
}

function count(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${name} must be a nonnegative safe integer`);
  return value;
}

// The shared formatter has a one-MB minimum for positive transfers; cached scopes must stay zero.
const amount = (bytes: number | null): string | null =>
  bytes === null ? null : bytes === 0 ? '0 MB' : downloadMegabytes(bytes);

function row(
  purpose: DownloadPurposeRow['purpose'],
  bytes: number | null,
  photoCount: number,
): DownloadPurposeRow {
  const label = purpose === 'generate' ? 'Generate' : 'Encode';
  const status = bytes === null ? 'unknown' : bytes === 0 ? 'cached' : 'missing';
  const formatted = amount(bytes);
  const downloadLabel =
    status === 'cached'
      ? 'Already downloaded, subject to verification'
      : status === 'unknown'
        ? 'Download size unknown; download time unknown'
        : 'Download time unknown';
  const workLabel =
    purpose === 'generate' ? 'Generate time unknown' : 'Encode time unknown per face';
  const batchLabel =
    purpose === 'encode' && photoCount > 0
      ? `Batch encode time unknown for ${photoCount.toLocaleString('en-US')} ${photoCount === 1 ? 'face' : 'faces'}`
      : null;
  const acquisition =
    status === 'missing'
      ? `${purpose === 'encode' ? 'Additional ' : ''}${formatted}; ${downloadLabel.toLowerCase()}`
      : downloadLabel;
  return {
    purpose,
    label,
    bytes,
    amount: formatted,
    status,
    downloadLabel,
    workLabel,
    batchLabel,
    text: `${label}: ${acquisition}; ${workLabel.toLowerCase()}${batchLabel ? `; ${batchLabel.toLowerCase()}` : ''}.`,
  };
}

/** Unknown estimates never delay the decision. Byte figures come only from the supplied inventory. */
export function downloadDecision(input: DownloadDecisionInput): DownloadDecision {
  const { downloads, requiredScope, selectedBundle } = input;
  const photoCount = count(input.photoCount, 'Photo count');
  const codecBytes = count(input.codecMissingBytes ?? 0, 'Missing codec bytes');
  const generateBytes = downloads.known
    ? count(
        (downloads.routeReady ? 0 : count(downloads.routeBytes, 'Missing route bytes')) +
          codecBytes,
        'Generate bytes',
      )
    : null;
  const rows: DownloadPurposeRow[] = [row('generate', generateBytes, photoCount)];
  if (selectedBundle === 'photo')
    rows.push(
      row(
        'encode',
        downloads.known
          ? downloads.photoReady
            ? 0
            : count(downloads.photoBytes, 'Missing photo bytes')
          : null,
        photoCount,
      ),
    );
  const totalBytes = rows.some((item) => item.bytes === null)
    ? null
    : count(
        rows.reduce((sum, item) => sum + item.bytes!, 0),
        'Bundle bytes',
      );
  return {
    rows,
    totalBytes,
    amount: amount(totalBytes),
    photoPaused: requiredScope === 'photo' && selectedBundle === 'route',
    downloadCaveat: 'Download time depends on your connection.',
    setupCaveat: 'First use also checks the models on this device; setup time is unknown.',
  };
}
