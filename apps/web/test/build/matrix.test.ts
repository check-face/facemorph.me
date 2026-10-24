// The declared browser matrix and the targets derived from it, called with plain values.
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMatrix, parseMatrix } from '../../build/browser-matrix.ts';
import { deriveTargets } from '../../build/targets.ts';

// The cells fm-svg declares: the retained CI lanes, the device lab and the physical iPhone (no lane yet).
const DECLARED = [
  'ubuntu-chrome', 'ubuntu-chromium', 'ubuntu-firefox', 'ubuntu-webkit', 'macos-webkit', 'macos-firefox',
  'android-emulator-chrome', 'ios-simulator-safari', 'iphone-16-pro-simulator', 'gpu-gtx1050',
  'eris-webgpu', 'eris-cpu', 'phone-webgpu', 'phone-cpu', 'iphone-physical',
];

const cell = (over: Record<string, unknown> = {}) => ({
  id: 'x', browser: 'Chromium', engine: 'chromium', version: '131', os: 'Ubuntu 24.04', deviceClass: 'desktop',
  provider: 'cpu', evidence: 'desktop', lane: 'next-matrix ubuntu-24.04 chromium', ...over,
});

test('every declared cell exists in browser-matrix.json, and nothing else', () => {
  assert.deepEqual(loadMatrix().cells.map((c) => c.id).sort(), [...DECLARED].sort());
});

test('evidence classes stay distinct: simulator, emulator, physical and desktop are not merged', () => {
  const byId = new Map(loadMatrix().cells.map((c) => [c.id, c]));
  assert.equal(byId.get('iphone-16-pro-simulator')?.evidence, 'simulator');
  assert.equal(byId.get('android-emulator-chrome')?.evidence, 'emulator');
  assert.equal(byId.get('phone-cpu')?.evidence, 'physical');
  assert.equal(byId.get('iphone-physical')?.lane, null);
});

test('an entry missing browser, version, OS or evidence class fails to load', () => {
  for (const field of ['browser', 'version', 'os', 'evidence']) {
    const bad = cell();
    delete (bad as Record<string, unknown>)[field];
    assert.throws(() => parseMatrix({ cells: [bad] }), new RegExp(`x: missing ${field}`));
  }
});

test('outcomes, unknown classes, duplicate ids and an unexplained missing lane are refused', () => {
  assert.throws(() => parseMatrix({ cells: [cell({ outcome: 'pass' })] }), /outcomes belong in the release summary/);
  assert.throws(() => parseMatrix({ cells: [cell({ evidence: 'lab' })] }), /unknown evidence class lab/);
  assert.throws(() => parseMatrix({ cells: [cell(), cell()] }), /duplicate id/);
  assert.throws(() => parseMatrix({ cells: [cell({ lane: null })] }), /needs laneNote/);
  assert.throws(() => parseMatrix({ cells: [] }), /non-empty/);
});

test('targets are the oldest declared version per engine, for the app and the workers alike', () => {
  const matrix = parseMatrix({ cells: [
    cell({ id: 'a', version: '141.0.7390.54' }), cell({ id: 'b', version: '124' }),
    cell({ id: 'c', engine: 'firefox', version: '132' }),
    cell({ id: 'd', engine: 'webkit', version: '18.2' }), cell({ id: 'e', engine: 'webkit', version: '17.4' }),
    cell({ id: 'f', engine: 'webkit', platform: 'ios', version: '16.4' }),
  ] });
  assert.deepEqual(deriveTargets(matrix), { build: ['chrome124', 'firefox132', 'ios16.4', 'safari17.4'], worker: ['chrome124', 'firefox132', 'ios16.4', 'safari17.4'], workerFormat: 'es' });
});

test('the shipped matrix derives the shipped targets', () => {
  assert.deepEqual(deriveTargets(loadMatrix()).build, ['chrome124', 'firefox132', 'ios16.4', 'safari18.2']);
});

test('a row without a version fails generation', () => {
  const matrix = { cells: [cell({ version: '' })] } as unknown as Parameters<typeof deriveTargets>[0];
  assert.throws(() => deriveTargets(matrix), /x: no version/);
});
