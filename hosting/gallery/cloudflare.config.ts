// Static catalogue only. The publisher supplies a fully validated, retention-complete tree.
import { defineConfig } from 'cf/config';
export default defineConfig({ worker: { name: 'facemorph-name-catalogue', compatibilityDate: '2026-10-25', workersDev: true, observability: { enabled: false } } });
