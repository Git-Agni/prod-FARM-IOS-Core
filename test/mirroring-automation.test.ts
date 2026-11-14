import test from 'node:test';
import assert from 'node:assert/strict';
import {MirroringAutomationStore,qualifiedNativeFlow,nativeGroup,nativeFingerprint} from '../src/publishing/mirroring-automation.js';
import {MirrorScreen} from '../src/devices/mirroring/screen.js';
import sharp from 'sharp';
import {uniqueImageMatch,nativeReferenceDistance} from '../src/publishing/mirroring-cover.js';
import {validateNativeFlow,validateNativePhase,MirroringFlowRelease,runNativePhase,type NativeVideoFlow} from '../src/publishing/mirroring-flow.js';
const region={x:0,y:0,width:1,height:1},context=['Fixture'];
const field=(name:string,key:string)=>({kind:'field',name,field:key,region,context});
const label=(name:string,text:string)=>({kind:'label',name,label:text,region,context});
function fixture(){return {version:1,platform:'tiktok',account:'antoniorevenue',identity:{steps:[],checks:[field('account','account')]},compose:{steps:[{kind:'proof',check:field('selected_duration','duration'),context}],checks:[field('caption','caption'),{kind:'image',name:'opening_cover',region,maxDistance:0.065,context},label('public_visibility','Everyone can view this post.'),{kind:'toggle',name:'manual_ai_off',label:'AI-generated content',enabled:false,referencePath:'/synthetic/off.png',referenceSha256:'a'.repeat(64),maxDistance:.025,region,context}]},receipts:{steps:[],checks:[field('published_caption','caption'),field('published_account','account'),label('published_marker','Creator'),{kind:'image',name:'published_cover',region,maxDistance:0.03,context}]},submit:{label:'Post',context,minY:0.8,maxY:0.98}};}

test('no configuration or stale certificate qualifies a native flow',()=>{
 const hash='a'.repeat(64);assert.equal(qualifiedNativeFlow(hash,null),false);
 assert.equal(qualifiedNativeFlow(hash,{fingerprint:hash,pilot_item_id:'item',verified_at:'invalid'}),false);
 assert.equal(qualifiedNativeFlow(hash,{fingerprint:'b'.repeat(64),pilot_item_id:'item',verified_at:new Date().toISOString()}),false);
 assert.equal(qualifiedNativeFlow(hash,{fingerprint:hash,pilot_item_id:'item',verified_at:new Date().toISOString()}),true);
});
test('foreground pause rejects every input and Home before a native command',async()=>{
 const s=new MirrorScreen(new AbortController().signal);let observed=0;s.snapshot=async()=>{observed++;throw new Error('must not observe');};s.beforeInput=async()=>{throw new Error('paused');};
 await assert.rejects(s.tap(.5,.5,['Fixture']),/paused/);await assert.rejects(s.home(),/paused/);assert.equal(observed,0);
});
test('paused automation rejects a worker pilot without reading or changing a release',async()=>{
 const reads:string[]=[];const store=new MirroringAutomationStore({query:async(sql:string)=>{reads.push(sql);return {rows:[],rowCount:0};}} as any);
 await assert.rejects(store.requestPilot('11111111-1111-4111-8111-111111111111',1),/foreground/);
 assert.equal(reads.some(s=>s.includes('SELECT i.*')),false);assert.equal(reads.some(s=>s.includes('INSERT INTO scheduler.mirroring_worker_pilots')),false);
});
test('cover matching rejects a close second candidate and missing source',()=>{
 assert.throws(()=>uniqueImageMatch([.04,.06],.15,.05),/ambiguous/);
 assert.throws(()=>uniqueImageMatch([.19,.4],.15,.05),/missing/);
 assert.equal(uniqueImageMatch([.13,.26,.24],.15,.05).index,0);
});
test('native layouts require real account, selected clip, caption, cover and receipt checks',()=>{
 assert.equal(validateNativeFlow(fixture()).platform,'tiktok');
 const bad=fixture();bad.compose.checks=bad.compose.checks.filter(c=>c.name!=='manual_ai_off');assert.throws(()=>validateNativeFlow(bad),/manual AI/);
 const missing=fixture();missing.compose.steps=[];assert.throws(()=>validateNativeFlow(missing),/duration/);
 const fake=fixture();fake.identity.checks=[label('account','antoniorevenue') as any];assert.throws(()=>validateNativeFlow(fake),/Account/);
});
test('native navigation cannot declare a submit or execute unknown operations',()=>{
 const check=field('caption','caption') as any;
 for(const steps of [[{kind:'tap',label:'Post',context,minY:.1,maxY:.9}],[{kind:'point',x:Infinity,y:.5,context}],[{kind:'run',code:'anything',context}]])assert.throws(()=>validateNativePhase({steps,checks:[check]} as any));
});
test('an uncertain generic native submit is one shot',async()=>{
 const d=new MirroringFlowRelease(new AbortController().signal,validateNativeFlow(fixture()),'/unused',{} as any);let sent=0;
 d.screen.tapText=async()=>{sent++;throw new Error('lost response');};
 await assert.rejects(d.shareOnce(),/incomplete/);assert.equal(sent,0);
 (d as any).prepared=true;await assert.rejects(d.shareOnce(),/lost response/);await assert.rejects(d.shareOnce(),/already attempted/);assert.equal(sent,1);
});
test('a native composer cannot qualify as a published caption receipt',async()=>{
 const d=new MirrorScreen(new AbortController().signal);
 d.waitFor=async()=>({width:10,height:10,png:'',text:['Post','The full saved caption'],lines:[{text:'Post',confidence:1,x:0,y:0,width:.1,height:.1},{text:'The full saved caption',confidence:1,x:0,y:.2,width:.9,height:.1}]});
 await assert.rejects(runNativePhase(d,{steps:[],checks:[field('published_caption','caption') as any]},'receipt',{caption:'The full saved caption'} as any,undefined,async()=>{}),/composer/);
});
test('missing words or a wrong receipt account stop a native phase',async()=>{
 const d=new MirrorScreen(new AbortController().signal);let proofs=0;
 d.waitFor=async()=>({width:10,height:10,png:'',text:['wrong'],lines:[{text:'wrong',confidence:1,x:0,y:.2,width:.9,height:.1}]});
 await assert.rejects(runNativePhase(d,{steps:[],checks:[field('published_account','account') as any]},'receipt',{targets:[{account:'antoniorevenue'}]} as any,undefined,async()=>{proofs++;}),/field did not match/);assert.equal(proofs,0);
});

