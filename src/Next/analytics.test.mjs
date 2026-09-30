import test from 'node:test';
import assert from 'node:assert/strict';
import {clean, allowed, deviceProperties, inputKind, HOST, MEASUREMENT_ID} from './analytics.mjs';

const env = (over = {}) => ({location: {hostname: HOST, protocol: 'https:'}, navigator: {}, ...over});

test('only the production host runs analytics', () => {
  assert.equal(allowed(env()), true);
  for (const hostname of ['localhost', 'labs.facemorph.me', 'facemorph.me', 'tauri.localhost', 'next.facemorph.me.evil.test'])
    assert.equal(allowed(env({location: {hostname, protocol: 'https:'}})), false, hostname);
  assert.equal(allowed(env({location: {hostname: HOST, protocol: 'http:'}})), false);
  assert.equal(allowed({}), false);
});
test('automation, Save-Data, GPC and DNT switch it off', () => {
  assert.equal(allowed(env({navigator: {webdriver: true}})), false);
  assert.equal(allowed(env({navigator: {connection: {saveData: true}}})), false);
  assert.equal(allowed(env({navigator: {globalPrivacyControl: true}})), false);
  assert.equal(allowed(env({navigator: {doNotTrack: '1'}})), false);
  // effectiveType is deliberately not a reason to be timid (AGENTS.md).
  assert.equal(allowed(env({navigator: {connection: {effectiveType: '3g'}}})), true);
});
test('clean keeps closed vocabularies and bounded numbers, and drops everything else', () => {
  const kept = clean({action: 'morph', outcome: 'failed', route: 'webgpu', error_kind: 'memory', error_stage: 'synthesis', duration_ms: 1234.567, faces: 3, frames: 96, input_kind: 'photo', morph_kind: 'full-smooth-figure8'});
  assert.deepEqual(kept, {action: 'morph', outcome: 'failed', route: 'webgpu', error_kind: 'memory', error_stage: 'synthesis', duration_ms: 1234.6, faces: 3, frames: 96, input_kind: 'photo', morph_kind: 'full-smooth-figure8'});
  const dropped = clean({name: 'Alice', seed: 12345, file: 'me.jpg', message: 'Failed to fetch https://x', outcome: 'exploded', route: 'gpu9000', error_stage: 'Has Spaces', duration_ms: -5, faces: 9999, frames: NaN, email: 'a@b.c'});
  assert.deepEqual(dropped, {});
});
test('input kinds describe what was given without keeping it', () => {
  assert.equal(inputKind([{mode: 'text', value: 'hello'}, {mode: 'text', value: 'world'}]), 'name');
  assert.equal(inputKind([{mode: 'text', value: '4242'}]), 'seed');
  assert.equal(inputKind([{mode: 'photo'}]), 'photo');
  assert.equal(inputKind([{mode: 'photo'}, {mode: 'text', value: 'hello'}]), 'mixed');
  assert.equal(inputKind([]), undefined);
});
test('device properties are coarse bands, never raw values', () => {
  const p = deviceProperties({userAgent: 'Mozilla/5.0 (iPhone)', hardwareConcurrency: 6, deviceMemory: 4, gpu: {}}, true);
  assert.deepEqual(p, {platform: 'ios', webgpu: 'yes', cores_band: '5-8', memory_band: '4gb', isolated: 'yes'});
  assert.equal(deviceProperties({userAgent: 'x'}, undefined).cores_band, 'unknown');
});
test('the measurement id is the facemorph.me GA4 stream', () => assert.equal(MEASUREMENT_ID, 'G-F5F6JBLJ54'));
