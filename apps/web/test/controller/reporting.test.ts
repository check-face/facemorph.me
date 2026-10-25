import test from 'node:test';
import assert from 'node:assert/strict';
import { init } from '../../src/controller/init.ts';
import { msg } from '../../src/controller/msg.ts';
import { reporting, reportSent } from '../../src/controller/reducers/reporting.ts';
import { consentToastVisible, failureToastVisible } from '../../src/controller/derived.ts';
const state = init({
  today: '<today>',
  url: 'https://next.facemorph.me/?testing',
  consentAnswered: false,
  sliderPreference: false,
  sliderPosition: 1,
}).state;
test('one-shot reporting preserves standing permission on both effect outcomes', () => {
  for (const enabled of [false, true]) {
    const prior = { ...state, Debug: enabled, DebugStatus: 'previous' };
    const next = reporting(msg('SendReportOnce'), prior)!;
    assert.equal(next.state, prior);
    assert.deepEqual(next.effects, [{ type: 'sendReportOnce' }]);
    assert.equal(reportSent(next.state, true).Debug, enabled);
    assert.equal(reportSent(next.state, false), prior);
    assert.equal(reportSent(next.state, true).DebugStatus, 'Sending this report…');
  }
});
test('consent withdrawal records the off basis and clears the invitation', () => {
  const on = reporting(msg('Consent', true, 'invite'), state)!;
  const off = reporting(msg('Consent', false, 'checkbox'), on.state)!;
  assert.equal(off.state.Debug, false);
  assert.equal(off.state.Invite, false);
  assert.equal(off.state.ConsentPrompt, false);
  assert.deepEqual(off.effects, [{ type: 'setDebug', enabled: false, basis: 'checkbox' }]);
  assert.deepEqual(reporting(msg('Debug', true), state)!.effects, [
    { type: 'setDebug', enabled: true, basis: 'checkbox' },
  ]);
});
test('dismissal clears only the intended toast and DismissError clears its failure toast', () => {
  const prior = {
    ...state,
    Error: 'synthetic error',
    FailureToast: true,
    Warn: 'synthetic warning',
    ConsentPrompt: true,
  };
  const next = reporting(msg('DismissError'), prior)!.state;
  assert.equal(next.Error, null);
  assert.equal(next.FailureToast, false);
  assert.equal(next.Warn, prior.Warn);
  assert.equal(reporting(msg('DismissFailureToast'), prior)!.state.Error, prior.Error);
  assert.equal(reporting(msg('DismissWarn'), prior)!.state.Warn, null);
  assert.equal(reporting(msg('DismissInvite'), prior)!.state.Invite, false);
  assert.equal(reporting(msg('DismissConsentPrompt'), prior)!.state.ConsentPrompt, false);
});
test('failure invitation has priority, with model/download gates suppressing both toasts', () => {
  const prior = { ...state, Error: 'synthetic error', FailureToast: true, ConsentPrompt: true };
  assert.equal(failureToastVisible(prior, false), true);
  assert.equal(consentToastVisible(prior, false), false);
  assert.equal(failureToastVisible({ ...prior, Debug: true }, false), false);
  for (const [s, model] of [
    [prior, true],
    [{ ...prior, Gate: ['route', msg('RunFace', 'face-1')] as const }, false],
  ] as const) {
    assert.equal(failureToastVisible(s, model), false);
    assert.equal(consentToastVisible(s, model), false);
  }
});
// ReportFailure's standing opt-in is defect 12, owned by diagnostics. It is intentionally not a parity assertion.
