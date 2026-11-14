/** RETIRED Oct 15 21:15 (Antonio): Instagram flagged the first repost as already-posted content and he deleted it.
 * Never post the exact same video twice. Not scheduled; the duplicate guard in TimedReleaseStore.arm now blocks it too.
 * Keep Instagram posting when new videos run out (Antonio, Oct 15: "if we are out of videos repost the old ones that
 * performed well that are following our ai niche"). Hourly, after lane-slotter.ts. For each Instagram slot (cadence.ts)
 * in the next 6 hours with no post, re-queue the best older Reel: AI-niche caption, first posted 7+ days ago, no
 * Instagram release in the last 7 days (Trial Reels reach non-followers first), source file still on disk, ranked by Instagram views (Graph insights, read-only), at least 500.
 * The repost is a new calendar item (Trial, automatic promotion, linked Facebook) marked results.repost, armed through
 * the normal store. Fresh videos keep every slot beyond 6 hours. Dry run by default; --apply writes. No phone input. */
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {createDatabaseConnection} from '../src/database/client.js';
import {publishingCadence as cadence,slotsFrom} from '../src/publishing/cadence.js';
import {laneHours} from '../src/publishing/lanes.js';
import {normalizeText} from '../src/publishing/meta-receipts.js';
import {TimedReleaseStore} from '../src/publishing/timed-release.js';
import {DirectMediaStore} from '../src/publishing/direct-media.js';

if(process.argv.includes('--apply'))throw Error('Reposting the same video is retired (Antonio, Oct 15)');
const apply=false,day=86400000,hour=3600000,minute=60000;
const minViews=500;   // "performed well": at least 500 Instagram views
const horizon=Number(process.argv.find(a=>a.startsWith('--horizon-hours='))?.split('=')[1]??6);
export const aiNiche=/\b(ai|a\.i\.|claude|chatgpt|gpt|openai|gemini|llm|agents?|automat\w*|prompt\w*|cursor|copilot|n8n|hermes|heygen|elevenlabs|github|open[- ]source|repo)\b/i;
function graphToken(){return JSON.parse(execFileSync('/usr/bin/python3',['-c',`
import importlib.util,os,json
s=importlib.util.spec_from_file_location("s",os.path.expanduser("~/.local/share/c2c-secrets/c2c_secrets.py"));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
f=m.fields("c2c-monorepo","Meta Marketing API — Antonio Monteiro (C2C ads + lead forms)")
print(json.dumps({"meta":f.get("token") or f.get("credential"),"page":str(f.get("page antonio revenue","")).split()[0]}))`],{encoding:'utf8',timeout:60000}));}
const cli=(...a:string[])=>JSON.parse(execFileSync('python3',['scripts/publishing.py',...a],{encoding:'utf8'}));
const pt=(ms:number)=>new Date(ms).toLocaleString('en-US',{timeZone:cadence.timezone,weekday:'short',hour:'numeric',minute:'2-digit'});

