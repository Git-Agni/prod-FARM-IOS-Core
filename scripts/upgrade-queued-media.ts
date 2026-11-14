/** Re-encode queued videos to the upload master spec before they post (Antonio, Oct 10: "find a way to post in high quality").
 * Usage: upgrade-queued-media.ts [--only=NAME]  dry run: list the videos that would be upgraded
 *        upgrade-queued-media.ts --apply    encode, verify, and point every unposted item of each video at the new file
 * Spec: H.264 High, ~12 Mbps (maxrate 16M, bufsize 24M), yuv420p, TV range, BT.709 tags, faststart; audio copied.
 * Most queued files are 2-5 Mbps full-range (yuvj420p) exports. Platforms re-compress every upload, so a low-bitrate
 * full-range file loses detail twice and its colors shift. The new file keeps every frame (count, duration and a
 * frame-zero PSNR check); the original stays on disk. Skips videos that already meet the spec, videos posted on the
 * same account (duplicate checks key on the file hash), and releases that are claimed, running or due within 45 minutes.
 * Database and local files only; no phone input. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream,existsSync,statSync} from 'node:fs';
import {dirname,basename} from 'node:path';
import {createDatabaseConnection} from '../src/database/client.js';
import {validatePostingInput,requestHash} from '../src/publishing/model.js';

const apply=process.argv.includes('--apply'),soonMs=Number(process.argv.find(v=>v.startsWith('--soon-minutes='))?.slice(15)??45)*60_000,only=process.argv.find(v=>v.startsWith('--only='))?.slice(7);
const probe=(p:string)=>JSON.parse(execFileSync('ffprobe',['-v','error','-count_packets','-show_entries',
 'stream=codec_type,width,height,pix_fmt,color_range,nb_read_packets:format=duration,bit_rate','-of','json',p],{encoding:'utf8'}));
const video=(j:any)=>j.streams.find((s:any)=>s.codec_type==='video');
const meetsSpec=(j:any)=>{const v=video(j);return v.pix_fmt==='yuv420p'&&v.color_range==='tv'&&Number(j.format.bit_rate)>=9e6;};
const sha256=async(p:string)=>{const h=createHash('sha256');for await(const c of createReadStream(p))h.update(c);return h.digest('hex');};
const account=(a:string)=>a.replace(/^@/,'').toLowerCase();
const overlaps=(a:any[],b:any[])=>a.some(t=>b.some(u=>t.platform===u.platform&&account(t.account)===account(u.account)));

function encode(src:string,out:string){
 execFileSync('ffmpeg',['-v','error','-y','-i',src,'-map','0:v:0','-map','0:a?','-c:v','libx264','-profile:v','high','-preset','slow',
  '-b:v','12M','-maxrate','16M','-bufsize','24M','-vf','scale=in_range=auto:out_range=tv,format=yuv420p',
  '-color_range','tv','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709',
  '-c:a','copy','-movflags','+faststart',out],{stdio:'inherit'});
}
/** Frame zero of the new file against the original, both in TV range: the Short cover review stays valid only if they match. */
function psnrOf(a:string,b:string){
 const out=execFileSync('sh',['-c',`ffmpeg -v info -i "$0" -i "$1" -lavfi "[0:v]trim=end_frame=1,scale=in_range=auto:out_range=tv,format=yuv420p[x];[1:v]trim=end_frame=1,format=yuv420p[y];[x][y]psnr" -f null - 2>&1`,a,b],{encoding:'utf8'});
 const m=/average:(inf|[\d.]+)/.exec(out);return m?(m[1]==='inf'?99:Number(m[1])):0;
}

