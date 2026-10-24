// The manager's producer-facing contract, as a model host or converter would use it.
import {
  MANIFEST_SCHEMA_MAJOR,
  parseModelManifest,
  type ModelManifestV1,
} from '@facemorph/browser-model-manager';

export function checkManifest(json: unknown): ModelManifestV1 | string {
  const r = parseModelManifest(json);
  return r.ok ? r.value : `${r.error.code} at ${r.error.path} (major ${MANIFEST_SCHEMA_MAJOR})`;
}
