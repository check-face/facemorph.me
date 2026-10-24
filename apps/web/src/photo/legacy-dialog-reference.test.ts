// The legacy crop-dialog element list is complete and well formed (fm-bbhu). Plain values only.
//   node --experimental-strip-types --test apps/web/src/photo/legacy-dialog-reference.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { LEGACY_ELEMENTS, LEGACY_INTERACTIONS, OPEN_CROPPER_EXTRAS } from './legacy-dialog-reference.ts';

const byId = new Map(LEGACY_ELEMENTS.map((e) => [e.id, e]));
const copies = LEGACY_ELEMENTS.map((e) => e.copy ?? '');

test('every element the bead names has an entry', () => {
  for (const title of ['Encode an image', 'Crop your image']) assert.ok(copies.includes(title), title);
  assert.ok(byId.has('title-failure'), 'third title (failure screen)');
  for (const id of ['logo', 'proposal-preview', 'adjust-crop', 'cancel', 'ok', 'stencil', 'oval-guide', 'eye-marker-left', 'eye-marker-right', 'rotate-icon',
    'degree-readout', 'rotation-slider', 'guidance-bold', 'guidance-lines', 'use-crop', 'failure-preview', 'failure-crop', 'failure-line', 'failure-guidance',
    'file-chooser', 'paste-field', 'rotate-90-button']) assert.ok(byId.has(id), id);
  assert.equal(LEGACY_ELEMENTS.filter((e) => e.kind === 'handle').length, 8);
  assert.equal(LEGACY_ELEMENTS.filter((e) => e.id.startsWith('eye-marker')).length, 2);
  assert.ok(copies.includes('Or paste image here'));
  assert.ok(copies.includes('Unable to auto align face.'));
});

test('every EncodeImageDialog.fs interaction has an entry', () => {
  const ids = new Set(LEGACY_INTERACTIONS.map((i) => i.id));
  for (const id of ['choose-file', 'paste', 'drag-stencil', 'rotate-90', 'fine-rotate', 'readout-update', 'cancel', 'ok-or-use-crop', 'crop-from-failure'])
    assert.ok(ids.has(id), id);
  for (const at of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) assert.ok(ids.has(`resize-${at}`), at);
});

test('ids are unique and every entry names an owning bead', () => {
  for (const list of [LEGACY_ELEMENTS, LEGACY_INTERACTIONS]) {
    const ids = list.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const e of list) assert.match(e.owner, /^fm-[a-z0-9]+(\.[0-9]+)*$/, e.id);
  }
});

test('every deliberate difference gives its reason and plan anchor', () => {
  for (const e of [...LEGACY_ELEMENTS, ...LEGACY_INTERACTIONS]) {
    if (e.disposition !== 'deliberate difference') continue;
    assert.ok(e.reason && e.reason.length > 10, `${e.id} reason`);
    assert.match(e.planAnchor ?? '', /^PLAN\.md#[a-z0-9-]+$/, `${e.id} anchor`);
  }
});

test('the settled deliberate differences are recorded', () => {
  assert.equal(byId.get('failure-crop')?.copy, 'ADJUST CROP');
  assert.equal(byId.get('title-failure')?.copy, 'Encode an image');
  assert.match(byId.get('failure-guidance')?.copy ?? '', /looking towards the camera\.$/);
  assert.equal(byId.get('prepare-encoder')?.disposition, 'deliberate difference');
  assert.ok(LEGACY_INTERACTIONS.some((i) => i.id === 'confirm-before-encode' && i.disposition === 'deliberate difference'));
  assert.ok(LEGACY_INTERACTIONS.some((i) => i.id === 'detect-before-confirm' && /On-device detection/.test(i.reason ?? '')));
});

test('the open cropper-extras question states the candidate-behaviour default', () => {
  assert.match(OPEN_CROPPER_EXTRAS.question, /pinch/);
  assert.match(OPEN_CROPPER_EXTRAS.default, /candidate behaviour/);
});

test('every geometry path resolves in the measured geometry JSON', () => {
  const geometry: unknown = JSON.parse(readFileSync(new URL('../../../../docs/design/legacy-encode-dialog-geometry.json', import.meta.url), 'utf8'));
  for (const e of LEGACY_ELEMENTS) {
    if (!e.geometry) continue;
    let at: unknown = geometry;
    for (const key of e.geometry.split('.')) at = at !== null && typeof at === 'object' ? (at as Record<string, unknown>)[key] : undefined;
    assert.notEqual(at, undefined, `${e.id}: ${e.geometry}`);
  }
});
