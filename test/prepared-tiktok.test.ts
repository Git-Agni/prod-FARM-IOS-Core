import test from 'node:test';import assert from 'node:assert/strict';
import{assertPreparedTikTok,PreparedTikTokRelease}from'../src/publishing/prepared-tiktok.js';
import{preparedInputHash}from'../src/publishing/prepared-instagram.js';
const now=Date.now(),input:any={requestId:'prepared_tt_test',deviceUdid:'testphone123',caption:'Reviewed caption',runAt:new Date(now).toISOString(),timezone:'America/Los_Angeles',targets:[{platform:'tiktok',account:'antoniorevenue'}],instagramTrial:false,automaticPromotion:false,facebookMode:'linked_from_instagram'};
const item:any={id:'item',version:3,status:'held',input,media:{sha256:'abc'}};
const proof:any={kind:'tiktok',itemId:'item',itemVersion:3,sourceSha256:'abc',inputHash:preparedInputHash(input,'abc'),sessionId:'session',checkedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+60000).toISOString(),coverReviewed:true,duplicateCheckComplete:true,phoneVolumeZero:true,nativeExport:{galleryLabel:'29 seconds',coverHook:'Reviewed hook',downloadedAt:new Date(now-10000).toISOString()},evidence:{account:true,caption:true,exactMedia:true,videoFrameCover:true,automaticPromotion:false,linkedFacebook:false}};
test('prepared TikTok rejects changed items, stale reviews and missing export evidence',()=>{
 assert.doesNotThrow(()=>assertPreparedTikTok(item,proof,now));
 for(const changed of [{...item,version:4},{...item,status:'published'},{...item,input:{...input,caption:'Changed'}},{...item,media:{sha256:'other'}}])assert.throws(()=>assertPreparedTikTok(changed,proof,now));
 for(const patch of [{expiresAt:new Date(now-1).toISOString()},{expiresAt:new Date(now+700000).toISOString()},{phoneVolumeZero:false},{coverReviewed:false},{duplicateCheckComplete:false},{nativeExport:null}])assert.throws(()=>assertPreparedTikTok(item,{...proof,...patch},now));
});
test('prepared TikTok never repeats Post after a lost response',async()=>{
 const d=new PreparedTikTokRelease('http://unused',new AbortController().signal,item) as any;
 d.prepared=true;d.waitFor=async()=> 'post';d.assertInputApp=async()=>{};let calls=0;d.request=async()=>{calls++;throw Error('Lost response')};
 await assert.rejects(d.shareOnce(),/Lost response/);await assert.rejects(d.shareOnce(),/preflight/);assert.equal(calls,1);
});
