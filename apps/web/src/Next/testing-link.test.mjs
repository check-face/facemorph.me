// The testing link invites reporting prominently; it must never enable or send anything by itself.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';import {webcrypto} from 'node:crypto';
const read=n=>fs.readFile(new URL(n,import.meta.url),'utf8');
const plain=s=>s.replace(/^import .*;\n/gm,'').replaceAll('export ','').replaceAll('import.meta.url',JSON.stringify(import.meta.url));

test('Opening the testing link uploads nothing until the tester agrees',async()=>{
 const source=plain(await read('reporting.mjs')),posts=[],stored=new Map();
 const ctx=vm.createContext({AbortController,crypto:webcrypto,Date,performance:{now:()=>0},setTimeout:()=>1,clearTimeout(){},
  localStorage:{getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},
  navigator:{userAgent:'Safari iPhone',platform:'iPhone',language:'en-AU'},
  window:{dispatchEvent(){}},CustomEvent:class{constructor(t,{detail}){this.detail=detail;}},
  fetch:async(url,request)=>{posts.push(JSON.parse(request.body));return {ok:true};}});
 vm.runInContext(source+'\nglobalThis.d=diagnostics;',ctx);
 const d=ctx.d;
 // A tester opens the link and starts using the product without answering the invitation.
 d.restore();
 d.start('faces');d.stage('synthesis',{elapsedMs:10});d.finish('completed');
 assert.equal(posts.length,0,'the invitation alone sends nothing');
 assert.equal(d.status().enabled,false);
 // Only an explicit yes turns it on, and then reporting behaves normally.
 d.enable(true);
 d.start('faces');d.stage('synthesis',{elapsedMs:10});
 assert(posts.length>0,'an explicit yes starts reporting');
 assert(!JSON.stringify(posts).includes('photo'));
 // Declining later stops it and clears the stored consent.
 d.enable(false);const after=posts.length;
 d.start('faces');d.stage('synthesis',{elapsedMs:10});
 assert.equal(posts.length,after,'turning it off stops reporting');
});
