/** Re-queue Instagram/Facebook items whose Share was claimed but never posted (Antonio, Oct 8: "Never stop before posting everything").
 * Usage: requeue-verified-unposted.ts            dry run: Graph check of every claimed needs_review Instagram item
 *        requeue-verified-unposted.ts --apply [--only=NAME] [--min-claim-hours=N]    record the proof, cancel the old item, create a fresh held item
 * Acts only when the Share claim is over 24 hours old and neither the latest 300 Instagram posts nor the latest
 * 100 Facebook Reels carry the caption (exact or first 60 characters). The backlog arms the fresh item.
 * Database and read-only Graph calls; no phone input. */
import {execFileSync} from 'node:child_process';
import {createDatabaseConnection} from '../src/database/client.js';
import {PublishingStore} from '../src/publishing/store.js';
import {validatePostingInput,requestHash} from '../src/publishing/model.js';
import {normalizeText} from '../src/publishing/meta-receipts.js';

const apply=process.argv.includes('--apply'),only=process.argv.find(v=>v.startsWith('--only='))?.slice(7);
// Default 24h. Lower only when Instagram itself showed "Not posted ... saved in your drafts" (it stopped retrying).
const minHours=Number(process.argv.find(v=>v.startsWith('--min-claim-hours='))?.slice(18)??24);
const secrets=JSON.parse(execFileSync('/usr/bin/python3',['-c',`
import importlib.util,os,json
s=importlib.util.spec_from_file_location("s",os.path.expanduser("~/.local/share/c2c-secrets/c2c_secrets.py"));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
f=m.fields("c2c-monorepo","Meta Marketing API — Antonio Monteiro (C2C ads + lead forms)")
print(json.dumps({"meta":f.get("token") or f.get("credential"),"page":str(f.get("page antonio revenue","")).split()[0]}))`],{encoding:'utf8',timeout:60_000}));
const g=async(path:string,params:Record<string,string>)=>{
 const r=await (await fetch(`https://graph.facebook.com/v21.0/${path}?${new URLSearchParams(params)}`,{signal:AbortSignal.timeout(30_000)})).json() as any;
 if(r.error)throw Error('Graph error: '+r.error.message);return r;};
const page=await g(secrets.page,{fields:'access_token,instagram_business_account',access_token:secrets.meta});
const token=page.access_token??secrets.meta,ig=page.instagram_business_account?.id;
if(!ig)throw Error('No Instagram account on the page');
const media:any[]=[];let after:string|undefined;
for(let n=0;n<3;n++){const r=await g(ig+'/media',{fields:'caption,permalink,timestamp',limit:'100',access_token:token,...(after?{after}:{})});
 media.push(...(r.data??[]));after=r.paging?.next?r.paging.cursors?.after:undefined;if(!after)break;}
const reels=(await g(secrets.page+'/video_reels',{fields:'description,created_time',limit:'100',access_token:token})).data??[];
if(media.length<100||reels.length<50)throw Error(`Graph scan too small (${media.length} posts, ${reels.length} reels); not trusting a miss`);

const db=createDatabaseConnection();
try{
 const rows=(await db.pool.query(`SELECT i.*,r.share_claimed_at FROM scheduler.publishing_items i JOIN scheduler.publishing_releases r ON r.item_id=i.id
   WHERE r.state='needs_review' AND r.share_claimed_at IS NOT NULL AND r.share_claimed_at<now()-make_interval(secs=>$1::float8*3600)
   AND i.input->'targets' @> '[{"platform":"instagram"}]'`,[minHours])).rows.filter((i:any)=>!only||i.media.name.includes(only));
 const store=new PublishingStore(db.pool);
 for(const i of rows){
  const want=normalizeText(i.input.caption),head=want.slice(0,60);
  const seen=media.filter(m=>normalizeText(m.caption??'').startsWith(head)).length+reels.filter((r:any)=>normalizeText(r.description??'').startsWith(head)).length;
  if(seen){console.log('posted or similar caption found, kept in review:',i.media.name);continue;}
  const proof={verified:true,checkedAt:new Date().toISOString(),instagramPostsScanned:media.length,facebookReelsScanned:reels.length,
   shareClaimedAt:i.share_claimed_at,evidence:'No Instagram post or Facebook Reel carries this caption (exact or first 60 characters) via the Graph API'};
  const input=validatePostingInput({...i.input,requestId:`requeue-${new Date().toISOString().slice(0,10)}-${i.id}`.slice(0,120),runAt:new Date(Date.now()+86400_000).toISOString()});
  if(!apply){console.log('would re-queue:',i.media.name);continue;}
  await db.pool.query(`UPDATE scheduler.publishing_items SET status='cancelled',results=results||jsonb_build_object('verifiedNotPosted',$2::jsonb),version=version+1,updated_at=now() WHERE id=$1 AND status='needs_review'`,[i.id,proof]);
  await db.pool.query(`UPDATE scheduler.publishing_releases SET state='cancelled',result=result||jsonb_build_object('verifiedNotPosted',$2::jsonb),updated_at=now() WHERE item_id=$1 AND state='needs_review'`,[i.id,proof]);
  const {item,replayed}=await store.create(input,requestHash(input,i.media.sha256),i.media,i.cover??undefined,{requeuedFrom:{id:i.id,proof}});
  console.log(replayed?'exists:':'re-queued:',i.media.name,item.id);
 }
 if(!rows.length)console.log('No claimed Instagram items in review older than 24 hours');
}finally{await db.close();}
