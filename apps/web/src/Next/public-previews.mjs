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
    return row?.fullAsset ? checkedAssetUrl(row.fullAsset, row.id, 'full', 'jpg') : row ? galleryTextUrl(origin, row.id, row.full ? 1024 : 200, row.full || 'jpg') : '';
  }
  if (mode === 'seed' && /^(0|[1-9][0-9]*)$/.test(value || '')) {
    const seed = Number(value), range = catalogue.seeds;
    if (Number.isSafeInteger(seed) && seed >= range?.from && seed <= range?.to)
      return gallerySeedUrl(origin, seed, range.dimension, range.format);
  }
  return '';
}

const NAME_ORIGIN='https://facemorph-name-catalogue.cdilga.workers.dev';
function checkedAssetUrl(asset,id,folder,extension){
 if(!HEX64.test(id||'')||!HEX64.test(asset?.sha256||'')||!Number.isInteger(asset?.size)||asset.size<=0||asset.size>4*1024*1024)throw Error('Invalid public name asset.');
 const expected=`${NAME_ORIGIN}/${folder}/${id}.${extension}`;
 if(asset.url!==expected)throw Error('Invalid public name asset origin or identity.');
 return expected;
}

/** Only deliberate generation requests fetch W+. Hosted JPEGs never enter the original cache. */
export async function publicNameLatent(value,manifest,{signal}={}){
 const catalogue=await getPublicCatalogue();
 const row=catalogue.names.find(row=>row.value===value);
 if(!row?.latent)return null;
 const asset=row.latent;
 const id=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),x=>x.toString(16).padStart(2,'0')).join('');
 if(row.id!==id||asset.size!==36864||asset.space!=='w-plus'||JSON.stringify(asset.shape)!=='[18,512]'||asset.modelSha256!==manifest.modelSourceSha256)throw Error('Public name latent identity mismatch.');
 const {generationIdentity}=await import('./browser/identity.mjs');
 const identity=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(generationIdentity(manifest,'seed'))));
 if(asset.generationSha256!==Array.from(new Uint8Array(identity),x=>x.toString(16).padStart(2,'0')).join(''))throw Error('Public name generation identity mismatch.');
 const response=await fetch(checkedAssetUrl(asset,id,'latent','f32'),{signal});
 if(!response.ok)throw Error('Public name latent unavailable.');
 const bytes=await response.arrayBuffer();
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
 if(bytes.byteLength!==asset.size||hash!==asset.sha256)throw Error('Public name latent integrity mismatch.');
 const view=new DataView(bytes),values=Float32Array.from({length:9216},(_,i)=>view.getFloat32(i*4,true));
 if(!values.every(Number.isFinite))throw Error('Invalid public name latent values.');
 return {space:'w-plus',shape:[1,18,512],values};
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
