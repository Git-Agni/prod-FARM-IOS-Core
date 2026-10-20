/** Move every unposted video to the front of the queue and arm it; shift scheduled posts later. Safe hourly.
 * One video per slot, slots --every-hours apart (default 3; Antonio, Oct 7 20:40: views were dropping at hourly posting).
 * Lanes: social (Instagram with linked Facebook, and TikTok) at minute 22; youtube (Shorts) at minute 52.
 * Missed and failed-before-Share posts take the next slots; armed future posts keep their order and shift later.
 * Dry run by default; pass --apply to write. Never touches a release with a Share claim, a receipt or a prepared
 * composer, and stops retrying a post after three automatic reschedules. Arming goes through TimedReleaseStore.arm,
 * so the duplicate-video and TikTok checks apply. */
import {createDatabaseConnection} from '../src/database/client.js';
import {requestHash,validatePostingInput} from '../src/publishing/model.js';
import {TimedReleaseStore} from '../src/publishing/timed-release.js';
import {reviewedRelatedReel} from '../src/publishing/instagram-related.js';
import {randomInt} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';

const apply=process.argv.includes('--apply');
const lane=process.argv.find(v=>v.startsWith('--lane='))?.split('=')[1]??'social';
if(!['social','youtube'].includes(lane))throw Error('--lane must be social or youtube');
const minute=lane==='youtube'?52:22,maxAttempts=3;
const inLane=(i:any)=>i.input.targets.some((t:any)=>t.platform==='youtube')===(lane==='youtube');
const phone='00008130-000229EE1AA0001C';
const account=(v:string)=>v.replace(/^@/,'').toLowerCase();
const db=createDatabaseConnection(),c=await db.pool.connect();
const held:any[]=[],planned:any[]=[];
try{
 await c.query('BEGIN');
 // Oct 20: a try-lock failed "Phone busy" on about half the hourly runs (322 in 293), because a :00 or :22 post is
 // usually still running at :05, so missed posts waited hours for a quiet hour. Wait for the current job instead
 // (up to 30 minutes); the database work then takes seconds and the worker continues.
 await c.query("SET LOCAL statement_timeout='30min'");
 await c.query({text:'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',values:[phone],query_timeout:31*60_000});
 await c.query("SET LOCAL statement_timeout=0");
 const items=(await c.query('SELECT * FROM scheduler.publishing_items ORDER BY created_at FOR UPDATE')).rows;
 const releases=new Map((await c.query('SELECT * FROM scheduler.publishing_releases FOR UPDATE')).rows.map(r=>[r.item_id,r]));
 // requeue-verified-unposted.ts records Graph proof that a claimed Share never reached Instagram or Facebook.
 const claimed=(i:any)=>{const r=releases.get(i.id);if(i.results?.verifiedNotPosted?.verified===true)return false;return !!r?.share_claimed_at||['published','running'].includes(r?.state)||i.status==='published';};
 // Antonio's rule: every Instagram post links another Reel. Default to the reviewed Reel when a post has none.
 const relatedRef=(await c.query(`SELECT input->'instagramRelatedReel' r FROM scheduler.publishing_items WHERE input->'instagramRelatedReel'->>'url'=$1 LIMIT 1`,[reviewedRelatedReel])).rows[0]?.r;
 const eligible:any[]=[];
 const keptArmed=items.filter(i=>inLane(i)&&releases.get(i.id)?.state==='armed'&&new Date(releases.get(i.id).run_at)>new Date());
 for(const i of items.filter(x=>['held','needs_review'].includes(x.status)&&inLane(x)&&!keptArmed.includes(x))){
  const r=releases.get(i.id),platforms=i.input.targets.map((t:any)=>t.platform);
  const review=i.results?.directYouTubeReview;
  let reason='';
  if(claimed(i)||Object.keys(i.results?.release?.receipts??{}).length)reason='Share was claimed or a receipt exists; check the account before any retry';
  else if(r&&!['armed','needs_review','cancelled'].includes(r.state))reason='Release is '+r.state;
  else if(i.results?.preparedNative)reason='Prepared composer item; re-prepare before arming';
  else if(i.results?.hourlyRecoveryExclusion||i.results?.externalYouTubeDelivery)reason='Duplicate check or earlier delivery recorded';
  // Oct 13: cc-claude and cc-youtube went out on Sep 30 outside a release (externalPublication), were re-queued and posted
  // again on Oct 12-13. Any verified earlier publication on a target platform keeps the item out.
  else if(Object.entries(i.results?.externalPublication??{}).some(([p,x]:[string,any])=>x?.verified&&platforms.includes(p)))reason='Already published outside a release (externalPublication)';
  else if((i.results?.autopilotBacklog?.attempts??0)>=maxAttempts)reason=`Rescheduled ${maxAttempts} times; needs a person`;
  else if(platforms.includes('youtube')&&!(review?.coverReviewed&&review.sourceSha256===i.media.sha256&&review.relatedVideoId===i.input.youtube?.publishing?.relatedVideoId))reason='Short needs a frame-zero cover review or a Mac-made cover';
  else if(platforms.includes('tiktok')&&platforms.length>1)reason='Legacy mixed TikTok item';
  else if(/preview-test|synthetic/i.test(i.media.name))reason='Test item';
  else if(items.some(j=>j.id!==i.id&&j.media.sha256===i.media.sha256&&claimed(j)
    &&j.input.targets.some((u:any)=>i.input.targets.some((t:any)=>t.platform===u.platform&&account(t.account)===account(u.account)))))reason='Same video already went out on this account';
  if(reason)held.push({id:i.id,name:i.media.name,platforms,status:i.status,reason});else eligible.push(i);
 }
 // The all-armed worker would run any leftover armed release, so cancel those for items kept out.
 for(const h of held){
  const r=releases.get(h.id);if(r?.state!=='armed'||r.share_claimed_at)continue;
  await c.query(`UPDATE scheduler.publishing_releases SET state='cancelled',result=result||jsonb_build_object('autopilotBacklog',$2::text),updated_at=now()
    WHERE item_id=$1 AND state='armed' AND share_claimed_at IS NULL`,[h.id,'Cancelled: kept out of the shuffle. '+h.reason]);
  h.cancelledArmedRelease=true;
 }
 // Antonio's rule (Oct 7): videos that did not post move to the front of the queue; scheduled videos keep their
 // order and shift later. One slot per video; unposted videos are shuffled among themselves.
 const groups=[...new Set(eligible.map(i=>i.media.sha256))].map(hash=>eligible.filter(i=>i.media.sha256===hash));
 for(let n=groups.length-1;n>0;n--){const k=randomInt(n+1);[groups[n],groups[k]]=[groups[k]!,groups[n]!];}
 const hour=3600000,every=Number(process.argv.find(v=>v.startsWith('--every-hours='))?.split('=')[1]??3)*hour;
 if(!(every>=hour))throw Error('--every-hours must be 1 or more');
 // The first free slot is at least `every` after the latest post that ran or is about to (Oct 7: hourly runs had
 // pulled the queue forward to the next hour each time, giving posts at 21:22, 22:22 and 23:22).
 const recent=[...releases.values()].map((r:any)=>r.state!=='cancelled'?new Date(r.run_at).getTime():NaN)
   .filter(t=>t<=Date.now()+20*60000&&t>Date.now()-every);
 const earliest=Math.max(Date.now()+20*60000,recent.length?Math.max(...recent)+every:0);
 const next=(()=>{const t=new Date(earliest);t.setUTCSeconds(0,0);const s=new Date(t);s.setUTCMinutes(minute);return s<t?s.getTime()+hour:s.getTime();})();
 const runAtOf=(i:any)=>new Date(releases.get(i.id).run_at).getTime();
 // Posts due within 20 minutes stay where they are; later ones form the shifting queue in their current order.
 // Only posts this script scheduled may shift. Posts other tools armed for a set time keep it, and their hours are skipped.
 const owned=(i:any)=>!!i.results?.autopilotBacklog;
 // --no-shift (Oct 15): lane-slotter.ts owns the times of armed posts, so this script only arms held and missed ones.
 const shifting=process.argv.includes('--no-shift')?[]:keptArmed.filter(i=>owned(i)&&runAtOf(i)>=Date.now()+20*60000&&!releases.get(i.id).share_claimed_at);
 // Keep the same gap around posts other tools armed for a set time.
 const fixedTimes=keptArmed.filter(i=>!owned(i)).map(runAtOf);
 const keptGroups=[...new Set(shifting.sort((a,b)=>runAtOf(a)-runAtOf(b)).map(i=>i.media.sha256))].map(hash=>shifting.filter(i=>i.media.sha256===hash));
 // A Short joins the hour of the same video's armed Instagram/TikTok slot ("post all at once"); others get lane slots.
 const socialSlot=new Map<string,number>();
 if(lane==='youtube')for(const j of items)if(!inLane(j)&&releases.get(j.id)?.state==='armed'&&runAtOf(j)>Date.now()+15*60000)
  socialSlot.set(j.media.sha256,Math.min(socialSlot.get(j.media.sha256)??Infinity,runAtOf(j)));
 let laneSlot=0;const slotFor=(sha:string)=>{
  if(socialSlot.has(sha))return new Date(socialSlot.get(sha)!).toISOString();
  let t=next+(laneSlot++)*every;while(fixedTimes.some(f=>Math.abs(f-t)<every))t=next+(laneSlot++)*every;
  return new Date(t).toISOString();};
 for(const group of groups){
  const runAt=slotFor(group[0].media.sha256);
  for(const i of group){
   const prior=releases.get(i.id);
   const linkReel=relatedRef&&i.input.targets.some((t:any)=>t.platform==='instagram')&&!i.input.instagramRelatedReel&&i.input.caption!==relatedRef.caption;
   const input=validatePostingInput({...i.input,runAt,...(linkReel?{instagramRelatedReel:relatedRef}:{})});
   const attempts=(i.results?.autopilotBacklog?.attempts??0)+(prior&&prior.state!=='cancelled'?1:0);
   const note={at:new Date().toISOString(),attempts,priorRunAt:i.input.runAt,priorStatus:i.status,priorRelease:prior?{state:prior.state,run_at:prior.run_at,result:prior.result}:null,runAt};
   if(prior)await c.query('DELETE FROM scheduler.publishing_releases WHERE item_id=$1 AND share_claimed_at IS NULL',[i.id]);
   await c.query(`UPDATE scheduler.publishing_items SET status='held',input=$2,request_hash=$3,version=version+1,
     results=results||jsonb_build_object('autopilotBacklog',$4::jsonb),updated_at=now() WHERE id=$1`,[i.id,input,requestHash(input,i.media.sha256),note]);
   planned.push({id:i.id,name:i.media.name,platforms:input.targets.map((t:any)=>t.platform),runAt,version:i.version+1,priorStatus:i.status});
  }
 }
 // Shift the already-armed queue back in place: same order, same armed release, new time.
 const shifted:any[]=[];
 for(const group of keptGroups){
  const runAt=slotFor(group[0].media.sha256);
  for(const i of group){
   if(new Date(runAt).getTime()===runAtOf(i))continue;
   const input=validatePostingInput({...i.input,runAt});
   await c.query('UPDATE scheduler.publishing_items SET input=$2,request_hash=$3,version=version+1,updated_at=now() WHERE id=$1',[i.id,input,requestHash(input,i.media.sha256)]);
   await c.query(`UPDATE scheduler.publishing_releases SET run_at=$2,item_version=item_version+1,updated_at=now() WHERE item_id=$1 AND state='armed' AND share_claimed_at IS NULL`,[i.id,runAt]);
   shifted.push({name:i.media.name,from:releases.get(i.id).run_at,to:runAt});
  }
 }
 if(!apply){await c.query('ROLLBACK');}
 else{
  await c.query('COMMIT');
  const store=new TimedReleaseStore(db.pool);
  for(const p of planned){try{await store.arm(p.id,p.version,{nativeYouTubeLayout:lane==='youtube'});p.armed=true;}catch(e:any){p.armed=false;p.armError=e.message;}}
 }
 const report={createdAt:new Date().toISOString(),apply,lane,counts:{keptArmed:keptArmed.length,shifted:shifted.length,videos:groups.length,items:planned.length,armed:planned.filter(p=>p.armed).length,held:held.length},planned,shifted,held};
 await mkdir('.scheduler-data/autopilot-backlog',{recursive:true});
 await writeFile(`.scheduler-data/autopilot-backlog/${report.createdAt.replace(/[:.]/g,'-')}${apply?'-applied':'-dry-run'}-${lane}.json`,JSON.stringify(report,null,2));
 const pt=(s:string)=>new Date(s).toLocaleString('en-US',{timeZone:'America/Los_Angeles',weekday:'short',hour:'numeric',minute:'2-digit'});
 for(const p of planned)console.log(`${pt(p.runAt)} | ${p.platforms.join('+').padEnd(18)} | ${p.name}${apply?(p.armed?' | armed':' | NOT armed: '+p.armError):''}`);
 console.log('---\nKept out of the shuffle:');for(const h of held)console.log(`${h.platforms.join('+').padEnd(18)} | ${h.status.padEnd(12)} | ${h.name} | ${h.reason}${h.cancelledArmedRelease?' | old armed release cancelled':''}`);
 console.log(JSON.stringify(report.counts));
}catch(e){await c.query('ROLLBACK').catch(()=>undefined);throw e;}
finally{c.release();await db.close();}
