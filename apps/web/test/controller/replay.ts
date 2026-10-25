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
