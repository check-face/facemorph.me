// Generates a local config overlay only. Does not sign, build, or publish.
import { readFile, writeFile } from 'node:fs/promises';
const key = process.env.CHECKFACE_UPDATER_PUBLIC_KEY;
if (!key || key.includes('PRIVATE') || !/^[A-Za-z0-9+/=]+$/.test(key)) {
  throw new Error('Set CHECKFACE_UPDATER_PUBLIC_KEY to the Tauri base64 PUBLIC key');
}
const config = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url)));
await writeFile(new URL('../release-config.json', import.meta.url), JSON.stringify({
  version: config.version,
  bundle: { active: true, createUpdaterArtifacts: true },
  plugins: { updater: {
    pubkey: key,
    endpoints: ['https://github.com/check-face/facemorph.me/releases/latest/download/latest.json']
  } }
}, null, 2) + '\n');
console.log('Prepared release overlay. Qualification, signing and publication are separate gates.');
