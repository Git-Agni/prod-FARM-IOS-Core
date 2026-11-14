/** Antonio (Oct 11): post only one version of each video. Hook variants (original, A-curiosity, B-label,
 * C-contrarian, v4, v7...) of the same base video must not all go out. Per base video, keep the variant already
 * published most (else the first armed), and cancel unposted items of every other variant.
 * Nov 13 (Antonio: "3 hooks per all platforms but we'll spread out the video as we arm them"): the kit reels' hook versions
 * <slug>-h1, -h2, -h3 are meant to post, days apart (C2C hub tools/reel-clone/publish/arm_due_hooks.py). baseOf keeps -hN,
 * so each hook is its own base and is never cancelled here. Do not add -hN to the variant pattern.
 * Usage: one-variant-per-video.ts [--apply]. Database only; no phone input. */
import {createDatabaseConnection} from '../src/database/client.js';
const apply=process.argv.includes('--apply');
export const baseOf=(name:string)=>name.replace(/^video-(video-)?/,'').replace(/\.mp4$/,'')
  .replace(/-(cover|hq)$/,'').replace(/-1\.\d+x$/,'').replace(/-(cover)$/,'')
  .replace(/-(original|[A-Z]-[a-z]+|v\d+)$/,'').replace(/-\d+s-final$/,'');
const variantOf=(name:string)=>name.replace(/^video-(video-)?/,'').replace(/\.mp4$/,'');
const db=createDatabaseConnection();
try{
 // Approved reposts (repost-filler.ts, Oct 15) re-run a video that already went out; they are never cancelled here.
 const rows=(await db.pool.query(`SELECT i.id,i.status,i.media->>'name' n,r.state,r.run_at,r.share_claimed_at FROM scheduler.publishing_items i
   LEFT JOIN scheduler.publishing_releases r ON r.item_id=i.id WHERE i.status<>'cancelled' AND NOT (i.results ? 'repost')`)).rows;
 const groups=new Map<string,any[]>();for(const r of rows){const b=baseOf(r.n);groups.set(b,[...(groups.get(b)??[]),r]);}
 let cancelled=0;
 for(const [base,g] of groups){
  const variants=[...new Set(g.map(r=>variantOf(r.n)))];if(variants.length<2)continue;
  const score=(v:string)=>g.filter(r=>variantOf(r.n)===v&&r.status==='published').length;
  const firstArmed=(v:string)=>Math.min(...g.filter(r=>variantOf(r.n)===v&&r.state==='armed').map(r=>new Date(r.run_at).getTime()),Infinity);
  const keep=[...variants].sort((a,b)=>score(b)-score(a)||firstArmed(a)-firstArmed(b))[0]!;
  const drop=g.filter(r=>variantOf(r.n)!==keep&&r.status!=='published'&&!r.share_claimed_at);
  const livedup=variants.filter(v=>v!==keep&&score(v)>0);
  console.log(`${base}: keep ${keep} (published ${score(keep)}); cancel ${drop.length} unposted${livedup.length?'; ALREADY LIVE duplicates: '+livedup.map(v=>v+' x'+score(v)).join(', '):''}`);
  if(apply)for(const r of drop){
   await db.pool.query(`UPDATE scheduler.publishing_releases SET state='cancelled',result=result||jsonb_build_object('oneVariant',$2::text),updated_at=now() WHERE item_id=$1 AND share_claimed_at IS NULL AND state<>'published'`,[r.id,'Cancelled: another version of '+base+' is the one we post ('+keep+')']);
   await db.pool.query(`UPDATE scheduler.publishing_items SET status='cancelled',results=results||jsonb_build_object('oneVariant',jsonb_build_object('at',now(),'kept',$2::text)),updated_at=now() WHERE id=$1 AND status<>'published'`,[r.id,keep]);
   cancelled++;
  }
 }
 if(apply)console.log('cancelled',cancelled);
}finally{await db.close();}
