import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { ROWS } from '../parity/rows.ts';
import {
  allPayloadsCovered,
  confirmedPhotos,
  descriptorWalkthrough,
  firstName,
  orderedSelection,
  secondName,
  selectionHistory,
  walks,
} from '../../src/contracts/walkthrough.test.ts';
import {
  SURFACES,
  type FileOpenOutcome,
  type MorphResultState,
  type MultiFaceSelectionState,
  type ResultActionsState,
} from '../../src/contracts/ui-states.ts';

// These are the contract projections of the frozen inventory, not visual/input
// acceptance. Static copy, links and diagnostics rows keep the app usable at the
// inspect boundary; their runtime implementation is verified by their owner.
const flowWalks: Readonly<Record<string, readonly (keyof typeof walks)[]>> = {
  'first-visit': ['inspect'],
  'return-retained': ['saveReload'],
  'phone-cpu-route': ['generateRetry', 'morph'],
  'words.generate-cpu': ['generateRetry'],
  'seed.generate': ['generateRetry'],
  'retry-unchanged': ['generateRetry'],
  'edit-running-tile': ['generateRetry', 'invalidate'],
  'names.open-pick': ['names'],
  'names.slow-offline': ['names', 'namesCleanup'],
  'names.edit-picked': ['namesCleanup', 'generateRetry'],
  'names.exact-text': ['generateRetry'],
  'names.modal-back-escape': ['namesCleanup'],
  'device-timing': ['inspect', 'unsupported'],
  'provider.select': ['generateRetry', 'unsupported'],
  'consent.approve-refuse': ['consent'],
  'consent.quota-failure': ['consent'],
  'photo.replace-cancel': ['photo', 'photoCleanup'],
  'photo.paste-drop': ['photo'],
  'photo.multi-file': ['photo'],
  'crop.confirm-one': ['photo'],
  'crop.adjust-rotate': ['photo'],
  'crop.no-face': ['photoCleanup', 'photo'],
  'crop.multi-face': ['photo'],
  'photo.assets-absent': ['photo', 'consent', 'photoRetry'],
  'photo.cancel-retry-encode': ['photo', 'photoRetry', 'photoCleanup'],
  'controls.add-remove': ['faces', 'invalidate'],
  'controls.many-faces': ['faces', 'invalidate'],
  'controls.undo-start-over': ['invalidate'],
  'keyboard-only': ['names', 'photo', 'morph', 'saveReload', 'namesCleanup'],
  'morph.identical-neighbours': ['unsupported'],
  'words.no-instant-picture': ['inspect', 'generateRetry'],
  'words.phone-capitalisation': ['generateRetry'],
  'reload-after-morph': ['saveReload'],
  'offline-cached': ['saveReload', 'generateRetry'],
  'morph.unfinished-inputs': ['generateRetry', 'morph'],
  'morph.settings-start-cancel': ['morph', 'invalidate'],
  'morph.play-slider': ['morph'],
  'save.face-mp4': ['morph', 'saveReload'],
  'share.cancel-unsupported': ['shareFormat', 'saveReload'],
  'save.repeat-rename-format': ['saveReload', 'shareFormat'],
  'reopen-still': ['saveReload'],
  'reopen-mp4-deferred': ['unsupported'],
  'recovery-damaged': ['unsupported', 'photo'],
  'background-reload-close': ['generateRetry', 'saveReload'],
  'report-error': ['inspect'],
  'remove-down-to-one': ['invalidate', 'saveReload'],
  'testing-bulk-generate': ['generateRetry', 'inspect'],
  'debug-on-off': ['inspect'],
  'desktop-package-link': ['inspect'],
  'defect.inconsistent-sizes': ['consent'],
  'defect.privacy-text': ['inspect'],
  'defect.names-contrast': ['names', 'namesCleanup'],
  'defect.typos': ['inspect', 'photo', 'morph'],
  'defect.licence-page': ['inspect'],
  'defect.storage': ['inspect', 'saveReload'],
  'defect.preview-badge': ['names'],
};

test('every inventoried flow has typed transitions, covering every contracted surface', () => {
  assert.equal(allPayloadsCovered, true);
  assert.deepEqual(Object.keys(flowWalks).sort(), ROWS.map((r) => r.rowId).sort());
  const covered = new Set<string>();
  for (const row of ROWS) {
    const names = flowWalks[row.rowId];
    assert.ok(names?.length, row.rowId);
    for (const name of names) {
      assert.ok(walks[name].length, `${row.rowId}: ${name}`);
      for (const step of walks[name]) {
        covered.add(step.surface);
        assert.ok(
          SURFACES[step.surface].transitions.some(
            (t) =>
              t.from === step.from &&
              t.event === step.event &&
              t.to === step.to &&
              t.contract === step.contract,
          ),
          `${row.rowId}: ${step.event}`,
        );
      }
    }
  }
  assert.deepEqual([...covered].sort(), Object.keys(SURFACES).sort());
});

