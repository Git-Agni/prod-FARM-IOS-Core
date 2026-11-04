import test from 'node:test';import assert from 'node:assert/strict';
import {matchesTikTokPost} from '../src/publishing/tiktok-release.js';
test('TikTok receipt matches the full published caption, not a draft or prefix',()=>{
 const caption='First paragraph.\n\nComment EDIT.\n\n#video';
 assert.equal(matchesTikTokPost('First paragraph. Comment EDIT. #video. Video. 0 views.',caption),true);
 assert.equal(matchesTikTokPost('First paragraph. Comment OTHER. #video. Video. 0 views.',caption),false);
 assert.equal(matchesTikTokPost('Drafts: '+caption,caption),false);
 assert.equal(matchesTikTokPost('First paragraph. Video. 0 views.',caption),false);
});

test('an uncertain TikTok Post response cannot trigger a second tap',async()=>{
 const {TikTokRelease}=await import('../src/publishing/tiktok-release.js');
 const driver=new TikTokRelease('http://unused',new AbortController().signal) as any;
 let taps=0;
 driver.prepared=true;
 driver.waitFor=async()=> 'post-button';
 driver.assertInputApp=async()=>{};
 driver.request=async()=>{taps++;throw new Error('Lost response after Post');};
 await assert.rejects(driver.shareOnce(),/Lost response/);
 await assert.rejects(driver.shareOnce(),/preflight is required/);
 assert.equal(taps,1);
});

test('TikTok publication checks open the profile once while waiting for a receipt',async()=>{
 const {TikTokRelease}=await import('../src/publishing/tiktok-release.js');
 const driver=new TikTokRelease('http://unused',new AbortController().signal) as any;
 let profileVisits=0,reads=0;
 driver.input={targets:[{platform:'tiktok',account:'antoniorevenue'}]};
 driver.profile=async()=>{profileVisits++;};
 driver.matchingPosts=async()=>++reads===3?['published-video']:[];
 driver.sleep=async()=>{};
 const receipt=await driver.verify();
 assert.equal(profileVisits,1);assert.equal(reads,3);
 assert.equal(receipt.tiktok.verified,true);
});

test('TikTok hook variant with a shared caption needs a new matching post, not the sibling',async()=>{
 const {TikTokRelease}=await import('../src/publishing/tiktok-release.js');
 const driver=new TikTokRelease('http://unused',new AbortController().signal,undefined,true) as any;
 let reads=0;
 driver.input={targets:[{platform:'tiktok',account:'antoniorevenue'}]};
 driver.baselineMatches=1;driver.profile=async()=>{};driver.sleep=async()=>{};
 driver.matchingPosts=async()=>++reads<3?['sibling']:['new','sibling'];
 const receipt=await driver.verify();
 assert.equal(reads,3);assert.equal(receipt.tiktok.verified,true);
});

test('TikTok account transition waits without repeating profile taps',async()=>{
 const {TikTokRelease}=await import('../src/publishing/tiktok-release.js');
 const driver=new TikTokRelease('http://unused',new AbortController().signal) as any;
 driver.input={targets:[{platform:'tiktok',account:'antoniorevenue'}]};
 const taps:string[]=[];let reads=0;
 driver.depth=async()=>{};driver.sleep=async()=>{};driver.dismissPrompts=async()=>{};
 driver.tapElement=async(_using:string,name:string)=>{taps.push(name);};
 driver.read=async()=>++reads===1?'':'@antoniorevenue';
 await driver.profile();
 assert.equal(reads,2);
 assert.deepEqual(taps,['a11y_vo_profile','profile_tab_public_post']);
});

