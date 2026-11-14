import test from 'node:test';
import assert from 'node:assert/strict';
import {MirroringMediaStore} from '../src/publishing/mirroring-media-store.js';
import {importMirroringMedia} from '../src/publishing/mirroring-media.js';
test('an uncertain native media import cannot repeat Save Video or send phone input',async()=>{
 let state:string|undefined;let writes=0;const pool={query:async(sql:string)=>{
  if(sql.startsWith('SELECT'))return {rows:state?[{state}]:[]};
  if(sql.startsWith('INSERT')){writes++;if(state)return {rowCount:0};state='claimed';return {rowCount:1};}
  if(sql.startsWith('UPDATE')){if(state!=='claimed')return {rowCount:0};state='imported';return {rowCount:1};}
  throw new Error('Unexpected SQL');
 }};
 const journal=new MirroringMediaStore(pool as any).forPhone('synthetic-phone');const hash='a'.repeat(64);
 await journal.claim(hash);await assert.rejects(journal.claim(hash),/already attempted/);
 let nativeCalls=0;const screen=new Proxy({},{get(){return ()=>{nativeCalls++;throw new Error('No native action allowed');};}});
 await assert.rejects(importMirroringMedia(screen as any,{path:'/missing',sha256:hash} as any,journal),/uncertain/);assert.equal(nativeCalls,0);assert.equal(writes,2);
 await journal.complete(hash);assert.equal(await journal.state(hash),'imported');await assert.rejects(journal.claim(hash),/already attempted/);
});
