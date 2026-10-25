// The former source-reading checks now exercise the actual TypeScript reducer (fm-j16n).
import test from 'node:test';
import assert from 'node:assert/strict';
import { msg } from '../controller/msg.ts';
import { crop } from '../controller/reducers/crop.ts';
import { offerCrop } from '../controller/reducers/photo.ts';
import { state, offer } from '../../test/controller/photo-inputs.ts';

test('a crop for another face queues rather than replacing the one on screen', () => {
 const first=offerCrop(state,'face-1',offer('one.jpg'));
 const queued=offerCrop(first.state,'face-2',offer('two.jpg'));
 assert.equal(queued.state.Crop,first.state.Crop);
 assert.deepEqual(queued.state.CropQueue.map(choice=>choice.faceId),['face-2']);
 assert.deepEqual(queued.effects,[],'no release of the previous crop');
 const replacement=offerCrop(queued.state,'face-1',offer('replacement.jpg'));
 assert.equal(replacement.state.Crop.url,'blob:replacement.jpg');
 assert.deepEqual(replacement.effects,[{type:'revokeUrl',url:'blob:one.jpg'},{type:'focusCropArea'}]);
});
test('every exit from the crop advances the queue', () => {
 const first=offerCrop(state,'face-1',offer('one.jpg'));
 const queued=offerCrop(first.state,'face-2',offer('two.jpg')).state;
 for(const message of [msg('CropCancel'),msg('CropAccept')]) {
  const next=crop(message,queued,{photoRevision:1});
  assert.equal(next.state.Crop.faceId,'face-2');
  assert.equal(next.state.CropQueue.length,0);
  assert.ok(next.effects.some(effect=>effect.type==='focusCropArea'));
 }
});
test('the crop queue starts empty', () => {
 assert.equal(state.Crop,null);
 assert.deepEqual(state.CropQueue,[]);
});