test('a worker pilot needs a claimed post and independent receipts for both linked destinations',async()=>{
 const fingerprint=await nativeFingerprint('instagram_facebook');
 const input={targets:[{platform:'instagram',account:'antoniorevenue'},{platform:'facebook',account:'Antonio Revenue'}]};
 const base={item_id:'11111111-1111-4111-8111-111111111111',input,fingerprint,release_state:'published',share_claimed_at:new Date(),result:{nativeFlowFingerprint:fingerprint,receipts:{instagram:{verified:true,source:'instagram_app'},facebook:{verified:true,source:'facebook_app'}}}};
 for(const [row,expected] of [[base,true],[{...base,share_claimed_at:null},false],[{...base,result:{...base.result,receipts:{instagram:base.result.receipts.instagram}}},false],[{...base,result:{...base.result,receipts:{...base.result.receipts,facebook:{verified:true,source:'linked_setting'}}}},false],[{...base,input:{targets:[input.targets[0]]}},false],[{...base,result:{...base.result,nativeFlowFingerprint:'b'.repeat(64)}},false]] as const){
  let certified=false;const c={query:async(sql:string)=>{if(sql.includes('FOR UPDATE OF p'))return {rows:[row]};if(sql.includes('INSERT INTO scheduler.mirroring_flow_certificates'))certified=true;return {rows:[],rowCount:1};},release(){}};
  const store=new MirroringAutomationStore({connect:async()=>c} as any);await store.finishPilot(base.item_id);assert.equal(certified,expected);
 }
});

test('native switch proof uses the saved visual state rather than an OCR Off label',async()=>{
 const off=await sharp({create:{width:64,height:32,channels:3,background:'#111111'}}).png().toBuffer();
 const on=await sharp({create:{width:64,height:32,channels:3,background:'#dddddd'}}).png().toBuffer();
 const snapshot=(bytes:Buffer)=>({width:64,height:32,png:bytes.toString('base64'),text:[],lines:[]});
 assert.equal(await nativeReferenceDistance(off,snapshot(off),region),0);
 assert.ok(await nativeReferenceDistance(off,snapshot(on),region)>.025);
 const fake=fixture();fake.compose.checks=fake.compose.checks.map(c=>c.name==='manual_ai_off'?label('manual_ai_off','Off') as any:c);assert.throws(()=>validateNativeFlow(fake),/manual AI/);
});
