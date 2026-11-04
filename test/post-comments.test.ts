import test from 'node:test';
import assert from 'node:assert/strict';
import {runPostComment,commentKey} from '../src/publishing/post-comments.js';

function fixture(status='published') {
 let ledger:any=null;let exits=0;const writes:string[]=[];
 const item={status,input:{deviceUdid:'test-phone',firstComment:'Which tool would you try?',targets:[{platform:'tiktok'}]},results:{release:{receipts:{tiktok:{verified:true}}}}};
 const client={release(){},async query(sql:string,args:any[]=[]):Promise<any>{
  writes.push(sql);
  if(sql.startsWith('SELECT * FROM scheduler.publishing_items'))return {rows:[item]};
  if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked:true}]};
  if(sql.startsWith('INSERT INTO scheduler.engagement_actions')){if(ledger)return {rowCount:0};ledger={status:'preparing'};return {rowCount:1};}
  if(sql.includes("SET status='claimed'")){if(ledger.status!=='preparing')return {rowCount:0};ledger.status='claimed';return {rowCount:1};}
  if(sql.includes('SET status=$2'))ledger.status=args[1];
  if(sql.includes("SET status='done'"))ledger.status='done';
  return {rows:[],rowCount:1};
 }};
 return {pool:{connect:async()=>client} as any,item,writes,get ledger(){return ledger;},driver:{leaveVideo:async()=>{exits++;},commentOnPost:async(_i:any,_t:string,claim:()=>Promise<void>)=>{await claim();throw new Error('Lost comment response');}},get exits(){return exits;}};
}
test('uncertain comment never repeats and cannot change the video release',async()=>{
 const f=fixture();await runPostComment(f.pool,'item','tiktok',f.driver);assert.equal(f.ledger.status,'uncertain_review');
 await runPostComment(f.pool,'item','tiktok',f.driver);assert.equal(f.exits,1);
 assert.equal(f.writes.some(s=>s.includes('UPDATE scheduler.publishing_releases')),false);
});
test('held or unverified posts cannot receive comments',async()=>{
 const f=fixture('held');await runPostComment(f.pool,'item','tiktok',f.driver);assert.equal(f.ledger,null);
 const g=fixture();g.item.results.release.receipts.tiktok.verified=false;await runPostComment(g.pool,'item','tiktok',g.driver);assert.equal(g.ledger,null);
});
test('platform comment claims are separate',()=>assert.notEqual(commentKey('facebook','same'),commentKey('tiktok','same')));

test('OCR requires every comment word in order and inside the comment area',async()=>{
 const {locateComment}=await import('../src/publishing/comment-ocr.js');
 const words='Which tool would you try first'.split(' ').map((text,i)=>({text,x:170+i*100,y:1500,width:80,height:35}));
 assert.ok(locateComment(words,'Which tool would you try first?',1400,1800));
 assert.equal(locateComment(words,'Which tool would you buy first?',1400,1800),null);
 assert.equal(locateComment(words,'Which tool would you try first?',1600,1800),null);
});

test('draft readback ignores the text cursor after the final punctuation only',async()=>{
 const {locateComment}=await import('../src/publishing/comment-ocr.js');
 const at=(line:string)=>line.split(' ').map((text,i)=>({text,x:215+i*100,y:1557,width:80,height:33}));
 const text='What is the first publication you would pitch?';
 // Nov 3 22:13 failure frame: OCR read the blinking cursor as a trailing "l".
 assert.ok(locateComment(at('What is the first publication you would pitch?l'),text,1400,1850,{draftCursor:true}));
 assert.ok(locateComment(at('What is the first publication you would pitch?|'),text,1400,1850,{draftCursor:true}));
 // A posted comment has no cursor, so the receipt stays exact.
 assert.equal(locateComment(at('What is the first publication you would pitch?l'),text,1400,1850),null);
 // Only one glyph, only after the comment's own closing punctuation, never a changed word.
 assert.equal(locateComment(at('What is the first publication you would pitch?ll'),text,1400,1850,{draftCursor:true}),null);
 assert.equal(locateComment(at('What is the first publication you would pitchl'),text,1400,1850,{draftCursor:true}),null);
 assert.equal(locateComment(at('Ship it firstl'),'Ship it first',1400,1850,{draftCursor:true}),null);
 assert.equal(locateComment(at('What is the first publication you would pitch?'),text,1400,1850,{draftCursor:true})?.length,8);
});

test('OCR reads a lone bar as a capital I inside the comment',async()=>{
 const {locateComment}=await import('../src/publishing/comment-ocr.js');
 const words='Comment EFFECTS and | will DM you the setup'.split(' ').map((text,i)=>({text,x:170+i*100,y:1500,width:80,height:35}));
 assert.ok(locateComment(words,'Comment EFFECTS and I will DM you the setup',1400,1800));
 assert.equal(locateComment(words,'Comment EFFECTS and we will DM you the setup',1400,1800),null);
});

