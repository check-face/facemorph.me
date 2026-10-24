// Loads every emitted worker and reports, per worker, whether its module graph loaded: a module worker that
// fails to fetch or evaluate fires `error`; one that loads answers nothing and stays quiet. The result is
// written to window.__workerCheck for the browser tests and printed on the page.
import { EMITTED_WORKERS, type EmittedWorker } from './workers.ts';

type Result = { worker: EmittedWorker; ok: boolean; error?: string };
const QUIET_MS = 3000;

async function check(name: EmittedWorker): Promise<Result> {
  const worker = EMITTED_WORKERS[name]();
  return new Promise((resolve) => {
    const done = (r: Result) => {
      worker.terminate();
      resolve(r);
    };
    worker.addEventListener('error', (e) => {
      e.preventDefault();
      done({ worker: name, ok: false, error: e.message || 'worker error' });
    });
    setTimeout(() => done({ worker: name, ok: true }), QUIET_MS);
  });
}

const results = await Promise.all((Object.keys(EMITTED_WORKERS) as EmittedWorker[]).map(check));
(window as unknown as { __workerCheck: Result[] }).__workerCheck = results;
document.body.textContent = JSON.stringify(results);
