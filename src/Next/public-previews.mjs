// Historic lossy faces are display previews, never canonical originals or morph inputs.
// The default `hello` face existed in the classic API cache but was omitted from
// the later static gallery selection. Its reviewed copy ships with this site.
export const HELLO_PREVIEW = '/preview/hello-1024.webp';
const HEX64 = /^[a-f0-9]{64}$/;
let cataloguePromise;

export function galleryTextUrl(origin, hash, dimension, format) {
  if (!HEX64.test(hash || '')) throw Error('Invalid gallery identity.');
  return `${origin}/outputImages/hash-${hash.slice(0, 2)}/${hash.slice(2, 4)}/hash-${hash}_${dimension}.${format}`;
}

export function gallerySeedUrl(origin, seed, dimension, format) {
  if (!Number.isInteger(seed) || seed < 0) throw Error('Invalid gallery seed.');
  return `${origin}/outputImages/s${seed % 100}/${seed}/s${seed}_${dimension}.${format}`;
}

export function getPublicCatalogue() {
  if (!cataloguePromise) cataloguePromise = (async () => {
    const response = await fetch('/catalogue.json');
    if (!response.ok) throw Error('The name gallery is unavailable. You can still enter any name.');
    const data = await response.json();
    if (!Array.isArray(data.names) || data.names.length > 10000) throw Error('Invalid name gallery.');
    const origin = String(data.origin || '');
    if (origin && new URL(origin).protocol !== 'https:') throw Error('Invalid name gallery origin.');
    return data;
  })().catch(error => { cataloguePromise = undefined; throw error; });
  return cataloguePromise;
}

export function previewUrl(catalogue, mode, value) {
  if (mode === 'text' && value === 'hello') return HELLO_PREVIEW;
  const origin = String(catalogue?.origin || '');
  if (!origin || new URL(origin).protocol !== 'https:') return '';
  if (mode === 'text') {
    const row = catalogue.names?.find(name => name.value === value && HEX64.test(name.id || ''));
    return row ? galleryTextUrl(origin, row.id, row.full ? 1024 : 200, row.full || 'jpg') : '';
  }
  if (mode === 'seed' && /^(0|[1-9][0-9]*)$/.test(value || '')) {
    const seed = Number(value), range = catalogue.seeds;
    if (Number.isSafeInteger(seed) && seed >= range?.from && seed <= range?.to)
      return gallerySeedUrl(origin, seed, range.dimension, range.format);
  }
  return '';
}

function imageAvailable(url) {
  return new Promise(resolve => {
    const image = new Image();
    const timer = setTimeout(() => { image.onload = image.onerror = null; resolve(''); }, 10000);
    image.onload = () => { clearTimeout(timer); resolve(url); };
    image.onerror = () => { clearTimeout(timer); resolve(''); };
    image.src = url;
  });
}

export async function publicPreview(mode, value) {
  if (mode !== 'text' && mode !== 'seed') return '';
  try {
    const catalogue = mode === 'text' && value === 'hello' ? null : await getPublicCatalogue();
    const url = previewUrl(catalogue, mode, value);
    return url ? await imageAvailable(url) : '';
  } catch { return ''; }
}
