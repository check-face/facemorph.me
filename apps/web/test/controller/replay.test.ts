import test from 'node:test';
import assert from 'node:assert/strict';
import { msg } from '../../src/controller/msg.ts';
import { reduce } from '../../src/controller/reducers/index.ts';
import { cancelled } from '../../src/controller/reducers/jobs.ts';
import { compareFields, fixture, fromGolden } from './scaffold.ts';
import { replayFirstVisit, replayRows } from './replay.ts';

test('all golden rows have explicit controller replay verdicts, with exact checks on available transitions', (t) => {
  const results = replayRows({
    'consent.approve-refuse': () => {
      throw new Error('A declared change must never execute a frozen-parity assertion');
    },
    'first-visit': replayFirstVisit,
    'retry-unchanged': () => {
      for (const device of ['desktop', 'phone']) {
        const running = fromGolden(fixture(`retry-unchanged/${device}/01-running.json`).model);
        const cancel = reduce(msg('Cancel'), running)!;
        assert.equal(cancel.state.Stage, 'cancelling');
        assert.deepEqual(cancel.effects, [{ type: 'cancelWork' }]);
        const stopped = cancelled(cancel.state, running.JobId);
        compareFields(stopped, fixture(`retry-unchanged/${device}/02-cancelled.json`).model, [
          'Busy',
          'Stage',
          'Status',
          'Error',
          'FailureToast',
          'ActiveFace',
          'Warn',
          'Remaining',
        ]);
        // fm-j4i8 retires only classic's cancelled=complete fraction; every other
        // recorded cancellation field above remains an exact control comparison.
        assert.equal(fixture(`retry-unchanged/${device}/02-cancelled.json`).model.Fraction, 1);
        assert.equal(stopped.state.Fraction, cancel.state.Fraction);
        assert.ok(stopped.state.Fraction < 1, 'a cancelled attempt never claims completion');
        const retry = reduce(msg('Retry'), stopped.state)!;
        assert.deepEqual(retry.effects, [{ type: 'dispatch', message: running.LastRun }]);
      }
      return 'Cancel/settlement/retry effects match desktop and phone except the declared fm-j4i8 preserved partial fraction; final successful retry lacks recorded Msg/output events. Real CPU execution is tested separately.';
    },
    'morph.settings-start-cancel': () => {
      for (const device of ['desktop', 'phone']) {
        const settings = fromGolden(
          fixture(`morph.settings-start-cancel/${device}/01-settings.json`).model,
        );
        const requested = reduce(msg('Run', 'morph'), settings)!;
        assert.deepEqual(requested.state.Gate, ['route', msg('Run', 'morph')]);
        // The recorder accepts the missing-model dialog between operated snapshots.
        const accepted = reduce(msg('GateAccept'), requested.state)!;
        assert.deepEqual(accepted.effects, [
          { type: 'consentToDownload', scope: 'route' },
          { type: 'dispatch', message: msg('Run', 'morph') },
        ]);
        const start = reduce(msg('Run', 'morph'), accepted.state)!;
        compareFields(
          start,
          fixture(`morph.settings-start-cancel/${device}/02-started.json`).model,
          ['Busy', 'JobId', 'RunSettings', 'PendingMorph', 'PendingJobs', 'Frames'],
        );
        assert.equal(start.effects.filter((effect) => effect.type === 'execute').length, 1);
        const stop = cancelled(reduce(msg('Cancel'), start.state)!.state, start.state.JobId);
        compareFields(
          stop,
          fixture(`morph.settings-start-cancel/${device}/03-cancelled.json`).model,
          ['Busy', 'Stage', 'Status', 'Error', 'ActiveFace'],
        );
        assert.equal(
          fixture(`morph.settings-start-cancel/${device}/03-cancelled.json`).model.Fraction,
          1,
        );
        assert.equal(start.state.Fraction, -1, 'unknown frame cost starts indeterminate');
        assert.equal(
          stop.state.Fraction,
          start.state.Fraction,
          'cancellation retains actual progress',
        );
      }
      return 'Start/cancel match both devices except the declared fm-j4i8 preserved partial fraction; final video snapshot has no recorded completion event. Real short CPU morph is tested separately.';
    },
  });
  for (const result of results) t.diagnostic(JSON.stringify(result));
  assert.deepEqual(
    results.filter((result) => result.status === 'failed'),
    [],
  );
  assert.ok(results.some((result) => result.row === 'first-visit' && result.status === 'passed'));
  assert.ok(
    results.filter((result) => result.status !== 'passed').every((result) => result.reason),
  );
});
