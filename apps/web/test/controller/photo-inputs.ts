// Plain reducer inputs, never browser/model/encoding evidence. Browser checks load the real JPEG fixtures.
import { init } from '../../src/controller/init.ts';
import type { CropOffer, Output } from '../../shell/facade/records.ts';
export const state = init({
  today: '<today>',
  url: 'https://next.facemorph.me/',
  consentAnswered: true,
  sliderPreference: false,
  sliderPosition: 1,
}).state;
export const file = (name: string) =>
  new File(['synthetic reducer input'], name, { type: 'image/jpeg' });
export const offer = (name: string): CropOffer => {
  const source = file(name);
  return {
    file: source,
    blob: source,
    url: `blob:${name}`,
    sourceWidth: 1280,
    sourceHeight: 960,
    previewWidth: 640,
    previewHeight: 480,
    scale: 0.5,
    resized: true,
  };
};
export const recovered: Output = {
  faces: [],
  videoUrl: '',
  projectJson: '',
  message: 'Saved face recovered.',
  errorMessage: '',
  restored: false,
  inputs: [],
  kind: 'linear',
  width: 1,
  pinch: false,
  frames: 8,
  fps: 16,
  photoChoices: null,
  cropFace: null,
  refusal: null,
};
