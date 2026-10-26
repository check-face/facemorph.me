// App-owned UI preference; the key and JSON format match the retained candidate.
const SLIDER = 'facemorph-slider-v1';
export function sliderPreference(): boolean {
  try {
    return JSON.parse(localStorage.getItem(SLIDER) || '{}').enabled === true;
  } catch {
    return false;
  }
}
export function sliderPosition(): number {
  try {
    const n: unknown = JSON.parse(localStorage.getItem(SLIDER) || '{}').frame;
    return typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= 4096 ? n : 1;
  } catch {
    return 1;
  }
}
const VIDEO_QUALITY = 'facemorph-video-quality-v1';
/** The morph video size choice (fm-36ag): Standard unless Full quality was chosen on this device. */
export function videoQualityPreference(): 'standard' | 'full' {
  try {
    return localStorage.getItem(VIDEO_QUALITY) === 'full' ? 'full' : 'standard';
  } catch {
    return 'standard';
  }
}
export function rememberVideoQuality(quality: 'standard' | 'full'): void {
  try {
    localStorage.setItem(VIDEO_QUALITY, quality === 'full' ? 'full' : 'standard');
  } catch {
    /* unavailable storage keeps the choice for this page only */
  }
}
export function rememberSlider(enabled: boolean, frame: number): void {
  try {
    localStorage.setItem(
      SLIDER,
      JSON.stringify({
        enabled: enabled === true,
        frame: Number.isInteger(frame) && frame > 0 ? Math.min(frame, 4096) : 1,
      }),
    );
  } catch {
    /* unavailable storage does not prevent using the slider */
  }
}
