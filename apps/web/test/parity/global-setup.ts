// Starts the served site once for the whole run and stops it at the end: the verified control (its digest is re-checked
// first), or, for the parity harness (fm-q007), the subject in PARITY_SUBJECT with its identity in PARITY_SUBJECT_SOURCE.
// PARITY_RUNTIME names an acquired runtime outside the checkout (CI keeps one per runner).
import { startControl } from './control-server.ts';

export default async function globalSetup() {
  const artifact = process.env['PARITY_SUBJECT'];
  const runtime = process.env['PARITY_RUNTIME'];
  const control = await startControl({
    ...(runtime ? { runtime } : {}),
    ...(artifact ? { artifact, source: process.env['PARITY_SUBJECT_SOURCE'] ?? '' } : {}),
  });
  process.env['FACEMORPH_CONTROL_RUNTIME'] = control.manifestSha256;
  return async () => {
    await control.stop();
  };
}
