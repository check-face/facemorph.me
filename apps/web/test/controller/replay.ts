import assert from 'node:assert/strict';
import { init } from '../../src/controller/init.ts';
import { msg } from '../../src/controller/msg.ts';
import { reduce } from '../../src/controller/reducers/index.ts';
import type { State } from '../../src/controller/state.ts';
import type { Downloads } from '../../shell/facade/records.ts';
import { fixture, compareFields } from './scaffold.ts';
// Shared controller replay report. Only a completed replayer can call a parity row passed.
// The control recorder captured snapshots, not the private Elmish Msg stream; missing events
// remain untested rather than being manufactured from the next expected model.
import { ROWS } from '../parity/rows.ts';
import { controlRows, replayStatus, verifyControl } from './control.ts';
export interface ReplayResult {
  readonly row: string;
  readonly status: 'passed' | 'failed' | 'owner-graded' | 'untested';
  readonly reason?: string;
}
export type Replayers = Readonly<Record<string, () => void | string>>;
export function replayRows(replayers: Replayers): readonly ReplayResult[] {
  verifyControl();
  const ids = new Set([...controlRows().map((row) => row.id), ...ROWS.map((row) => row.rowId)]);
  return [...ids].map((row): ReplayResult => {
    const grade = replayStatus(row);
    if (grade.status === 'owner-graded')
      return { row, status: 'owner-graded', reason: grade.reason! };
    const replay = replayers[row];
    if (!replay)
      return {
        row,
        status: 'untested',
        reason:
          grade.reason ??
          'Recorded async snapshots do not contain the Msg/event stream; no completed replay registered for this slice.',
      };
    try {
      const reason = replay();
      return reason ? { row, status: 'untested', reason } : { row, status: 'passed' };
    } catch (error) {
      return {
        row,
        status: 'failed',
        reason: error instanceof Error ? (error.stack ?? error.message) : String(error),
      };
    }
  });
}

export function replayFirstVisit(): void {
  for (const device of ['desktop', 'phone']) {
    const recorded = fixture(`first-visit/${device}/01-arrived.json`).model;
    const initial = init({
      today: '<today>',
      url: 'https://next.facemorph.me/',
      consentAnswered: false,
      sliderPreference: false,
      sliderPosition: 1,
    });
    assert.deepEqual(
      initial.effects.map((effect) => effect.type),
      ['restoreLastResult', 'subscribe', 'subscribeDownloads'],
    );
    // The arrival recording contains the actual inventory event. It contains no compute result.
    const next = reduce(msg('DownloadsChanged', recorded.Downloads as Downloads), initial.state)!;
    compareFields(next, recorded, Object.keys(initial.state) as (keyof State)[]);
    assert.equal(next.state.Gate, null);
  }
}