test('TikTok reveals the exact offscreen album once without blind page swipes',async()=>{
 const {TikTokRelease}=await import('../src/publishing/tiktok-release.js');
 const driver=new TikTokRelease('http://unused',new AbortController().signal) as any;
 driver.session='/session/test';driver.depth=async()=>{};const calls:string[]=[];
 driver.request=async(route:string)=>{calls.push(route);return {value:route.endsWith('/elements')?[{ELEMENT:'exact-album'}]:route.endsWith('/rect')?{x:100,y:660,width:310,height:18}:false};};
 assert.deepEqual(await driver.revealAlbum('PF-reviewed-hash'),{x:100,y:660,width:310,height:18});
 assert.equal(calls.filter(r=>r.endsWith('/scrollTo')).length,1);
 assert.ok(calls.includes('/session/test/wda/element/exact-album/scrollTo'));
});
// Nov 4 phone check of the TikTok album list: each copy is its own cell with a "1" count; off-screen titles share a placeholder rect.
const albumCell=(name:string,count:string,y:number)=>`<XCUIElementTypeCell type="XCUIElementTypeCell" visible="false" x="0" y="${y}" width="430" height="88" index="1"><XCUIElementTypeStaticText type="XCUIElementTypeStaticText" value="${name}" name="${name}" label="${name}" visible="false" x="0" y="121" width="310" height="18" index="0"/><XCUIElementTypeStaticText type="XCUIElementTypeStaticText" value="${count}" name="${count}" label="${count}" visible="false" x="0" y="121" width="310" height="16" index="1"/></XCUIElementTypeCell>`;
const albumList=(cells:string[])=>({rows:cells.length,source:'<XCUIElementTypeTable>'+cells.join('')+'</XCUIElementTypeTable>'});
const albumDriver=async(name:string,list:{rows:number;source:string},rect={x:100,y:400,width:310,height:18})=>{
 const {TikTokRelease}=await import('../src/publishing/tiktok-release.js');
 const d=new TikTokRelease('http://unused',new AbortController().signal) as any;
 d.session='/session/test';d.depth=async()=>{};d.sleep=async()=>{};d.calls=[] as string[];
 d.request=async(route:string)=>{d.calls.push(route);
  if(route.endsWith('/elements'))return {value:Array.from({length:list.rows},(_,i)=>({ELEMENT:'title'+i}))};
  if(route.endsWith('/source'))return {value:list.source};
  if(route.endsWith('/displayed'))return {value:false};
  if(route.endsWith('/rect'))return {value:rect};
  return {value:null};
 };
 return d;
};
test('TikTok picks the first of identical one-item PF albums and scrolls only to that row',async()=>{
 const name='PF-f6dedf84f77c';
 const d=await albumDriver(name,albumList([albumCell(name,'1',10241),albumCell(name,'1',19041),albumCell(name,'1',20449)]));
 assert.deepEqual(await d.revealAlbum(name),{x:100,y:400,width:310,height:18});
 assert.deepEqual(d.calls.filter((r:string)=>r.endsWith('/scrollTo')),['/session/test/wda/element/title0/scrollTo']);
});
test('TikTok stops on albums it cannot prove are identical one-item copies',async()=>{
 const name='PF-f6dedf84f77c';
 // A copy holding more than one item.
 await assert.rejects((await albumDriver(name,albumList([albumCell(name,'1',100),albumCell(name,'2',200)]))).revealAlbum(name),/ambiguous: PF-f6dedf84f77c \(2 matches\)/);
 // Title matches that are not one album cell each.
 await assert.rejects((await albumDriver(name,{rows:2,source:albumList([albumCell(name,'1',100)]).source})).revealAlbum(name),/ambiguous/);
 // More copies than re-imports can explain, and names the import store did not make.
 await assert.rejects((await albumDriver(name,albumList(Array.from({length:6},(_,i)=>albumCell(name,'1',100*i))))).revealAlbum(name),/ambiguous: .*6 matches/);
 const other=await albumDriver('PF-hash',albumList([albumCell('PF-hash','1',100),albumCell('PF-hash','1',200)]));
 await assert.rejects(other.revealAlbum('PF-hash'),/ambiguous: PF-hash \(2 matches\)/);
 assert.equal(other.calls.some((r:string)=>r.endsWith('/source')||r.endsWith('/scrollTo')),false);
 // A single album outside the visible list still stops.
 await assert.rejects((await albumDriver('PF-hash',albumList([albumCell('PF-hash','1',100)]),{x:100,y:900,width:310,height:18})).revealAlbum('PF-hash'),/outside/);
});

