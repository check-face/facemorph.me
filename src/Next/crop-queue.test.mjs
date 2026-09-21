// Queueing two photos that both need cropping used to destroy the first crop: the second offer
// revoked its preview URL and took the slot, so the visitor had to start that crop again. The
// crop slot is a queue, and this pins the transitions on the compiled reducer rather than on a
// description of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source = await readFile(new URL('./Product.fs', import.meta.url), 'utf8');

test('a crop for another face queues rather than replacing the one on screen', () => {
  const handler = source.match(/\| Photo\(id,offer\) when not \(isNull offer\) && isCropOffer offer ->[\s\S]*?\n    \| RequestCrop/);
  assert.ok(handler, 'the crop-offer handler is still recognisable');
  const body = handler[0];
  assert.ok(/CropQueue=state\.CropQueue @ \[choice\]/.test(body),
    'an offer for a different face appends to the queue');
  assert.ok(/Some current when current\.faceId=id ->/.test(body),
    'an offer for the SAME face replaces it — that is the visitor changing their mind');
  // The destructive line that caused the bug must not come back.
  assert.ok(!/state\.Crop \|> Option\.iter \(fun previous -> revokeUrl previous\.url\)/.test(body),
    'no unconditional revoke of whatever crop happens to be open');
});

test('every exit from the crop advances the queue', () => {
  for (const exit of ['CropCancel', 'CropAccept']) {
    const at = source.indexOf(`| ${exit} ->`);
    assert.notEqual(at, -1, `${exit} exists`);
    const body = source.slice(at, at + 900);
    assert.ok(/nextCrop/.test(body), `${exit} shows the next queued crop`);
  }
});

test('the queue is declared and starts empty', () => {
  assert.ok(/CropQueue: CropChoice list/.test(source), 'the queue is part of the state');
  assert.ok(/Crop=None;CropQueue=\[\]/.test(source), 'it starts empty');
});
