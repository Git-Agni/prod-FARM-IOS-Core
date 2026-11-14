import {test} from 'node:test';
import assert from 'node:assert/strict';
import {storyShareSheetCheck,storyTrackPoint,storyAddBadgePoint,pixelDistance,STORY_TRACK} from '../src/publishing/wda-story-driver.js';
import {newStory,storyTime} from '../src/publishing/story-receipts.js';
import {storyFrameVerified} from '../src/publishing/mirroring-stories.js';
import {storyFramesFromPlan} from '../src/publishing/wda-stories.js';

const el=(type:string,a:Record<string,string|number>)=>`<XCUIElementType${type} type="XCUIElementType${type}" ${Object.entries(a).map(([k,v])=>`${k}="${v}"`).join(' ')} visible="true"/>`;
// Geometry copied from the live share sheet mapped on 2026-10-07.
const sheet=(o:{fb?:boolean;yours?:string;friends?:string;shares?:number}={})=>[
 el('Other',{name:'story-share-sheet-your-story',x:0,y:442,width:430,height:60}),
 el('Button',{name:o.fb===false?'Your story':'Your story, And Facebook story',x:0,y:442,width:430,height:60}),
 el('Button',{name:'Radio',value:o.yours??'1',x:390,y:460,width:24,height:24}),
 el('Other',{name:'story-share-sheet-close-friends',x:0,y:502,width:430,height:60}),
 el('Button',{name:'Radio',value:o.friends??'',x:390,y:520,width:24,height:24}),
 el('Other',{name:'stories-share-footer-button',x:0,y:822,width:430,height:76}),
 ...Array.from({length:o.shares??1},()=>el('Button',{name:'Share',x:16,y:838,width:398,height:44})),
].join('');

test('Story share sheet passes only with Your story, Facebook story and one Share',()=>{
 assert.equal(storyShareSheetCheck(sheet()).ok,true);
 assert.match(storyShareSheetCheck(sheet({fb:false})).reason,/Facebook/);
 assert.match(storyShareSheetCheck(sheet({yours:''})).reason,/Your story is not selected/);
 assert.match(storyShareSheetCheck(sheet({friends:'1'})).reason,/Close Friends/);
 assert.match(storyShareSheetCheck(sheet({shares:2})).reason,/ambiguous/);
 assert.equal(storyShareSheetCheck('<XCUIElementTypeApplication visible="true"/>').ok,false);
});

const track=(y:number,title:string,artist:string,n=0)=>[
 el('Cell',{name:`music-browser-audio-track-${n}`,x:0,y,width:430,height:61}),
 el('Button',{name:title,label:title,x:72,y:y+11,width:302,height:18}),
 el('Other',{name:`${artist} · 94K reels · 2:22`,label:`${artist} · 94K reels · 2:22`,x:72,y:y+32,width:302,height:18}),
].join('');

test('the approved track opens from its subtitle line, never by guessing',()=>{
 assert.deepEqual(storyTrackPoint(track(338,STORY_TRACK.title,STORY_TRACK.artist)),{x:172,y:379});
 assert.throws(()=>storyTrackPoint(track(338,STORY_TRACK.title,'Someone Else')),/missing or ambiguous/);
 assert.throws(()=>storyTrackPoint(track(338,STORY_TRACK.title,STORY_TRACK.artist)+track(398,STORY_TRACK.title,STORY_TRACK.artist,1)),/ambiguous/);
 assert.throws(()=>storyTrackPoint(track(870,STORY_TRACK.title,STORY_TRACK.artist)),/outside/);
 assert.deepEqual(storyTrackPoint(el('Other',{name:'no-label',x:0,y:0,width:1,height:1})+track(338,STORY_TRACK.title,STORY_TRACK.artist)),{x:172,y:379},'nodes without a label are ignored');
 // Search results name every row music-browser-audio-track--1 (seen live 2026-10-07).
 assert.deepEqual(storyTrackPoint(track(241,STORY_TRACK.title,STORY_TRACK.artist,-1)+track(301,'Stardust, Royalty Free',STORY_TRACK.artist,-1)),{x:172,y:282});
});

test('a frame receipt is the one Story that appeared after this Share',()=>{
 const shared=Date.parse('2026-10-08T16:00:00Z'),old={id:'a',createdAt:shared-3_600_000},fresh={id:'b',createdAt:shared+20_000};
 assert.equal(newStory([old],new Set(['a']),shared),null);
 assert.equal(newStory([old,fresh],new Set(['a']),shared)?.id,'b');
 assert.equal(newStory([old],new Set(),shared),null,'an older unknown Story is not this frame');
 assert.throws(()=>newStory([fresh,{id:'c',createdAt:shared+30_000}],new Set(),shared),/More than one/);
 assert.equal(storyTime('2026-10-08T16:00:20+0000'),shared+20_000);
 assert.equal(storyTime('1791475220'),1791475220_000);
});

test('both destinations must be verified before a frame counts as published',()=>{
 const ig={verified:true,source:'instagram_graph'},fb={verified:true,source:'facebook_graph'};
 assert.equal(storyFrameVerified({instagram:ig,facebook:fb}),true);
 assert.equal(storyFrameVerified({instagram:{verified:true,source:'instagram_app'},facebook:{verified:true,source:'facebook_app'}}),true);
 assert.equal(storyFrameVerified({instagram:ig}),false);
 assert.equal(storyFrameVerified({instagram:ig,facebook:{verified:false,source:'facebook_graph'}}),false);
 assert.equal(storyFrameVerified({instagram:{verified:true,source:'guess'},facebook:fb}),false);
});

