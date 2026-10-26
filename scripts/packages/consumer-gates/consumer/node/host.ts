// cloudflare-model-host from the packed declarations (fm-3osh acceptance in fm-7ge): staging
// and verification, as an outside Node consumer uses them.
import {
  CHUNK_BYTES,
  PACKAGE,
  STATIC_ASSET_FILE_LIMIT_BYTES,
  stage,
  verifyRoot,
} from 'cloudflare-model-host';

export function stageAndVerify(source: string, out: string, base: string): boolean {
  const staged = stage({ source, out, base });
  const verified = verifyRoot({ root: out, base });
  return staged.assets > 0 && verified.ok && CHUNK_BYTES < STATIC_ASSET_FILE_LIMIT_BYTES;
}

export const name: 'cloudflare-model-host' = PACKAGE;
