import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {NativeStoryStore,nativeStoryRevision,type NativeStoryFrame} from '../src/publishing/mirroring-stories.js';

test('an uncertain Story frame stops the sequence and keeps its per-slot claim',async()=>{
 const root=await mkdtemp(path.resolve('.scheduler-data/story-unit-'));
 try{
  const draft={policyVersion:1,nativeText:true,musicStyle:'music_only',frames:['moment','problem','proof','lesson','reply'].map((stage,i)=>({stage,text:'Frame '+(i+1),assetKind:i===2?'dashboard':'gallery_photo',assetRef:'synthetic:'+i,visualReviewed:true,claimReview:i===2?'source_checked':'no_factual_claim',...(i===2?{sourceRef:'synthetic-proof'}:{})}))};
  const frames:NativeStoryFrame[]=[];
  for(let i=0;i<5;i++){const file=path.join(root,i+'.png'),bytes=await sharp({create:{width:12,height:18,channels:3,background:{r:20+i*30,g:0,b:0}}}).png().toBuffer();await writeFile(file,bytes);const hash=createHash('sha256').update(bytes).digest('hex');frames.push({text:draft.frames[i]!.text,assetRef:draft.frames[i]!.assetRef,sourceSha256:hash,sourcePath:file,media:{path:file,name:i+'.png',mimeType:'image/png',sha256:hash},previewPath:file,previewSha256:hash});}
  const previewless=new NativeStoryStore({query:async(sql:string)=>{if(sql.includes('FROM scheduler.story_sequences'))return {rows:[{state:'needs_review',run_at:new Date(Date.now()+60_000),draft}]};if(sql.startsWith('SELECT'))return {rows:[]};throw new Error('Do not write a fake native approval');}} as any);
  await assert.rejects(previewless.prepare('synthetic',frames,'a'.repeat(64)),/actual native drafts/);
  const revision=await nativeStoryRevision(draft,frames);let state='armed',calls=0,exits=0;const claims:number[]=[],published:number[]=[];
  const row={id:'synthetic-job',native_frames:frames,revision,draft,device_udid:'synthetic-phone',run_at:new Date(),pilot:false};
  const c={query:async(sql:string,args:any[])=>{
    if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked:true}],rowCount:1};
    if(sql.includes("SET state='running'")){state='running';return {rows:[{id:row.id}],rowCount:1};}
    if(sql.includes('INSERT INTO scheduler.mirroring_story_frames')){assert.ok(!claims.includes(args[2]));claims.push(args[2]);return {rows:[{frame:args[2]}],rowCount:1};}
    if(sql.includes("SET state='published',receipts")){published.push(args[2]);return {rows:[],rowCount:1};}
    if(sql.includes("SET state='needs_review',result"))state='needs_review';
    return {rows:[],rowCount:1};
  },release(){}};
  const pool={query:async()=>({rows:state==='armed'?[row]:[]}),connect:async()=>c};
  const store=new NativeStoryStore(pool as any);
  const driver={publishFrame:async(_f:any,claim:()=>Promise<void>)=>{calls++;await claim();if(calls===2)throw new Error('Uncertain Story receipt');return {instagram:{verified:true,source:'instagram_app'},facebook:{verified:true,source:'facebook_app'}};},leaveVideo:async()=>{exits++;}};
  await store.tick('a'.repeat(64),async()=>driver as any);
  assert.equal(state,'needs_review');assert.deepEqual(claims,[1,2]);assert.deepEqual(published,[1]);assert.equal(calls,2);assert.equal(exits,1);
  await store.tick('a'.repeat(64),async()=>driver as any);assert.equal(calls,2);
  const unsupported=structuredClone(draft);unsupported.frames[0]!.assetKind='b_roll';unsupported.policyVersion=2;(unsupported as any).format='proof_led';(unsupported.frames[0] as any).clipStartSeconds=0;(unsupported.frames[0] as any).clipEndSeconds=4;await assert.rejects(nativeStoryRevision(unsupported,frames),/B-roll/);
  const duplicate=frames.map(f=>({...f,sourceSha256:frames[0]!.sourceSha256}));await assert.rejects(nativeStoryRevision(draft,duplicate),/different/);
  await writeFile(frames[0]!.previewPath,'changed');await assert.rejects(nativeStoryRevision(draft,frames),/changed/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('generic schedule approval cannot approve a native Story job',async()=>{
 let writes=0;const store=new NativeStoryStore({query:async()=>{writes++;return {rows:[]};}} as any);
 await assert.rejects(store.approve('job','a'.repeat(64),[1,2,3,4],true),/five/);
 await assert.rejects(store.approve('job','a'.repeat(64),[1,2,3,4,5],false),/five/);assert.equal(writes,0);
});
