import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { orderedEffects } from '../../src/controller/runner.ts';
import { msg } from '../../src/controller/msg.ts';
import { rejection, viewSnapshot } from '../../src/controller/effects.ts';
import { init } from '../../src/controller/init.ts';
test('promise failures preserve the candidate message contracts without a service double', () => {
  const state = init({
    today: '<today>',
    url: 'https://next.facemorph.me/',
    consentAnswered: true,
    sliderPreference: false,
    sliderPosition: 1,
  }).state;
  const input = state.Inputs[0]!;
  const error = new Error('actual error text');
  assert.deepEqual(
    rejection({ type: 'publicPreview', id: input.id }, error, input),
    msg('PreviewLoaded', input.id, input.mode, input.value, ''),
  );
  assert.deepEqual(
    rejection({ type: 'checkCachedFace', input }, error),
    msg('CachedFaceChecked', input, false),
  );
  for (const type of ['saveMedia', 'shareMedia'] as const)
    assert.deepEqual(
      rejection({ type, id: input.id }, error),
      msg('Notice', "Couldn't save or share this file. Try Save instead."),
    );
  assert.deepEqual(
    rejection({ type: 'exportProject', view: viewSnapshot(state) }, error),
    msg('Notice', error.message),
  );
  assert.deepEqual(rejection({ type: 'loadNames' }, error), msg('NamesFailed', error.message));
  assert.deepEqual(rejection({ type: 'sliderFrames' }, error), msg('SliderLoaded', null));
  assert.deepEqual(rejection({ type: 'restoreLastResult' }, error), msg('Notice', ''));
  assert.deepEqual(
    rejection(
      {
        type: 'importProject',
        file: new Blob(['invalid']),
        jobId: 7,
        provider: 'cpu',
        view: viewSnapshot(state),
      },
      error,
    ),
    msg('Failed', 7, error.message),
  );
  assert.deepEqual(
    rejection(
      {
        type: 'execute',
        request: {
          ...viewSnapshot(state),
          jobId: 8,
          provider: 'cpu',
          action: 'face',
          target: input.id,
        },
      },
      error,
    ),
    msg('Failed', 8, error.message),
  );
  assert.throws(
    () => rejection({ type: 'invalidateMorph' }, error),
    /no promise rejection mapping/,
  );
});
test('direct effects retain emission order before any Cmd-derived work', () => {
  assert.deepEqual(
    orderedEffects([
      { type: 'publicPreview', id: 'face-1' },
      { type: 'invalidateFace', id: 'face-1' },
      { type: 'dispatch', message: msg('RunFace', 'face-1') },
      { type: 'rememberSlider', enabled: false, frame: 7 },
    ]),
    [
      { type: 'invalidateFace', id: 'face-1' },
      { type: 'rememberSlider', enabled: false, frame: 7 },
      { type: 'publicPreview', id: 'face-1' },
      { type: 'dispatch', message: msg('RunFace', 'face-1') },
    ],
  );
});
test('reducers import only controller code and operation-service types', () => {
  const controller = fileURLToPath(new URL('../../src/controller/', import.meta.url));
  const directory = resolve(controller, 'reducers');
  for (const name of readdirSync(directory).filter((file) => file.endsWith('.ts'))) {
    const path = resolve(directory, name),
      source = readFileSync(path, 'utf8');
    assert.doesNotMatch(source, /\bimport\s*\(/, `${name}: dynamic import`);
    for (const imported of source.matchAll(
      /(import\s+(?:type\s+)?[^;]+?)\s+from\s+['"]([^'"]+)['"]/g,
    )) {
      const target = resolve(dirname(path), imported[2]!);
      if (target.startsWith(controller)) continue;
      assert.equal(target, resolve(controller, '../operations/service.ts'), name);
      assert.match(
        imported[1]!,
        /^import\s+type\b/,
        `${name}: operation service must be type-only`,
      );
    }
  }
});
