// The app entry: the candidate's stylesheet (style.scss, which carries product-ux.scss) and the shell, mounted
// where classic mounted its app (`elmish-app`).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/style.scss';
// Before anything loads the bridge: the statistics sink must be wired when analytics starts.
import './facade/usage-stats.ts';
import { Shell } from './Shell.tsx';
import { Product } from './Product.tsx';
import { createController } from '../src/controller/runner.ts';
import {
  consentAnswered,
  restoreDebug,
  sliderPreference,
  sliderPosition,
} from './facade/bridge.ts';

const root = document.getElementById('elmish-app');
if (!root) throw new Error('No #elmish-app element to mount the app into');
const app = createRoot(root);
function start() {
  // These are build-verified facts from the pinned manifest. Opening model-free views never acquires
  // runtime bytes. The actual runtime still verifies its manifest/assets when computation is requested.
  const runtimeSha256: unknown = import.meta.env.FACEMORPH_RUNTIME_SHA256;
  const modelSha256: unknown = import.meta.env.FACEMORPH_MODEL_SHA256;
  if (
    typeof runtimeSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(runtimeSha256) ||
    typeof modelSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(modelSha256)
  )
    throw Error('Runtime build identity is missing.');
  const controller = createController(
    {
      today: [
        new Date().getFullYear(),
        String(new Date().getMonth() + 1).padStart(2, '0'),
        String(new Date().getDate()).padStart(2, '0'),
      ].join('-'),
      url: location.href,
      consentAnswered: consentAnswered(),
      debugOn: restoreDebug(),
      sliderPreference: sliderPreference(),
      sliderPosition: sliderPosition(),
    },
    { identity: { runtimeSha256, modelSha256 } },
  );
  addEventListener('pagehide', (event) => {
    if (!event.persisted) void controller.dispose();
  });
  app.render(
    <StrictMode>
      <Product store={controller.store} />
    </StrictMode>,
  );
}
try {
  start();
} catch (error: unknown) {
  app.render(
    <Shell>
      <p role="alert">{error instanceof Error ? error.message : 'FaceMorph could not open.'}</p>
      <button onClick={() => location.reload()}>Retry</button>
    </Shell>,
  );
}
