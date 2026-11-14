import test from 'node:test';import assert from 'node:assert/strict';import {assertPreparedInstagram,preparedInputHash} from '../src/publishing/prepared-instagram.js';
const now=Date.now();const input:any={requestId:'prepared_test_123',deviceUdid:'testphone123',caption:'Reviewed caption',runAt:new Date(now).toISOString(),timezone:'America/Los_Angeles',targets:[{platform:'instagram',account:'antoniorevenue'}],instagramTrial:true,automaticPromotion:true,facebookMode:'linked_from_instagram'};
const item={id:'item',version:3,status:'held',input,media:{sha256:'abc'}};
const proof:any={kind:'instagram',itemId:'item',itemVersion:3,sourceSha256:'abc',inputHash:preparedInputHash(input,'abc'),sessionId:'session',checkedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+60000).toISOString(),coverReviewed:true,duplicateCheckComplete:true,phoneVolumeZero:true,evidence:{account:true,caption:true,exactMedia:true,videoFrameCover:true,automaticPromotion:true,linkedFacebook:false}};
test('a prepared composer is bound to its exact item, version and content',()=>{assert.doesNotThrow(()=>assertPreparedInstagram(item,proof,now));for(const altered of [{...item,id:'other'},{...item,version:4},{...item,input:{...input,caption:'Changed'}},{...item,media:{sha256:'other'}},{...item,status:'published'}])assert.throws(()=>assertPreparedInstagram(altered,proof,now));});
test('prepared evidence expires and cannot claim unreviewed media',()=>{for(const patch of [{expiresAt:new Date(now-1).toISOString()},{checkedAt:'invalid'},{expiresAt:new Date(now+700000).toISOString()},{coverReviewed:false},{duplicateCheckComplete:false},{phoneVolumeZero:false}])assert.throws(()=>assertPreparedInstagram(item,{...proof,...patch},now));});
test('prepared evidence still enforces related Reel and Facebook checks',()=>{const changed={...item,input:{...input,targets:[...input.targets,{platform:'facebook',account:'https://www.facebook.com/profile.php?id=61584693917444'}]}};assert.throws(()=>assertPreparedInstagram(changed,{...proof,inputHash:preparedInputHash(changed.input,'abc')},now),/Facebook/);});

test('PostgreSQL JSONB key order does not invalidate the same prepared input',()=>{const reorder=(v:any):any=>Array.isArray(v)?v.map(reorder):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,reorder(v[k])])):v;assert.doesNotThrow(()=>assertPreparedInstagram({...item,input:reorder(input)},proof,now));});
test('prepared Instagram Share cannot repeat after an uncertain response',async()=>{const {PreparedInstagramRelease}=await import('../src/publishing/prepared-instagram.js');const d=new PreparedInstagramRelease('http://unused',new AbortController().signal,item) as any;d.readyToShare=true;d.rect=async()=>({x:222,y:842,width:192,height:44});let taps=0;d.tapPoint=async()=>{taps++;throw Error('Lost response')};await assert.rejects(d.shareOnce(),/Lost response/);await assert.rejects(d.shareOnce(),/fresh prepared/);assert.equal(taps,1);});
test('Instagram receipt navigation uses measured bounds and never repeats a lost tap',async()=>{const {InstagramRelease}=await import('../src/publishing/instagram-release.js');const d=new InstagramRelease('http://unused',new AbortController().signal) as any;let taps=0;d.rect=async()=>({x:370,y:850,width:45,height:55});d.tapPoint=async()=>{taps++;throw Error('Unknown tap result')};await assert.rejects(d.tapElement('accessibility id','profile-tab','Profile'),/Unknown tap/);assert.equal(taps,1);d.rect=async()=>({x:370,y:930,width:45,height:55});await assert.rejects(d.tapElement('accessibility id','profile-tab','Profile'),/outside/);assert.equal(taps,1);});

test('Facebook receipt navigation makes one measured touch and rejects offscreen controls',async()=>{
 const {FacebookVerifier}=await import('../src/publishing/facebook-verify.js');
 const d=new FacebookVerifier('http://unused',new AbortController().signal) as any;let taps=0;
 d.rect=async()=>({x:10,y:650,width:200,height:40});d.tapPoint=async()=>{taps++;throw Error('Lost response')};
 await assert.rejects(d.tapElement('accessibility id','fbreels-description-collapse','Expand'),/Lost response/);assert.equal(taps,1);
 d.rect=async()=>({x:10,y:920,width:200,height:40});await assert.rejects(d.tapElement('accessibility id','Reels','Reels'),/outside/);assert.equal(taps,1);
});

test('Facebook caption expansion targets the mapped More control instead of the caption center',async()=>{
 const {FacebookVerifier}=await import('../src/publishing/facebook-verify.js');
 const d=new FacebookVerifier('http://unused',new AbortController().signal) as any;
 d.rect=async()=>({x:12,y:770,width:362,height:19});d.sleep=async()=>{};let point:any;
 d.tapPoint=async(x:number,y:number)=>{point={x,y}};
 await d.tapElement('accessibility id','fbreels-description-collapse','Expand');assert.deepEqual(point,{x:355.9,y:779.5});
});

test('prepared Instagram reads the full caption rather than a truncated snapshot label',async()=>{
 const {PreparedInstagramRelease}=await import('../src/publishing/prepared-instagram.js');
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const{tmpdir}=await import('node:os');const{join}=await import('node:path');const{createHash}=await import('node:crypto');
 const dir=await mkdtemp(join(tmpdir(),'pf-caption-'));try{
 const path=join(dir,'media');await writeFile(path,'fixture');const hash=createHash('sha256').update('fixture').digest('hex');
 const full='A'.repeat(601),updatedInput={...input,caption:full};const updatedProof={...proof,sourceSha256:hash,inputHash:preparedInputHash(updatedInput,hash)};
 const updatedItem={...item,input:updatedInput,media:{path,sha256:hash},results:{preparedNative:updatedProof}};
 const d=new PreparedInstagramRelease('http://unused',new AbortController().signal,updatedItem) as any;
 let fieldValue=full;
 d.request=async(route:string)=>route==='/wda/locked'?{value:false}:route==='/status'?{sessionId:'session'}:route.endsWith('/wda/activeAppInfo')?{value:{bundleId:'com.burbn.instagram'}}:route.endsWith('/elements')?{value:[{ELEMENT:'caption'}]}:route.endsWith('/attribute/value')?{value:fieldValue}:{value:'<XCUIElementTypeTextView visible="false" name="caption-cell-text-view" label="'+full.slice(0,500)+'"/><XCUIElementTypeStaticText visible="true" label="This is a trial reel and will only be shown to non-followers at first."/><XCUIElementTypeButton visible="true" name="share-sheet-share-button" label="Share"/>'};
 await assert.doesNotReject(d.preflight(updatedInput,updatedItem.media));
 fieldValue=full.slice(0,500);await assert.rejects(d.preflight(updatedInput,updatedItem.media),/composer changed/);
 }finally{await rm(dir,{recursive:true,force:true})}
});
