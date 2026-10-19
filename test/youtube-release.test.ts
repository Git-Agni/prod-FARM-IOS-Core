import test from'node:test';import assert from'node:assert/strict';import{YouTubeRelease,isFullYouTubeTrim,nativeTagsMatch,metadataRowMatches}from'../src/publishing/youtube-release.js';import{PreparedYouTubeRelease,reviewedLongForm,ownedShortsTabRect}from'../src/publishing/prepared-youtube.js';
// These tests cover the native receipt path; the public-feed shortcut is stubbed so no test reaches the network.
(PreparedYouTubeRelease.prototype as any).publicFeedReceipt=async()=>undefined;
test('a fresh YouTube job cannot start native input with an unreviewed or changed file',async()=>{for(const review of [undefined,{coverReviewed:false},{coverReviewed:true,sourceSha256:'different',relatedVideoId:reviewedLongForm.id}]){const item={results:{directYouTubeReview:review}},d=new YouTubeRelease('http://unused',new AbortController().signal,item,{}as any);await assert.rejects(d.preflight({youtube:{publishing:{relatedVideoId:reviewedLongForm.id}}}as any,{sha256:'a'.repeat(64)}),/own reviewed cover/);await assert.rejects(d.shareOnce(),/Fresh YouTube preflight/);}});
test('a native YouTube receipt must match title, account and the owned long-form link',async()=>{const title='Synthetic Short',caption='Synthetic full description';for(const account of ['synthetic','other']){const d:any=new PreparedYouTubeRelease('http://unused',new AbortController().signal,{});d.input={targets:[{account:'synthetic'}],caption,youtube:{title,publishing:{relatedVideoId:reviewedLongForm.id}}};d.sleep=async()=>{};let description=false,taps=0;d.request=async()=>({value:description?'<XCUIElementTypeStaticText visible="true" label="'+caption+'"/>':'<XCUIElementTypeStaticText visible="true" name="eml.shorts-video-title-new" label="'+title+'"/><XCUIElementTypeButton visible="true" name="decorated-avatar-id" label="Go to channel @'+account+'"/><XCUIElementTypeButton visible="true" name="id.reel_multi_format_link" label="'+reviewedLongForm.title+'"/>'});d.tapElement=async(_u:string,v:string)=>{assert.notEqual(v,'id.metadata_editor.upload_button');taps++;description=true};if(account==='synthetic'){const r=await d.verify();assert.equal(r.youtube.verified,true);assert.equal(taps,1)}else{await assert.rejects(d.verify(),/needs review/);assert.equal(taps,0)}}});
test('the trim checkpoint accepts the full native clip and rejects a cropped range',()=>{assert.equal(isFullYouTubeTrim('Selected from Less than a second to 29 seconds',28.8),true);for(const v of ['Selected from 2 seconds to 29 seconds','Selected from Less than a second to 27 seconds',''])assert.equal(isFullYouTubeTrim(v,28.8),false);assert.equal(isFullYouTubeTrim('Selected from Less than a second to 29 seconds',NaN),false);assert.equal(isFullYouTubeTrim('Selected from Less than a second to 44 seconds',44.52),true);assert.equal(isFullYouTubeTrim('Selected from Less than a second to 43 seconds',44.52),false);});
test('the channel Shorts control excludes the global Shorts tab and stops on ambiguous geometry',()=>{const node='<XCUIElementTypeButton type=\"XCUIElementTypeButton\" visible=\"true\" name=\"id.ui.tab..button\" label=\"Shorts, Tab 3 of 5\" x=\"220\" y=\"448\" width=\"82\" height=\"49\"/>';assert.equal(ownedShortsTabRect(node+'<XCUIElementTypeButton visible=\"true\" name=\"id.ui.pivotbar.FEshorts.button\" label=\"Shorts\"/>').x,220);assert.throws(()=>ownedShortsTabRect(node+node.replace('x=\"220\"','x=\"100\"')),/ambiguous/);assert.throws(()=>ownedShortsTabRect(node.replace('y=\"448\"','y=\"900\"')),/moved/);});

// Oct 19 frames (8e63fd91, 35b7c005, 11216851): OCR read the typed chips "AITools" and "AIAgents" as "AlTools" and "AlAgents".
test('native tags accept the OCR l-for-I reading but still reject a missing or different tag',()=>{
 const seen=['Gemini','Google','AlTools','AlAgents','Productivity'];
 assert.equal(nativeTagsMatch(['Gemini','Google','AITools','AIAgents','Productivity'],seen),true);
 assert.equal(nativeTagsMatch(['Gemini','Google','AITools','AIAgents','Productivity','AISales'],seen),false);
 assert.equal(nativeTagsMatch(['Gemini','Googie2'],seen),false);
});
// Oct 19 07:25 frame (792511c9): words and positions as OCR returned them on the Add details screen.
test('a metadata row label must sit in the left label column, not in the title or description text',()=>{
 const words=[{text:'Walmart\'s',x:321,y:459},{text:'Price',x:520,y:459},{text:'Tags',x:684,y:459},{text:'Now',x:800,y:459},
  {text:'Description',x:159,y:1620},{text:'Walmart\'s',x:159,y:1678},{text:'price',x:370,y:1678},{text:'tags',x:525,y:1678},
  {text:'Related',x:159,y:2011},{text:'video',x:330,y:2011}];
 assert.deepEqual(metadataRowMatches(words,'Tags'),[]);
 assert.equal(metadataRowMatches(words,'Description').length,1);
 assert.equal(metadataRowMatches(words,'Related video').length,1);
 assert.equal(metadataRowMatches([...words,{text:'Tags',x:158,y:900}],'Tags').length,1);
});
