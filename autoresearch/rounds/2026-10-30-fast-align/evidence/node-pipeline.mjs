// One worker-equivalent alignment: hash model, instantiate, load predictor, decode, detect, prepare.
import { readFile } from 'node:fs/promises';
import { Sha256 } from './sha256.mjs';
const [, , dir, hashMode, img] = process.argv;
const t = () => performance.now();
const T0 = t();
const st = {};
const lap = (k, a) => (st[k] = Math.round(t() - a));
const model = await readFile('shape_predictor_68_face_landmarks.dat');
const bytes = await readFile(img);
let a = t();
const create = (await import('./' + dir + '/photo-native.mjs')).default;
const m = await create({
  wasmBinary: await readFile(dir + '/photo-native.wasm'),
  print() {},
  printErr() {},
});
lap('runtime', a);
const p = m._malloc(model.length);
a = t();
m.HEAPU8.set(model, p);
if (hashMode === 'js') {
  const h = new Sha256();
  h.update(m.HEAPU8.subarray(p, p + model.length));
  h.hex();
} else {
  await crypto.subtle.digest('SHA-256', m.HEAPU8.subarray(p, p + model.length));
}
lap('modelHash', a);
a = t();
if (m._cf_init_predictor(p, model.length) < 0) throw Error('init');
lap('deserialize', a);
m._free(p);
const q = m._malloc(bytes.length);
m.HEAPU8.set(bytes, q);
a = t();
m._cf_decode(q, bytes.length);
lap('decode', a);
m._free(q);
a = t();
const faces = m._cf_detect();
lap('detect', a);
a = t();
m._cf_prepare(1);
lap('prepare', a);
st.faces = faces;
st.total = Math.round(t() - T0);
console.log(JSON.stringify(st));