const db=createDatabaseConnection();
try{
 const now=Date.now();
 const ig=(await db.pool.query(`SELECT i.*,r.state,r.run_at FROM scheduler.publishing_items i LEFT JOIN scheduler.publishing_releases r ON r.item_id=i.id
   WHERE i.input->'targets' @> '[{"platform":"instagram"}]'`)).rows;
 const live=ig.filter(r=>r.state&&r.state!=='cancelled');
 const taken=new Set(live.map(r=>Math.round(new Date(r.run_at).getTime()/hour)*hour));
 const free=slotsFrom(now+20*minute,laneHours().instagram,Math.ceil(horizon/24)+1).filter(s=>s<now+horizon*hour&&!taken.has(s));
 if(!free.length){console.log(JSON.stringify({freeSlots:0,reposted:0}));process.exit(0);}
 // Views for our recent Reels (read-only Graph insights).
 const s=graphToken();
 const g=async(p:string,q:any)=>(await (await fetch(`https://graph.facebook.com/v21.0/${p}?${new URLSearchParams(q)}`,{signal:AbortSignal.timeout(30000)})).json()) as any;
 const page=await g(s.page,{fields:'access_token,instagram_business_account',access_token:s.meta});
 const views=new Map<string,number>();let next:string|undefined=page.instagram_business_account.id+'/media';let params:any={fields:'permalink,timestamp,insights.metric(views)',limit:'50',access_token:page.access_token};
 for(let n=0;n<6&&next;n++){const r=await g(next,params);for(const m of r.data??[])views.set(m.permalink,m.insights?.data?.[0]?.values?.[0]?.value??0);
  next=r.paging?.next?r.paging.next.replace('https://graph.facebook.com/v21.0/',''):undefined;params={};if(next){const u=new URL('https://x/'+next);next=u.pathname.slice(1);params=Object.fromEntries(u.searchParams);}}
 // Candidates: published Instagram items with a Graph permalink, by base video.
 const lastIg=new Map<string,number>();for(const r of live)lastIg.set(r.media.sha256,Math.max(lastIg.get(r.media.sha256)??0,new Date(r.run_at).getTime()));
 const firstIg=new Map<string,number>();for(const r of live)firstIg.set(r.media.sha256,Math.min(firstIg.get(r.media.sha256)??Infinity,new Date(r.run_at).getTime()));
 const seen=new Set<string>();const candidates:any[]=[];
 for(const r of ig.filter(x=>x.status==='published'&&!x.results?.repost)){
  const url=r.results?.release?.receipts?.instagram?.url;if(!url||seen.has(r.media.sha256))continue;
  if(!aiNiche.test(normalizeText(r.input.caption)))continue;
  if(now-(firstIg.get(r.media.sha256)??now)<7*day||now-(lastIg.get(r.media.sha256)??0)<7*day)continue;
  if(!r.media.path||!existsSync(r.media.path))continue;
  if((views.get(url)??0)<minViews)continue;
  seen.add(r.media.sha256);candidates.push({item:r,url,views:views.get(url)??0});
 }
 candidates.sort((a,b)=>b.views-a.views);
 const limit=Number(process.argv.find(a=>a.startsWith('--limit='))?.split('=')[1]??99);
 const plan=free.map((slot,n)=>({slot,c:candidates[n]})).filter(x=>x.c).slice(0,limit);
 for(const {slot,c} of plan)console.log(`${pt(slot).padEnd(14)} repost ${c.item.media.name} (${c.views} views, ${c.url})`);
 const out:any[]=[];
 if(apply){
  mkdirSync('.scheduler-data/reposts',{recursive:true});
  for(const {slot,c} of plan){
   const o=c.item.input,stamp=new Date(slot).toISOString().slice(0,13).replace(/\D/g,'');
   const input={...o,requestId:`repost-${c.item.id.slice(0,8)}-${stamp}`,runAt:new Date(slot).toISOString(),instagramTrial:true,automaticPromotion:true};
   const path=`.scheduler-data/reposts/${input.requestId}.json`;writeFileSync(path,JSON.stringify(input));
   try{
    const existing=(await db.pool.query('SELECT id FROM scheduler.publishing_items WHERE request_id=$1',[input.requestId])).rows[0];
    const d=existing??cli('prepare','--input',path,'--video',c.item.media.path);
    await db.pool.query(`UPDATE scheduler.publishing_items SET results=results||jsonb_build_object('repost',jsonb_build_object('of',$2::text,'url',$3::text,'views',$4::int,'approvedBy','Antonio, chat 2026-10-15')),updated_at=now() WHERE id=$1 AND status='held'`,[d.id,c.item.id,c.url,c.views]);
    const back=cli('get',d.id);
    // Oct 15 21:00: the first repost failed with "Exact Instagram album is missing": the phone album from the original
    // post (Oct 8) was gone but the import journal still said imported. A finished import is forgotten so the post
    // imports a fresh copy; an uncertain import is never forgotten (forgetMissingAlbum only removes state 'imported').
    await new DirectMediaStore(db.pool).forgetMissingAlbum(o.deviceUdid,c.item.media.sha256);
    await new TimedReleaseStore(db.pool).arm(d.id,back.version);
    const st=(await db.pool.query('SELECT state,run_at FROM scheduler.publishing_releases WHERE item_id=$1',[d.id])).rows[0];
    out.push({id:d.id,name:c.item.media.name,slot:pt(slot),state:st?.state});
   }catch(e:any){out.push({name:c.item.media.name,slot:pt(slot),error:String(e.stderr||e.message).slice(0,200)});}
  }
 }
 console.log(JSON.stringify({freeSlots:free.length,candidates:candidates.length,planned:plan.length,applied:apply,out}));
}finally{await db.close();}
