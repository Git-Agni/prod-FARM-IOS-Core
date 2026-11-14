import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseOnce, assertRelease, assertReceipts, assertReleaseTargets, type ReleaseEvidence } from '../src/publishing/release-policy.js';
import { validatePostingInput } from '../src/publishing/model.js';
const input = validatePostingInput({requestId:'release-test-123',deviceUdid:'test-phone-123',caption:'Comment ROADMAP for the guide.',runAt:'2026-10-01T16:00:00Z',timezone:'America/Los_Angeles',targets:[{platform:'instagram',account:'antoniorevenue'}],instagramTrial:true,automaticPromotion:true,facebookMode:'linked_from_instagram'});
const evidence: ReleaseEvidence = {exactMedia:true,videoFrameCover:true,caption:true,account:true,automaticPromotion:true,linkedFacebook:true};
test('release rejects URL captions and missing media checks',()=>{
 assert.throws(()=>assertRelease({...input,caption:'Get https://example.com'},evidence),/URLs/);
 assert.throws(()=>assertRelease(input,{...evidence,exactMedia:false}),/preflight/);
 assert.throws(()=>assertRelease(input,{...evidence,automaticPromotion:false}),/promotion/);
});
test('uncertain Share cannot be replayed',async()=>{
 let claimed=false,shares=0;const states:string[]=[];
 const journal={claimShare:async()=>{if(claimed)return false;claimed=true;return true;},save:async(s:'published'|'needs_review')=>{states.push(s);}};
 const driver={preflight:async()=>evidence,shareOnce:async()=>{shares++;throw new Error('connection lost');},verify:async()=>({})};
 await assert.rejects(releaseOnce(input,{},driver,journal),/connection lost/);
 await assert.rejects(releaseOnce(input,{},driver,journal),/already/);
 assert.equal(shares,1);assert.deepEqual(states,['needs_review','needs_review']);
});
test('all requested platform receipts are required',async()=>{
 const fb={...input,targets:[...input.targets,{platform:'facebook' as const,account:'https://www.facebook.com/profile.php?id=61584693917444'}]};
 let saved='';await assert.rejects(releaseOnce(fb,{}, {preflight:async()=>evidence,shareOnce:async()=>{},verify:async()=>({instagram:{verified:true,url:'https://www.instagram.com/reel/test/'}})}, {claimShare:async()=>true,save:async s=>{saved=s;}}),/facebook/);assert.equal(saved,'needs_review');
});

test('Instagram sharing badge alone cannot confirm Facebook delivery',()=>{
 const fb={...input,targets:[...input.targets,{platform:'facebook' as const,account:'https://www.facebook.com/profile.php?id=61584693917444'}]};
 const ig={verified:true,evidence:'native Trial caption'};
 assert.throws(()=>assertReceipts(fb,{instagram:ig,facebook:{verified:true,evidence:'Shared to Facebook'}}),/Independent Facebook/);
 assert.doesNotThrow(()=>assertReceipts(fb,{instagram:ig,facebook:{verified:true,source:'facebook_app',evidence:'Exact Facebook caption'}}));
});

test('TikTok has its own atomic posting item and native receipt',()=>{
 const tt={...input,targets:[{platform:'tiktok' as const,account:'antoniorevenue'}],instagramTrial:false,automaticPromotion:false};
 assert.doesNotThrow(()=>assertRelease(tt,evidence));
 assert.throws(()=>assertReleaseTargets({...tt,targets:[...tt.targets,...input.targets]}),/own calendar item/);
 assert.throws(()=>assertReceipts(tt,{tiktok:{verified:true,evidence:'Post tapped'}}),/Native TikTok/);
 assert.doesNotThrow(()=>assertReceipts(tt,{tiktok:{verified:true,source:'tiktok_app',url:'https://www.tiktok.com/@antoniorevenue/video/123'}}));
 assert.throws(()=>assertReceipts(tt,{tiktok:{verified:true,source:'tiktok_app',url:'https://www.instagram.com/reel/123'}}),/Unexpected/);
});

