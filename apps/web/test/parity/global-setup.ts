// Starts the verified control once for the whole run (its digest is re-checked first) and stops it at the end.
import { startControl } from './control-server.ts';

export default async function globalSetup() {
  const control = await startControl();
  process.env['FACEMORPH_CONTROL_RUNTIME'] = control.manifestSha256;
  return async () => {
    await control.stop();
  };
}