test('two names, morph cancel/retry, playback, save, reload and reopen use their contract types', () => {
  assert.notEqual(firstName.target.faceId, secondName.target.faceId);
  assert.deepEqual(
    walks.morph.map((s) => [s.from, s.event, s.to]),
    [
      ['none', 'create-morph', 'producing'],
      ['producing', 'cancel', 'cancelled'],
      ['cancelled', 'retry', 'producing'],
      ['producing', 'complete', 'current'],
      ['current', 'play', 'current'],
      ['current', 'scrub', 'current'],
    ],
  );
  const cancellation = { morph: 'cancelled', partialExported: false } satisfies MorphResultState;
  assert.equal(cancellation.partialExported, false);
  assert.deepEqual(walks.saveReload.at(-1), {
    surface: 'fileOpen',
    from: 'missing',
    event: 'open-valid',
    to: 'still',
    contract: 'RecoveryClassification',
    value: 'matching',
  });
  const model = descriptorWalkthrough();
  assert.equal(model.accepted.ok, true);
  assert.equal(model.mixed.ok, false);
  if (!model.mixed.ok) assert.equal(model.mixed.error.code, 'mixed-model-identity');
  assert.equal(model.reopened.classification, 'matching');
  assert.equal(model.reopened.actions.installLatent, true);
  assert.equal(model.reopened.actions.useAsPhoto, 'never');
  assert.equal(model.recovered.latent, model.first);
});

test('confirmed photo keeps global clicks across two files and cleanup withdraws pending results', () => {
  assert.deepEqual(
    selectionHistory.map((s) => s.order),
    [['b#1'], ['b#1', 'a#0'], ['a#0'], ['a#0', 'a#1'], ['a#0', 'a#1', 'b#1']],
  );
  assert.equal(orderedSelection.files.length, 2);
  assert.deepEqual(
    confirmedPhotos.map((p) => p.candidate),
    orderedSelection.order,
  );
  assert.equal(new Set(confirmedPhotos.map((p) => p.crop.confirmedCropId)).size, 3);
  assert.ok(confirmedPhotos.every((p) => p.crop.rotationDegrees === 90));
  assert.ok(
    walks.photoRetry
      .filter((s) => s.contract === 'WholeActionProgress')
      .every((s) => s.value.action === 'photo'),
  );
  assert.ok(walks.photo.some((s) => s.surface === 'cropConfirm' && s.event === 'ok'));
  const cancelled = {
    modal: 'multi-face',
    phase: 'cancelled',
    inserted: [],
  } satisfies MultiFaceSelectionState;
  const withdrawn = { result: 'none' } satisfies ResultActionsState;
  const external = { open: 'unsupported-mp4', currentWorkKept: true } satisfies FileOpenOutcome;
  assert.equal(cancelled.inserted.length, 0);
  assert.equal(withdrawn.result, 'none');
  assert.equal(external.currentWorkKept, true);
  assert.deepEqual(
    walks.invalidate.filter((s) => s.surface === 'resultActions').map((s) => s.to),
    ['none', 'none'],
  );
  assert.ok(walks.namesCleanup.some((s) => s.to === 'invalidated'));
});

test('inventoried walkthroughs import contracts without download, cache, host or engine code', () => {
  const root = resolve(new URL('../../../../', import.meta.url).pathname);
  const contracts = resolve(root, 'apps/web/src/contracts');
  const visited = new Set<string>();
  function inspect(path: string) {
    if (visited.has(path)) return;
    visited.add(path);
    const source = readFileSync(path, 'utf8');
    assert.doesNotMatch(
      source,
      /\b(?:fetch|XMLHttpRequest|WebSocket|caches|indexedDB)\s*[.(]/,
      path,
    );
    assert.doesNotMatch(source, /\bimport\s*\(/, `${path}: dynamic runtime imports`);
    // Multiline static imports/exports; type-only edges carry no runtime dependency.
    const statements = source.matchAll(
      /^(?:import\s+(?!type\b)|export\s+(?=[*{]))([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gm,
    );
    for (const statement of statements) {
      const specifier = statement[2];
      assert.ok(
        specifier && specifier.startsWith('.'),
        `${path}: external runtime import ${specifier}`,
      );
      const dependency = resolve(dirname(path), specifier);
      assert.ok(
        dependency.startsWith(contracts + '/') ||
          dependency.startsWith(resolve(root, 'packages/stylegan-js/src/contracts') + '/'),
        dependency,
      );
      if (dependency.endsWith('.ts')) inspect(dependency);
    }
  }
  inspect(resolve(contracts, 'walkthrough.test.ts'));
  assert.ok(visited.has(resolve(contracts, 'walkthrough.test.ts')));
});

test('the export type test names every frozen app, milestone-2 and descriptor export', () => {
  const contracts = new URL('../../src/contracts/', import.meta.url);
  const index = readFileSync(new URL('index.ts', contracts), 'utf8');
  const modules = [...index.matchAll(/export \* from '([^']+)'/g)].map((m) => {
    assert.ok(m[1]);
    return new URL(m[1], contracts);
  });
  modules.push(
    new URL('../../../../packages/stylegan-js/src/contracts/descriptor.ts', import.meta.url),
  );
  const names = modules.flatMap((path) =>
    [
      ...readFileSync(path, 'utf8').matchAll(
        /^export (?:const|class|function|interface|type) (\w+)/gm,
      ),
    ].map((m) => m[1]),
  );
  const closure = readFileSync(new URL('./milestone-exports.test.ts', import.meta.url), 'utf8');
  const imported = [...closure.matchAll(/import type \{([^}]+)\}/g)].flatMap((m) => {
    assert.ok(m[1]);
    return m[1]
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
  });
  assert.deepEqual([...new Set(imported)].sort(), [...new Set(names)].sort());
});