test('old disclosure text is rejected before the phone is touched',async()=>{
 let touched=false;
 await assert.rejects(releaseOnce({...input,caption:'Comment GUIDE.\n\nAI avatar with narration generated from my voice.'},{},{preflight:async()=>{touched=true;return evidence;},shareOnce:async()=>{},verify:async()=>({})},{claimShare:async()=>true,save:async()=>{}}),/disclosure/);
 assert.equal(touched,false);
});

test('requested related Reel requires exact native link evidence before claiming Share', async () => {
 const related = {url:'https://www.instagram.com/reel/Dd7K1yvCIgq/', caption:'Exact approved related caption.', label:'Claude YouTube'};
 const linkedInput = validatePostingInput({...input,instagramRelatedReel:related});
 assert.deepEqual(linkedInput.instagramRelatedReel,related);
 let claims=0,shares=0;
 const driver={preflight:async()=>evidence,shareOnce:async()=>{shares++;},verify:async()=>({})};
 await assert.rejects(releaseOnce(linkedInput,{},driver,{claimShare:async()=>{claims++;return true;},save:async()=>{}}),/related Reel/);
 assert.equal(claims,0);assert.equal(shares,0);
 assert.throws(()=>assertRelease(linkedInput,{...evidence,relatedReel:{...related,url:'https://www.instagram.com/reel/other/',verified:true}}),/related Reel/);
 assert.doesNotThrow(()=>assertRelease(linkedInput,{...evidence,relatedReel:{...related,verified:true}}));
 assert.throws(()=>validatePostingInput({...input,instagramRelatedReel:{...related,url:'https://example.com/reel/abc/'}}),/public Instagram/);
});

test('YouTube requires the exact verified long-form related video before Upload',async()=>{
 const yt=validatePostingInput({...input,caption:"Comment COUNCIL for the guide. #ai",targets:[{platform:'youtube',account:'antoniorevenue'}],instagramTrial:false,automaticPromotion:false,facebookMode:'direct',youtube:{title:'Test council',channelId:'UCMZWuXp0lsxE2vmuifYMWuA',visibility:'public',madeForKids:false,publishing:{category:'Howto & Style',tags:['ai'],hashtags:['#ai'],commentKeyword:'COUNCIL',relatedVideoId:'DWREa1sv_Ho',aiUse:'no',coverMode:'existing_frame'}}});
 const opts={nativeYouTubeLayout:true};
 assert.throws(()=>assertRelease(yt,evidence,opts),/verified related long-form/);
 assert.throws(()=>assertRelease(yt,{...evidence,youtubeRelatedVideo:{id:'DWREa1sv_Ho',format:'short' as any,verified:true}},opts),/long-form/);
 assert.throws(()=>assertRelease(yt,{...evidence,youtubeRelatedVideo:{id:'AAAAAAAAAAA',format:'long_form',verified:true}},opts),/long-form/);
 assert.doesNotThrow(()=>assertRelease(yt,{...evidence,youtubeRelatedVideo:{id:'DWREa1sv_Ho',format:'long_form',verified:true}},opts));
 let claims=0;
 await assert.rejects(releaseOnce(yt,{}, {youtubeNative:true,preflight:async()=>evidence,shareOnce:async()=>{},verify:async()=>({})},{claimShare:async()=>{claims++;return true;},save:async()=>{}}),/long-form/);
 assert.equal(claims,0);
});

test('a partial native receipt survives failure without confirming the full release',async()=>{
 const {ReceiptVerificationError}=await import('../src/publishing/release-policy.js');
 const receipts={instagram:{verified:true,evidence:'Exact native caption and Trial label'}};let saved:any;
 await assert.rejects(releaseOnce(input,{}, {preflight:async()=>evidence,shareOnce:async()=>{},verify:async()=>{throw new ReceiptVerificationError('Facebook caption missing',receipts);}}, {claimShare:async()=>true,save:async(state,result)=>{saved={state,result};}}),/Facebook caption/);
 assert.equal(saved.state,'needs_review');assert.deepEqual(saved.result.receipts,receipts);assert.equal(saved.result.shareAttempted,true);
});
