// The worker side: serveEngine over the engine the host app constructs inside this worker.
import { serveEngine } from 'stylegan-js/engine';

self.addEventListener('message', function boot(event) {
  if (event.data?.type !== 'facemorph-consumer-boot') return;
  self.removeEventListener('message', boot);
  serveEngine(self, event.data.engine);
});