test('TikTok comments submit once, verify the author and report no Pin honestly',async()=>{
 const {TikTokRelease}=await import('../src/publishing/tiktok-release.js');
 const d=new TikTokRelease('http://unused',new AbortController().signal) as any;
 const text='Which tool would you try first?';const textWords=(y:number)=>text.split(' ').map((text,i)=>({text,x:170+i*110,y,width:90,height:35}));
 const stages=[{words:[{text:'Add',x:1150,y:1800,width:45,height:30},{text:'1st',x:1210,y:1800,width:40,height:30}]},{words:[{text:'Comments0',x:50,y:900},{text:'comment...',x:350,y:1550}]},{words:textWords(1550)},{words:[{text:'antoniorevenue',x:170,y:1400},{text:'Creator',x:480,y:1400},...textWords(1460)]}];
 const routes:string[]=[];let claims=0;
 d.start=async()=>{};d.profile=async()=>{};d.matchingPost=async()=> 'matched';d.depth=async()=>{};d.tapPoint=async()=>{};d.waitFor=async(_u:string,v:string)=>v;d.sleep=async()=>{};d.visible=async()=>null;d.screen=async()=>stages.shift();
 d.request=async(route:string)=>{routes.push(route);return {value:{x:145,y:375,width:144,height:190}};};
 const result=await d.commentOnPost({targets:[{platform:'tiktok',account:'antoniorevenue'}]},text,async()=>{claims++;});
 assert.equal(claims,1);assert.equal(routes.filter(r=>r.endsWith('/Send/click')).length,1);assert.equal(result.commentVerified,true);assert.equal(result.pinned,false);assert.equal(routes.some(r=>/import-media|apps\/launch/.test(r)),false);
});

test('Instagram recovery reuses the original pin claim',()=>{
 assert.equal(commentKey('instagram','same'),'pin:item:same');
 assert.notEqual(commentKey('instagram','same'),commentKey('facebook','same'));
});

test('Instagram pin lookup requires our full comment, not another pinned reply',async()=>{
 const {InstagramEngage}=await import('../src/publishing/instagram-engage.js');
 const d=new InstagramEngage('http://unused',new AbortController().signal) as any;
 const selectors:string[]=[];d.click=async()=>{};d.waitFor=async(_u:string,v:string)=>{selectors.push(v);return 'own';};
 d.visible=async(_u:string,v:string)=>{selectors.push(v);return 'own-pinned';};
 const result=await d.pin({comment:'Which tool?',postUrl:'https://www.instagram.com/reel/example/'},async()=>{throw Error('Already pinned must not write');});
 assert.equal(result.status,'already_pinned');
 assert.ok(selectors.every(s=>s.includes('antoniorevenue said Which tool?. Commented ')));
 assert.ok(selectors[1].includes('Comment is pinned.'));
});

test('Instagram repair never creates a missing comment or claims an already pinned one',async()=>{
 const {InstagramRelease}=await import('../src/publishing/instagram-release.js');
 const d=new InstagramRelease('http://unused',new AbortController().signal) as any;
 let claims=0;const routes:string[]=[];let source='<XCUIElementTypeCell type="XCUIElementTypeCell" visible="true" label="antoniorevenue said Which tool?. Commented 1 hour ago. Comment was written by the post author. Comment is pinned." />';
 d.tapElement=async()=>{};d.sleep=async()=>{};d.request=async(route:string)=>{routes.push(route);return {value:source};};
 assert.equal((await d.commentAndPin('Which tool?',async()=>{claims++;},true)).status,'already_pinned');
 source='<XCUIElementTypeCell type="XCUIElementTypeCell" visible="true" label="anotheruser said Which tool?. Commented 1 hour ago. Comment is pinned." />';
 await assert.rejects(d.commentAndPin('Which tool?',async()=>{claims++;},true),/repair cannot create/);
 assert.equal(claims,0);assert.ok(routes.every(r=>r.endsWith('/source')));
});

test('a verified destination can receive its comment while another destination needs review',async()=>{
 const f=fixture('needs_review');await runPostComment(f.pool,'item','tiktok',f.driver);assert.equal(f.ledger.status,'uncertain_review');
 const g=fixture('needs_review');g.item.results.release.receipts.tiktok.verified=false;await runPostComment(g.pool,'item','tiktok',g.driver);assert.equal(g.ledger,null);
});

test('comment jobs hand the driver the verified receipt link',async()=>{
 const f=fixture();(f.item.results.release.receipts.tiktok as any).url='https://example.test/post/1';let seen:string|undefined;
 (f.driver as any).commentOnPost=async(_i:any,_t:string,claim:()=>Promise<void>,_e?:boolean,url?:string)=>{seen=url;await claim();return {status:'pinned',commentVerified:true,pinned:true,evidence:'ok'};};
 await runPostComment(f.pool,'item','tiktok',f.driver);assert.equal(seen,'https://example.test/post/1');assert.equal(f.ledger.status,'done');
});

test('a comment job that finds the phone busy never touches the phone',async()=>{
 const f=fixture();let resets=0;(f.driver as any).resetAfterFailure=async()=>{resets++;};
 const client=await f.pool.connect();const query=client.query.bind(client);
 client.query=async(sql:string,args:any[]=[])=>sql.includes('pg_try_advisory_lock')?{rows:[{locked:false}]}:query(sql,args);
 await runPostComment(f.pool,'item','tiktok',f.driver);assert.equal(resets,0);assert.equal(f.exits,0);
 client.query=query;await runPostComment(f.pool,'item','tiktok',f.driver);assert.equal(resets,1);
});
