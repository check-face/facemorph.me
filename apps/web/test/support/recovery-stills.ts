// Recovery stills built for tests (fm-4f5m): a decodable PNG carrying a well-formed FaceMorph record of a schema
// this app does not read. Shared by the controller unit tests and the still-entry e2e.
import { readFileSync } from 'node:fs';

const plainPng = () =>
  new Uint8Array(
    readFileSync(
      new URL('../../../../packages/stylegan-js/test/vectors/plain.png', import.meta.url),
    ),
  );

function crc32(data: Uint8Array): number {
  let n = 0xffffffff;
  for (const b of data) {
    n ^= b;
    for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  }
  return (n ^ 0xffffffff) >>> 0;
}
/** A decodable PNG carrying a well-formed FaceMorph record of schema `version`. */
export function futureSchemaPng(version: number): Uint8Array {
  const plain = plainPng();
  const payload = Buffer.from(`FaceMorph\0{"schema":${version}}`);
  const chunk = Buffer.alloc(payload.length + 12);
  chunk.writeUInt32BE(payload.length, 0);
  chunk.write('tEXt', 4);
  payload.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, chunk.length - 4)), chunk.length - 4);
  const iend = plain.length - 12;
  return new Uint8Array(Buffer.concat([plain.subarray(0, iend), chunk, plain.subarray(iend)]));
}
