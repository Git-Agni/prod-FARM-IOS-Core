import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePostingInput, requestHash } from '../src/publishing/model.js';
import { publicItem } from '../src/publishing/store.js';
const base = { requestId:'test-post-123',deviceUdid:'test-device-123',caption:'Hello',runAt:'2026-10-02T10:00:00-07:00',timezone:'America/Los_Angeles',targets:[{platform:'instagram',account:'antoniorevenue'},{platform:'facebook',account:'https://www.facebook.com/profile.php?id=61584693917444'}],instagramTrial:true,automaticPromotion:true,facebookMode:'linked_from_instagram' };
test('linked trial request keeps exact destination, timezone and automatic promotion',()=>{
 const p=validatePostingInput(base);assert.equal(p.runAt,'2026-10-02T17:00:00.000Z');assert.equal(p.instagramTrial,true);assert.equal(p.automaticPromotion,true);assert.equal(p.targets[0].account,base.targets[1].account);
});
test('reject unsupported destinations and unsafe target combinations',()=>{
 for (const patch of [{targets:[{platform:'youtube',account:'abc'}]},{targets:[base.targets[1]],instagramTrial:false},{automaticPromotion:false},{targets:[base.targets[0],base.targets[0]]},{runAt:'2026-10-02T10:00:00'},{timezone:'Invalid/Zone'},{targets:[{platform:'facebook',account:'https://facebook.com.evil.example/page'}],instagramTrial:false,facebookMode:'direct'}])assert.throws(()=>validatePostingInput({...base,...patch}));
});
test('idempotency hashes cover exact text, media, destination and cover',()=>{
 const p=validatePostingInput(base);const h=requestHash(p,'a');assert.equal(h,requestHash(validatePostingInput({...base,targets:[...base.targets].reverse()}),'a'));
 assert.notEqual(h,requestHash({...p,caption:'Different'},'a'));assert.notEqual(h,requestHash(p,'b'));assert.notEqual(h,requestHash(p,'a','cover'));
});
test('public responses never expose local asset paths',()=>{
 const media={path:'/private/file.mp4',name:'video.mp4',size:1,mimeType:'video/mp4',sha256:'x'};
 assert.equal(JSON.stringify(publicItem({id:'x',input:base,status:'held',version:1,media,cover:media,results:{}})).includes('/private/'),false);
});

import { InstagramPreview } from '../src/publishing/instagram-preview.js';
import { instagramPreviewTask } from '../src/publishing/preview-task.js';
test('preview blocks final Share selectors before any phone request',async()=>{
 const driver=new InstagramPreview('http://not-called.invalid',new AbortController().signal);
 await assert.rejects(driver.click('share-sheet-share-button'),/not allowed/);
 await assert.rejects(driver.click('Share'),/not allowed/);
});
test('preview also blocks an allowed selector whose label changes to Share',async()=>{
 const driver=new InstagramPreview('http://not-called.invalid',new AbortController().signal);
 driver.attribute=async()=> 'Share';
 await assert.rejects(driver.click('sundial-right-chevron-next-button'),/cannot publish/);
});
test('preview tasks have no automatic retries and cannot repeat daily',()=>{
 const payload={itemId:'00000000-0000-4000-8000-000000000001',version:1};
 assert.equal(instagramPreviewTask.retryPolicy(payload).retryLimit,0);
 assert.throws(()=>instagramPreviewTask.validate(payload,{timingKind:'daily',devicePluginData:{}}),/cannot repeat/);
});
test('preview chooses the visible caption editor when Instagram repeats its ID',async()=>{
 const driver=new InstagramPreview('http://not-called.invalid',new AbortController().signal);
 driver.request=async(route)=>route.endsWith('/elements') ? {value:[{ELEMENT:'hidden'},{ELEMENT:'visible'}]} : {value:route.includes('/visible/')};
 assert.equal(await driver.element('caption-cell-text-view'),'visible');
});
test('non-trial posts do not request automatic promotion',()=>{
 assert.equal(validatePostingInput({...base,instagramTrial:false,automaticPromotion:false}).automaticPromotion,false);
 assert.throws(()=>validatePostingInput({...base,instagramTrial:false,automaticPromotion:true}),/require/);
});
test('old trial items fail before opening Instagram',async()=>{
 const driver=new InstagramPreview('http://not-called.invalid',new AbortController().signal);
 await assert.rejects(driver.run({...validatePostingInput(base),automaticPromotion:false},{} as any,'unused'),/recreated/);
});
test('automatic promotion fails closed when the trial link layout is unknown',async()=>{
 const driver=new InstagramPreview('http://not-called.invalid',new AbortController().signal);
 driver.request=async()=>({value:[]});
 await assert.rejects(driver.ensureAutomaticPromotion(),/calibration/);
});
test('Facebook verification stops on a wrong destination or off state',async()=>{
 const driver=new InstagramPreview('http://not-called.invalid',new AbortController().signal);
 const clicked:string[]=[];driver.click=async name=>{clicked.push(name);};driver.attribute=async()=> 'Another Page, Off';
 await assert.rejects(driver.verifyLinkedFacebook(),/not confirmed/);
 assert.deepEqual(clicked,['Also share on…']);
});

test('caption policy rejects disclosure boilerplate but preserves AI topic captions',()=>{
 assert.throws(()=>validatePostingInput({...base,caption:'Comment SIMULATE.\n\nAI avatar with narration generated from my voice.'}),/disclosure/);
 assert.equal(validatePostingInput({...base,caption:'These AI tools help you edit videos.'}).caption,'These AI tools help you edit videos.');
});
