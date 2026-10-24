// The candidate bridge and the helper modules Product.fs imported (fm-pia9), declared as what they are: untyped
// JavaScript. Arguments are what the facade sends; every result is `unknown` until facade/records.ts reads it.
declare module '*/src/Next/product-bridge.mjs' {
  export function loadNames(): Promise<unknown>;
  export function publicPreview(mode: string, value: string): Promise<unknown>;
  export function drawFace(canvas: HTMLCanvasElement, id: string): void;
  export function execute(request: object): Promise<unknown>;
  export function subscribe(callback: (progress: unknown) => void): void;
  export function cancel(): void;
  export function saveMedia(id: string): Promise<unknown>;
  export function shareMedia(id: string): Promise<unknown>;
  export function exportProject(request: object): Promise<unknown>;
  export function importProject(request: object): Promise<unknown>;
  export function measuredFaceMs(): unknown;
  export function measuredFrameMs(): unknown;
  export function measuredVideoMs(): unknown;
  export function jobProgress(): unknown;
  export function sliderFrames(): Promise<unknown>;
  export function rememberView(options: object): void;
  export function plannedFrames(options: object): unknown;
  export function stagedReportCount(): unknown;
  export function reportReference(): unknown;
  export function cancelPhotoRun(): void;
  export function setDebug(enabled: boolean, basis: string): void;
  export function sendReportOnce(): unknown;
  export function consentAnswered(): unknown;
  export function subscribeDownloads(callback: (downloads: unknown) => void): void;
  export function downloadModels(includePhoto: boolean): void;
  export function consentToDownload(scope: string): unknown;
  export function sourceVersion(): unknown;
  export function issueUrl(route: string): unknown;
  export function restoreLastResult(): Promise<unknown>;
  export function rememberSourcePhoto(id: string, file: Blob): void;
  export function sourcePhotoUrl(id: string): unknown;
  export function queueFace(id: string, depth: number): void;
  export function cancelQueuedFace(id: string): void;
  export function chooseDetectedFace(choice: object, index: number): Promise<unknown>;
  export function invalidateArrivalRestore(): void;
  export function photoRevision(id: string): unknown;
  export function invalidateFace(id: string): void;
  export function invalidateMorph(): void;
  export function checkCachedFace(item: object): Promise<unknown>;
  export function displayMilestone(kind: string): void;
  export function previewPhotoReported(file: Blob, options: object | null): Promise<unknown>;
  export function cropPhotoReported(file: Blob, area: object, options: object): Promise<unknown>;
  export function selectPhotoReported(request: object): Promise<unknown>;
  export function warmPhotoTools(): void;
}
declare module '*/src/Next/last-result.mjs' {
  export function sliderPreference(): unknown;
  export function sliderPosition(): unknown;
  export function rememberSlider(enabled: boolean, frame: number): void;
}
declare module '*/src/Next/scheduler.mjs' {
  export function nextScheduled(jobs: readonly object[], options: object): unknown;
}
declare module '*/src/Next/photo/align-photo.mjs' {
  export const MULTIPLE_FACES_MESSAGE: unknown;
}