test('TikTok comment navigation taps the exact matched bounds once and stops on an uncertain viewer',async()=>{
 const {TikTokRelease}=await import('../src/publishing/tiktok-release.js');
 const d=new TikTokRelease('http://unused',new AbortController().signal) as any;
 d.session='/session/test';d.depth=async()=>{};d.sleep=async()=>{};d.matchingPost=async()=>'exact-post';
 let taps=0;d.request=async()=>({value:{x:0,y:300,width:143,height:200}});
 d.tapPoint=async(x:number,y:number)=>{assert.equal(x,71.5);assert.equal(y,400);taps++};
 d.waitFor=async()=>{throw Error('Viewer missing')};
 await assert.rejects(d.openMatchedPost(),/Viewer missing/);assert.equal(taps,1);
 d.request=async()=>({value:{x:0,y:800,width:143,height:200}});
 await assert.rejects(d.openMatchedPost(),/outside/);assert.equal(taps,1);
});

test('TikTok sends no viewer touch when a profile refresh moves the matched tile',async()=>{
 const {TikTokRelease}=await import('../src/publishing/tiktok-release.js');const d=new TikTokRelease('http://unused',new AbortController().signal) as any;
 d.depth=async()=>{};d.sleep=async()=>{};d.matchingPost=async()=>'post';let reads=0,taps=0;
 d.request=async()=>({value:{x:143,y:++reads===1?375:410,width:144,height:190}});d.tapPoint=async()=>{taps++};
 await assert.rejects(d.openMatchedPost(),/moved/);assert.equal(taps,0);
});


test('TikTok waits for an album to appear using reads only, then reveals it once',async()=>{
 const {TikTokRelease}=await import('../src/publishing/tiktok-release.js');
 const d=new TikTokRelease('http://unused',new AbortController().signal) as any;
 d.session='/session/test';d.depth=async(n:number)=>{assert.equal(n,60)};let reads=0,waits=0,scrolls=0;
 d.sleep=async()=>{waits++};
 d.request=async(route:string)=>{
  if(route.endsWith('/elements'))return {value:++reads<3?[]:[{ELEMENT:'album'}]};
  if(route.endsWith('/rect'))return {value:{x:100,y:660,width:310,height:18}};
  if(route.endsWith('/displayed'))return {value:false};
  assert.ok(route.endsWith('/scrollTo'));scrolls++;return {value:null};
 };
 await d.revealAlbum('PF-reviewed');assert.equal(reads,3);assert.equal(waits,2);assert.equal(scrolls,1);
});

test('TikTok missing and ambiguous albums stop without any input or import',async()=>{
 const {TikTokRelease}=await import('../src/publishing/tiktok-release.js');
 const d=new TikTokRelease('http://unused',new AbortController().signal) as any;
 let reads=0;d.depth=async()=>{};d.sleep=async()=>{};
 d.request=async(route:string)=>{assert.ok(route.endsWith('/elements'));reads++;return {value:[]};};
 await assert.rejects(d.revealAlbum('PF-reviewed'),/missing: PF-reviewed .*0 matches after 3 reads/);assert.equal(reads,3);
 reads=0;d.request=async(route:string)=>{if(route.endsWith('/rect'))return {value:{x:100,y:route.includes('/a/')?300:400,width:310,height:18}};assert.ok(route.endsWith('/elements'));reads++;return {value:[{ELEMENT:'a'},{ELEMENT:'b'}]};};
 await assert.rejects(d.revealAlbum('PF-reviewed'),/ambiguous: PF-reviewed .*2 matches/);assert.equal(reads,1);
});
