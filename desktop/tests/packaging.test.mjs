import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const desktop=fileURLToPath(new URL('..',import.meta.url));

test('stages shared assets with valid checksum manifest and excludes server/source maps', async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'checkface-stage-'));
  try {
    await mkdir(path.join(root,'desktop/scripts'),{recursive:true});
    await mkdir(path.join(root,'deploy/api'),{recursive:true});
    await cp(path.join(desktop,'scripts/stage-frontend.mjs'),path.join(root,'desktop/scripts/stage-frontend.mjs'));
    for(const [name,data] of Object.entries({'index.html':'<html></html>','app.js':'console.log(1)','app.js.map':'{}','vercel.json':'{}','package.json':'{}','api/server.js':'server'})) await writeFile(path.join(root,'deploy',name),data);
    const result=spawnSync(process.execPath,[path.join(root,'desktop/scripts/stage-frontend.mjs')],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const staged=path.join(root,'desktop/frontend');
    assert.deepEqual((await readdir(staged)).sort(),['app.js','desktop-assets.json','index.html']);
    const manifest=JSON.parse(await readFile(path.join(staged,'desktop-assets.json'),'utf8'));
    for(const file of manifest.files) assert.equal(file.sha256,createHash('sha256').update(await readFile(path.join(staged,file.path))).digest('hex'));
  } finally {await rm(root,{recursive:true,force:true});}
});

test('release overlay requires public key and produces parseable signed HTTPS configuration',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'checkface-release-'));
  try {
    await mkdir(path.join(root,'scripts')); await mkdir(path.join(root,'src-tauri'));
    await cp(path.join(desktop,'scripts/prepare-release.mjs'),path.join(root,'scripts/prepare-release.mjs'));
    await cp(path.join(desktop,'src-tauri/tauri.conf.json'),path.join(root,'src-tauri/tauri.conf.json'));
    let result=spawnSync(process.execPath,[path.join(root,'scripts/prepare-release.mjs')],{env:{...process.env,CHECKFACE_UPDATER_PUBLIC_KEY:''},encoding:'utf8'});
    assert.notEqual(result.status,0);
    const publicKey=Buffer.from('untrusted comment: test fixture only\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3').toString('base64');
    result=spawnSync(process.execPath,[path.join(root,'scripts/prepare-release.mjs')],{env:{...process.env,CHECKFACE_UPDATER_PUBLIC_KEY:publicKey},encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const config=JSON.parse(await readFile(path.join(root,'release-config.json'),'utf8'));
    assert.equal(config.bundle.createUpdaterArtifacts,true);
    assert.equal(config.plugins.updater.pubkey,publicKey);
    assert.equal(config.plugins.updater.endpoints[0],'https://github.com/check-face/facemorph.me/releases/latest/download/latest.json');
  }finally {await rm(root,{recursive:true,force:true});}
});
