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
// Oct 19 14:41 frame (d6671ed2): OCR of the Attributes row on the Add details screen.
test('the Attributes row is found by its whole "AI use, Tags" line, not a lone Tags word',()=>{
 const row=[{text:'Collaborations,',x:159,y:1805},{text:'Comments,',x:515,y:1807},{text:'Al',x:158,y:1976},{text:'use,',x:217,y:1984},{text:'Tags',x:324,y:1976}];
 assert.equal(metadataRowMatches(row,'AI use, Tags').length,1);
 assert.deepEqual(metadataRowMatches(row,'Tags'),[]);
 const title=[{text:'Walmart\'s',x:321,y:459},{text:'Price',x:520,y:459},{text:'Tags',x:684,y:459}];
 assert.equal(metadataRowMatches([...title,...row],'AI use, Tags').length,1);
 assert.equal(metadataRowMatches(row,'Community').length,0);
});
test('OCR album rows map O and l back to hex and keep only exact PF names',async()=>{const{ocrAlbumRows}=await import('../src/publishing/youtube-release.js');
 const rows=ocrAlbumRows([{text:'Recents',y:418,height:35},{text:'PF-003cd93dbabe',y:1713,height:36},{text:'PF-01e36aaf7fcO',y:2673,height:58},{text:'PF-0lE3',y:10,height:10}]);
 assert.deepEqual(rows.map(r=>r.name),['PF-003cd93dbabe','PF-01e36aaf7fc0']);assert.equal(rows[0]!.y,1731);});

test('Recents match needs the reviewed length and import minute (Oct 30)', async () => {
    const {recentsVideoMatches}=await import('../src/publishing/youtube-release.js');
    const xml=(await import('node:fs')).readFileSync(new URL('./fixtures/youtube-recents-2026-10-30.xml',import.meta.url),'utf8');
    const at=new Date('2026-10-30T21:22:29.388Z');
    const hits=recentsVideoMatches(xml,50,at);
    assert.equal(hits.length,1);assert.match(hits[0]!.value,/^50 seconds, created October 30, 2026 at 14:22/);
    assert.equal(recentsVideoMatches(xml,47,at).length,0,'a 47 s video at 14:22 is not ours');
    assert.equal(recentsVideoMatches(xml,50,new Date('2026-10-30T21:30:00Z')).length,0,'wrong minute');
    assert.equal(recentsVideoMatches(xml,72,new Date('2026-10-30T18:22:10Z')).length,1,'11:22 1:12 video');
});