test('pixel distance separates the plain audio icon from attached album art',()=>{
 assert.equal(pixelDistance(Buffer.from([0,0,0]),Buffer.from([0,0,0])),0);
 assert.equal(pixelDistance(Buffer.from([0,255]),Buffer.from([255,0])),1);
 assert.throws(()=>pixelDistance(Buffer.from([1]),Buffer.from([1,2])),/size/);
});

test('the iPhone runner refuses plans it cannot build natively',async()=>{
 const frame=(stage:string,extra:Record<string,unknown>={})=>({stage,text:'Short frame text.',assetKind:'gallery_photo',assetRef:`/tmp/${stage}.png`,visualReviewed:true,claimReview:'no_factual_claim',...extra});
 const proofLed={policyVersion:2,format:'proof_led',nativeText:true,musicStyle:'music_only',frames:[frame('moment'),frame('problem'),frame('proof',{assetKind:'dashboard',claimReview:'source_checked',sourceRef:'x'}),frame('lesson'),frame('reply')]};
 await assert.rejects(storyFramesFromPlan({...proofLed,musicStyle:'sticker'}),/does not pass review/);
 const postLed={...proofLed,format:'post_led',frames:[frame('problem'),frame('mechanism'),frame('post',{assetKind:'native_reel',assetRef:'https://www.instagram.com/reel/Dd67vhigWBq/',claimReview:'source_checked',sourceRef:'x'}),frame('lesson'),frame('reply')]};
 await assert.rejects(storyFramesFromPlan(postLed),/native Reel/);
 await assert.rejects(storyFramesFromPlan({...proofLed,frames:proofLed.frames.map((f,i)=>i?f:{...f,assetRef:'/tmp/moment.heic'})}),/PNG/);
});

test('the Story gallery opens from the badge inside the own tray cell only',()=>{
 const cell=el('Cell',{name:'story-tray-cell-self',x:0,y:112,width:105,height:111});
 const badge=(x:number,y:number)=>el('Image',{name:'Add-to-Story-24',x,y,width:25,height:25});
 assert.deepEqual(storyAddBadgePoint(cell+badge(68,174)),{x:81,y:187});
 assert.throws(()=>storyAddBadgePoint(cell+badge(168,174)),/missing or outside/);
 assert.throws(()=>storyAddBadgePoint(badge(68,174)),/tray cell/);
});

test('a Story revision survives a jsonb key reorder', async () => {
    const { canonicalJson } = await import('../src/publishing/mirroring-stories.js');
    assert.equal(canonicalJson({ b: 1, a: [{ y: 2, x: null }] }), canonicalJson({ a: [{ x: null, y: 2 }], b: 1 }));
    // jsonb drops undefined keys; the revision must survive that round trip.
    assert.equal(canonicalJson({ a: 1, linkUrl: undefined }), canonicalJson(JSON.parse(JSON.stringify({ a: 1, linkUrl: undefined }))));
});

test('a Facebook cross-post receipt counts only with a verified Instagram Graph receipt', async () => {
    const { storyFrameVerified } = await import('../src/publishing/mirroring-stories.js');
    const fb = { verified: true, source: 'facebook_crosspost' };
    assert.equal(storyFrameVerified({ instagram: { verified: true, source: 'instagram_graph' }, facebook: fb }), true);
    assert.equal(storyFrameVerified({ instagram: { verified: false, source: 'instagram_graph' }, facebook: fb }), false);
    assert.equal(storyFrameVerified({ instagram: { verified: true, source: 'instagram_graph' }, facebook: { verified: false, source: 'facebook_crosspost' } }), false);
});

test('the Story tray add badge is found with a Story already live', async () => {
    const { storyAddBadgePoint } = await import('../src/publishing/wda-story-driver.js');
    const xml = '<XCUIElementTypeCell type="XCUIElementTypeCell" name="story-tray-cell-self" label="Button, Your story, Seen" visible="true" x="0" y="112" width="105" height="111">'
        + '<XCUIElementTypeOther type="XCUIElementTypeOther" name="story-ring" visible="true" x="6" y="112" width="93" height="93"/>'
        + '<XCUIElementTypeButton type="XCUIElementTypeButton" name="story-tray-add-button" label="Add to your story" visible="true" x="68" y="174" width="25" height="25"/></XCUIElementTypeCell>';
    assert.deepEqual(storyAddBadgePoint(xml), { x: 81, y: 187 });
});

test('each Story frame gets exactly one Share, and a second tap on the same frame is refused', async () => {
    const { WdaStoryDriver } = await import('../src/publishing/wda-story-driver.js');
    const taps: string[] = [];
    const d: any = Object.create(WdaStoryDriver.prototype);
    Object.assign(d, { session: '/session/x', waitFor: async () => 'share-id', assertInputApp: async () => undefined,
        raw: async (route: string) => { taps.push(route); return { ok: true, body: { value: null } }; } });
    for (let frame = 1; frame <= 3; frame++) { d.beginFrame(); d.sheetReady = true; await d.shareStoryOnce(); }
    assert.equal(taps.length, 3);
    d.sheetReady = true;
    await assert.rejects(d.shareStoryOnce(), /already attempted/);
    assert.equal(taps.length, 3);
});
