import test from 'node:test';import assert from 'node:assert/strict';
import {assertPreparedYouTube,PreparedYouTubeRelease} from '../src/publishing/prepared-youtube.js';
import {requestHash} from '../src/publishing/model.js';
import {validatePostingInput} from '../src/publishing/model.js';
test('a changed or expired YouTube handoff cannot tap Upload',async()=>{
 const item={id:'test-item',version:1,status:'held',media:{sha256:'a'.repeat(64)},input:validatePostingInput({requestId:'youtube-handoff-test',deviceUdid:'synthetic-device',caption:'Comment CODE for the guide. #aitools',runAt:'2026-10-08T21:00:00Z',timezone:'America/Los_Angeles',targets:[{platform:'youtube',account:'synthetic-channel'}],instagramTrial:false,automaticPromotion:false,facebookMode:'linked_from_instagram',youtube:{title:'Synthetic Short',channelId:'UC'+'x'.repeat(22),visibility:'public',madeForKids:false,publishing:{category:'Education',tags:['aitools'],hashtags:['#aitools'],commentKeyword:'CODE',relatedVideoId:'DWREa1sv_Ho',aiUse:'no',coverMode:'existing_frame'}}})};
 const now=Date.now();const p={kind:'youtube',itemId:item.id,itemVersion:item.version,sourceSha256:item.media.sha256,inputHash:requestHash(item.input,item.media.sha256),sessionId:'verified',coverReviewed:true,duplicateCheckComplete:true,phoneVolumeZero:true,checkedAt:new Date(now).toISOString(),expiresAt:new Date(now+60000).toISOString(),evidence:{exactMedia:true,videoFrameCover:true,caption:true,account:true,automaticPromotion:false,linkedFacebook:false,youtubeRelatedVideo:{id:'DWREa1sv_Ho',format:'long_form',verified:true}}};
 assertPreparedYouTube(item,p,now);
 const reorder=(v:any):any=>Array.isArray(v)?v.map(reorder):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,reorder(v[k])])):v;
 assertPreparedYouTube({...item,input:reorder(item.input)},p,now);
 for(const change of [{itemVersion:999},{phoneVolumeZero:false},{expiresAt:new Date(now-1).toISOString()},{inputHash:'changed'}])assert.throws(()=>assertPreparedYouTube(item,{...p,...change},now),/changed or expired/);
 const d=new PreparedYouTubeRelease('http://unused',new AbortController().signal,item);await assert.rejects(d.shareOnce(),/Fresh YouTube preflight/);
});
