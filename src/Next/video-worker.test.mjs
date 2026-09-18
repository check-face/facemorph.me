// The muxed MP4 must carry the encoder's decoderConfig.description wrapped in an avcC box
// inside the avc1 sample entry. Without the box players have no SPS/PPS and every sample
// fails to decode (PIPELINE_ERROR_DECODE on the first delta frame); with it the file plays.
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.self = globalThis;
const { muxMp4 } = await import('./video-worker.mjs');
const AVC_C = Uint8Array.from([1, 100, 0, 31, 255, 225, 0, 20, 103, 100, 0, 31, 172, 217, 192, 80, 5, 187, 23, 138, 17, 177, 194, 244, 192, 68, 0, 0, 3, 0, 4, 0, 0, 3, 0, 242, 200, 120, 107]);
const sample = (index, type) => ({ type, timestamp: index * 62500, duration: 62500, size: 4, data: Uint8Array.from([0, 0, 0, 1 + index]) });
function boxAt(data, name, from = 0) {
 for (let i = from; i < data.length - 4; i++) if (data[i] === name.charCodeAt(0) && data[i + 1] === name.charCodeAt(1) && data[i + 2] === name.charCodeAt(2) && data[i + 3] === name.charCodeAt(3)) return i;
 return -1;
}
test('muxed MP4 wraps the decoder config in an avcC box inside the sample entry', () => {
 const mp4 = muxMp4([sample(0, 'key'), sample(1, 'delta')], AVC_C, 512, 512, 16);
 const at = boxAt(mp4, 'avcC');
 assert.notEqual(at, -1, 'avcC box missing from the sample entry');
 const size = (mp4[at - 4] << 24) | (mp4[at - 3] << 16) | (mp4[at - 2] << 8) | mp4[at - 1];
 assert.equal(size, AVC_C.length + 8, 'avcC box must contain exactly the description plus its 8-byte header');
});
test('sync samples list exactly the keyframe chunks', () => {
 const mp4 = muxMp4([sample(0, 'key'), sample(1, 'delta'), sample(2, 'delta')], AVC_C, 512, 512, 16);
 const at = boxAt(mp4, 'stss');
 // fullBox: after the name come version+flags, then the entry count, then the entries.
 const count = (mp4[at + 8] << 24) | (mp4[at + 9] << 16) | (mp4[at + 10] << 8) | mp4[at + 11];
 assert.equal(count, 1, 'one keyframe expected');
 const entry = (mp4[at + 12] << 24) | (mp4[at + 13] << 16) | (mp4[at + 14] << 8) | mp4[at + 15];
 assert.equal(entry, 1, 'the keyframe is the first sample');
});
