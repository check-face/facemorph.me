// The kept deletion receipt and the learnings note carry no key, run ID, token value or report content
// (bead fm-xgww): every identifier class of the scan applies. The receipt's own fields are allowed only in
// their recorded forms: lowercase 64-hex digests and 32-hex Cloudflare token IDs, plus the two reviewed
// strings that look like base64 to the scan (a JSON field name and a scanned root path).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { KEY_LIST_DIGEST, scanText } from './scan-learnings-note.mjs';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const RECEIPT = 'docs/receipts/diagnostics/old-report-deletion-2026-10-24.md';
const NOTE = 'docs/findings/diagnostics-learnings-2026-10-18.md';
const REVIEWED = ['uploadedOnOrAfter18Oct', '/home/cdilga/Downloads'];

test('the receipt holds digests and token IDs only in their recorded forms', () => {
  const text = read(RECEIPT);
  const fields = [...new Set(text.match(/\b[0-9a-f]{64}\b|\b[0-9a-f]{32}\b/g) ?? [])];
  assert.deepEqual(scanText(text, { allow: [KEY_LIST_DIGEST, ...fields, ...REVIEWED] }), []);
  // The digests that bind the deletion are the ones the bead names.
  assert.ok(text.includes(KEY_LIST_DIGEST));
  assert.match(text, /Deleted: 0/);
  assert.match(text, /Count deleted: 801/);
});

test('the learnings note is aggregates only', () => {
  assert.deepEqual(scanText(read(NOTE)), []);
});
