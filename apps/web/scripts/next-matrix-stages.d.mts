export const STAGES: readonly string[];
export const OUTCOMES: readonly string[];
export type StageOutcome = 'passed' | 'failed' | 'unsupported' | 'buildLimitation' | 'incomplete-not-shipped';
export interface StageData {
  readonly notShipped?: boolean;
  readonly buildLimitation?: boolean;
  readonly [key: string]: unknown;
}
export function classifyStage(input?: {
  error?: unknown;
  optional?: boolean;
  data?: StageData | null;
}): StageOutcome;
export interface StageRecord {
  readonly outcome: StageOutcome;
  readonly passed: boolean;
  readonly [key: string]: unknown;
}
export function stageRecord(outcome: StageOutcome, fields?: Record<string, unknown>): StageRecord;
export interface RowVerdict {
  readonly passed: boolean;
  readonly ok: boolean;
  readonly status: 'passed' | 'incomplete' | 'failed';
  readonly failed: string[];
  readonly unsupported: string[];
  readonly missing: string[];
  readonly incompleteNotShipped: string[];
  readonly buildLimited: string[];
}
export function rowVerdict(
  stages?: Record<string, { outcome?: string; passed?: boolean } | undefined>,
): RowVerdict;
export function hasRecoveryMetadata(bytes: Uint8Array): boolean;
export function encoderRan(events?: readonly { posted?: string; stage?: string }[]): boolean;
