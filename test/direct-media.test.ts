import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {DirectMediaStore} from '../src/publishing/direct-media.js';
test('uncertain native import keeps its claim and cannot import the video twice',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'direct-import-'));const file=path.join(dir,'video.mp4');await writeFile(file,'fixture');
 let claimed=false,state='',calls=0;const original=globalThis.fetch;
 const pool={query:async(sql:string)=>{
  if(sql.startsWith('INSERT')){if(claimed)return {rowCount:0,rows:[]};claimed=true;state='importing';return {rowCount:1,rows:[{}]};}
  if(sql.startsWith('UPDATE')){state='uncertain';return {rows:[]};}
  if(sql.startsWith('SELECT'))return {rows:[{state}]};return {rows:[]};
 }};
 globalThis.fetch=async()=>{calls++;throw Error('Lost import response');};
 try{const store=new DirectMediaStore(pool as any);const media={path:file,name:'video.mp4',mimeType:'video/mp4',sha256:createHash('sha256').update('fixture').digest('hex')};
 await assert.rejects(store.ensure('phone',media,'http://unused',new AbortController().signal),/Lost import/);
 await assert.rejects(store.ensure('phone',media,'http://unused',new AbortController().signal),/prior import needs review/);
 assert.equal(calls,1);assert.equal(state,'uncertain');
 }finally{globalThis.fetch=original;await rm(dir,{recursive:true,force:true});}
});
