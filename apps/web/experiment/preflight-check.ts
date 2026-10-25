// Standalone real-browser surface: imports no app UI, model, detector or inference runtime.
import { checkDevice } from '../src/preflight/checker.ts';
import { createGpuSample, admitsGpuSample } from '../src/preflight/gpu-sample.ts';
import { Scratch } from '../src/preflight/types.ts';
Object.assign(window, { preflight: { checkDevice, createGpuSample, admitsGpuSample, Scratch } });
