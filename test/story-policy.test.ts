import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reviewStoryDraft,storyPolicy} from '../src/publishing/story-policy.js';
const fixture=()=>({policyVersion:1,nativeText:true,musicStyle:'music_only',frames:storyPolicy.stages.map(stage=>({stage,text:'A specific moment in the work.',assetKind:stage==='proof'?'workflow':'gallery_photo',assetRef:stage+'-synthetic-test.png',visualReviewed:true,claimReview:stage==='proof'?'source_checked':'no_factual_claim',sourceRef:stage==='proof'?'synthetic-test-receipt.json':undefined}))});
test('a compliant draft remains unable to publish',()=>{const r=reviewStoryDraft(fixture());assert.equal(r.valid,true);assert.equal(r.publicationAllowed,false)});
test('landscape-only sequences cannot pass the proof gate',()=>{const d=fixture();d.frames[2].assetKind='gallery_photo';assert.equal(reviewStoryDraft(d).valid,false)});
test('unchecked claims, missing visual checks and music stickers fail review',()=>{const d=fixture();d.frames[2].sourceRef='';d.frames[0].visualReviewed=false;d.musicStyle='sticker';assert.equal(reviewStoryDraft(d).errors.length,3)});
test('malformed and reordered drafts fail closed',()=>{for(const v of [null,{}, {frames:[null]}, {...fixture(),frames:fixture().frames.reverse()}])assert.equal(reviewStoryDraft(v).valid,false)});

test('repeated images fail review',()=>{const d=fixture();d.frames[1].assetRef=d.frames[0].assetRef;assert.equal(reviewStoryDraft(d).valid,false)});

const mixed = (): any => ({...fixture(),policyVersion:2,format:'post_led',frames:fixture().frames.map((f,i)=>({...f,stage:['problem','mechanism','post','lesson','reply'][i],assetKind:i===0?'b_roll':i===2?'native_reel':f.assetKind,assetRef:i===2?'https://www.instagram.com/reel/test123/':f.assetRef,clipStartSeconds:2,clipEndSeconds:8}))});
test('post-led B-roll and a native Reel can pass review without publication permission',()=>{assert.equal(reviewStoryDraft(mixed()).valid,true);assert.equal(reviewStoryDraft(mixed()).publicationAllowed,false)});
test('B-roll needs bounded trims and post frames need a checked native Reel',()=>{const d=mixed();d.frames[0].clipEndSeconds=80;d.frames[2].assetRef='https://example.com/';d.frames[2].claimReview='no_factual_claim';assert.equal(reviewStoryDraft(d).valid,false)});
test('new media types cannot bypass the legacy policy or asset review',()=>{const d=mixed();d.policyVersion=1;assert.equal(reviewStoryDraft(d).valid,false);const e=mixed();e.frames[0].visualReviewed=false;assert.equal(reviewStoryDraft(e).valid,false)});
