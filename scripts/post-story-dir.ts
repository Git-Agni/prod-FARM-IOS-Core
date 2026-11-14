/** Publish a reviewed Story sequence (frame-N.png with the words already in the image) to @antoniorevenue + Facebook.
 * Usage: post-story-dir.ts FOLDER --confirm [--wait] [--link URL]
 * Antonio approved the Oct 21 samples in chat ("They look good ... tell me when it's posted"). This runner never decides
 * what to post: it only shares the folder it is given, and only with --confirm.
 * Safety: same gap + phone-lock wait as rehearse-story.ts (never overlaps a video release); a claim file is written
 * BEFORE each Share and a frame with a claim is never shared again; the first error stops the run (no retry after a
 * claim). Receipts (Instagram Graph id per frame) go to .scheduler-data/publishing/story-posts/<folder>/receipts.json. */
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createDatabaseConnection} from '../src/database/client.js';
import {DirectMediaStore} from '../src/publishing/direct-media.js';
import {NativeMuteGuard} from '../src/publishing/native-mute.js';
import {WdaStoryDriver} from '../src/publishing/wda-story-driver.js';
import {storyBlockedByVideo} from '../src/publishing/wda-stories.js';
import type {NativeStoryFrame} from '../src/publishing/mirroring-stories.js';

const dir=path.resolve(process.argv[2]??''),PHONE='00008130-000229EE1AA0001C',base='http://127.0.0.1:8100';
if(!process.argv.includes('--confirm'))throw Error('Usage: post-story-dir.ts FOLDER --confirm [--wait] [--link URL] [--not-before HH:MM]');
// --not-before HH:MM (Mac local time, Pacific): the daily Story routine builds early and posts at its slot, not before.
const notBefore=process.argv.includes('--not-before')?process.argv[process.argv.indexOf('--not-before')+1]!:undefined;
if(notBefore&&!/^\d{2}:\d{2}$/.test(notBefore))throw Error('--not-before takes HH:MM');
const tooEarly=()=>{if(!notBefore)return false;const [h,m]=notBefore.split(':').map(Number),t=new Date();t.setHours(h!,m!,0,0);return Date.now()<t.getTime();};
const link=process.argv.includes('--link')?process.argv[process.argv.indexOf('--link')+1]:undefined;
const files=(await readdir(dir)).filter(f=>/^frame-\d+\.png$/.test(f)).sort((a,b)=>parseInt(a.slice(6))-parseInt(b.slice(6)));
if(!files.length)throw Error('No frame-N.png files in '+dir);
const out=path.resolve('.scheduler-data/publishing/story-posts',path.basename(dir));await mkdir(out,{recursive:true});
// About 95 s a frame on the live phone (Oct 21 dry run) plus receipts and setup.
const needMinutes=Math.max(25,Math.ceil(files.length*110/60)+12);
const db=createDatabaseConnection(),c=await db.pool.connect();let locked=false,driver:WdaStoryDriver|undefined;
const receipts:any[]=[];
try{
 for(;;){
  const reason=tooEarly()?`waiting for ${notBefore}`:await storyBlockedByVideo(db.pool,needMinutes)?`a video release falls inside the next ${needMinutes} minutes`
   :(locked=(await c.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) l',[PHONE])).rows[0].l)?'':'the phone is busy';
  if(!reason)break;
  if(!process.argv.includes('--wait'))throw Error('Not posted: '+reason);
  console.log(new Date().toISOString(),'waiting:',reason);await new Promise(r=>setTimeout(r,60_000));
 }
 const signal=AbortSignal.timeout(needMinutes*60_000);
 const imports=new DirectMediaStore(db.pool);await imports.initialize();
 await new NativeMuteGuard(base,signal).prepare();
 driver=new WdaStoryDriver(base,signal,imports,PHONE,path.join(out,'evidence'));
 for(const [i,f] of files.entries()){
  const file=path.join(dir,f),sha256=createHash('sha256').update(await readFile(file)).digest('hex'),claim=path.join(out,`claim-${i+1}-${sha256.slice(0,12)}.json`);
  if(existsSync(claim))throw Error(`Frame ${i+1} was already claimed (${claim}); inspect the live Story, never share it again`);
  const frame:NativeStoryFrame={text:'',textBurnedIn:true,...(link&&i===files.length-1?{linkUrl:link,linkText:'Watch the reel'}:{}),assetRef:file,sourceSha256:sha256,sourcePath:file,media:{path:file,name:f,mimeType:'image/png',sha256},previewPath:'',previewSha256:''};
  driver.beginFrame();
  const r=await driver.publishFrame(frame,async()=>{await writeFile(claim,JSON.stringify({frame:i+1,sha256,claimedAt:new Date().toISOString()}))});
  receipts.push({frame:i+1,sha256,instagram:r.instagram,facebook:r.facebook});
  await writeFile(path.join(out,'receipts.json'),JSON.stringify(receipts,null,1));
  console.log(`frame ${i+1}: shared, Instagram story ${r.instagram.id}`);
 }
 console.log(`STORY POSTED: ${files.length} frames. Receipts: ${path.relative(process.cwd(),path.join(out,'receipts.json'))}`);
}catch(e:any){console.log('STORY POST STOPPED:',e.message,`(${receipts.length} of ${files.length} frames shared)`);process.exitCode=1;}
finally{
 await driver?.leaveVideo().catch(()=>undefined);
 if(locked)await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[PHONE]);c.release();await db.close();
}