const db=createDatabaseConnection();
// One run at a time: the hourly backlog job starts this, and a long run may overlap the next hour.
const lock=await db.pool.connect();
try{
 if(!(await lock.query("SELECT pg_try_advisory_lock(hashtextextended('phone-farm:media-upgrade',0)) ok")).rows[0].ok){console.log('Another upgrade run is active');process.exitCode=0;throw Object.assign(Error('busy'),{busy:true});}
 const rows=(await db.pool.query(`SELECT i.*,r.state rstate,r.run_at,r.share_claimed_at FROM scheduler.publishing_items i
   LEFT JOIN scheduler.publishing_releases r ON r.item_id=i.id WHERE i.status<>'cancelled'`)).rows;
 const groups=new Map<string,any[]>();for(const i of rows)groups.set(i.media.sha256,[...(groups.get(i.media.sha256)??[]),i]);
 const plan:{sha:string,items:any[],path:string,soonest:number}[]=[];
 for(const [sha,g] of groups){
  const todo=g.filter(i=>i.status==='held'&&(!i.rstate||i.rstate==='armed'||i.rstate==='cancelled')&&!i.share_claimed_at);
  if(!todo.length)continue;
  if(/preview-test|synthetic/i.test(todo[0].media.name)||(only&&!todo[0].media.name.includes(only)))continue;
  const src=todo[0].media.path;
  if(!existsSync(src)){console.log('skip (file missing):',todo[0].media.name);continue;}
  const posted=g.filter(i=>i.status!=='held'&&i.status!=='cancelled');
  if(posted.some(p=>todo.some(t=>overlaps(p.input.targets,t.input.targets)))){console.log('skip (already posted on the same account):',todo[0].media.name);continue;}
  const soonest=Math.min(...todo.filter(i=>i.rstate==='armed').map(i=>new Date(i.run_at).getTime()),Infinity);
  if(soonest<Date.now()+soonMs){console.log('skip (posts within 45 minutes):',todo[0].media.name);continue;}
  if(meetsSpec(probe(src)))continue;
  plan.push({sha,items:todo,path:src,soonest});
 }
 plan.sort((a,b)=>a.soonest-b.soonest);
 for(const p of plan){
  const name=p.items[0].media.name;
  if(!apply){console.log('would upgrade:',name,`(${p.items.length} item${p.items.length>1?'s':''})`);continue;}
  const out=`${dirname(p.path)}/${basename(p.path,'.mp4')}-hq.mp4`;
  const before=probe(p.path);encode(p.path,out);const after=probe(out);
  const vb=video(before),va=video(after);
  const psnr=psnrOf(p.path,out);
  const problems=[
   va.width!==vb.width||va.height!==vb.height?'size changed':'',
   va.nb_read_packets!==vb.nb_read_packets?`frames ${vb.nb_read_packets}->${va.nb_read_packets}`:'',
   Math.abs(Number(after.format.duration)-Number(before.format.duration))>0.05?'duration changed':'',
   !meetsSpec(after)?'output misses the spec':'',
   psnr<38?`frame zero differs (PSNR ${psnr.toFixed(1)} dB)`:'',
  ].filter(Boolean);
  if(problems.length){console.log('NOT upgraded:',name,problems.join('; '));continue;}
  const newSha=await sha256(out),size=statSync(out).size;
  const upgrade={at:new Date().toISOString(),fromSha256:p.sha,fromPath:p.path,fromBitRate:Number(before.format.bit_rate),fromPixFmt:vb.pix_fmt,
   toBitRate:Number(after.format.bit_rate),frames:Number(va.nb_read_packets),frameZeroPsnrDb:Number(psnr.toFixed(1)),spec:'H.264 High 12M ABR, yuv420p, tv, bt709'};
  const c=await db.pool.connect();
  try{
   await c.query('BEGIN');
   let n=0;
   for(const old of p.items){
    const i=(await c.query(`SELECT i.*,r.state rstate,r.run_at,r.share_claimed_at FROM scheduler.publishing_items i LEFT JOIN scheduler.publishing_releases r ON r.item_id=i.id WHERE i.id=$1 FOR UPDATE OF i`,[old.id])).rows[0];
    if(!i||i.status!=='held'||i.media.sha256!==p.sha||i.share_claimed_at||(i.rstate&&!['armed','cancelled'].includes(i.rstate))
     ||(i.rstate==='armed'&&new Date(i.run_at).getTime()<Date.now()+20*60_000))continue;
    // YouTube first comments fall back to a sibling's comment by file hash; keep the text on the item itself.
    let input=i.input;
    if(input.targets.some((t:any)=>t.platform==='youtube')&&!input.firstComment){
     const sib=(await c.query(`SELECT input->>'firstComment' fc FROM scheduler.publishing_items WHERE media->>'sha256'=$1 AND input ? 'firstComment' LIMIT 1`,[p.sha])).rows[0]?.fc;
     if(sib)input={...input,firstComment:sib};
    }
    input=validatePostingInput(input);
    const media={...i.media,path:out,sha256:newSha,size};
    const review=i.results?.directYouTubeReview;
    const results={...i.results,mediaUpgrade:upgrade,...(review?.sourceSha256===p.sha?{directYouTubeReview:{...review,sourceSha256:newSha,reencodedFrom:{sha256:p.sha,frameZeroPsnrDb:upgrade.frameZeroPsnrDb}}}:{})};
    await c.query('UPDATE scheduler.publishing_items SET media=$2,input=$3,request_hash=$4,results=$5,version=version+1,updated_at=now() WHERE id=$1',
     [i.id,media,input,requestHash(input,newSha),results]);
    await c.query(`UPDATE scheduler.publishing_releases SET item_version=item_version+1,updated_at=now() WHERE item_id=$1 AND state='armed' AND share_claimed_at IS NULL`,[i.id]);
    n++;
   }
   await c.query('COMMIT');
   console.log(`upgraded: ${name} | ${(upgrade.fromBitRate/1e6).toFixed(1)} -> ${(upgrade.toBitRate/1e6).toFixed(1)} Mbps | ${vb.pix_fmt} -> yuv420p tv | frame-0 PSNR ${upgrade.frameZeroPsnrDb} dB | ${n} item(s)`);
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
 if(!plan.length)console.log('Nothing to upgrade');
}catch(e:any){if(!e.busy)throw e;}
finally{lock.release();await db.close();}
