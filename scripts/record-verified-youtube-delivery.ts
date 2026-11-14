/** Mark a held or needs_review Short published when the YouTube Data API shows its earlier upload is public.
 * Usage: record-verified-youtube-delivery.ts <evidence.json> [--apply]. Evidence: [{itemId, videoId, title, publishedAt,
 * privacyStatus}] read from the channel's uploads playlist. Database only; no phone input, no upload, no arming.
 * Refuses an item with a Share claim, an armed release, or a recorded URL for a different video. */
import {readFile} from 'node:fs/promises';
import {createDatabaseConnection} from '../src/database/client.js';
const [file]=process.argv.slice(2),apply=process.argv.includes('--apply');
if(!file)throw Error('Usage: record-verified-youtube-delivery.ts <evidence.json> [--apply]');
const proof=JSON.parse(await readFile(file,'utf8')) as {itemId:string,videoId:string,title:string,publishedAt:string,privacyStatus:string}[];
const db=createDatabaseConnection(),c=await db.pool.connect();
try{
 await c.query('BEGIN');
 for(const p of proof){
  const i=(await c.query(`SELECT i.*,r.state,r.share_claimed_at FROM scheduler.publishing_items i LEFT JOIN scheduler.publishing_releases r ON r.item_id=i.id WHERE i.id=$1 FOR UPDATE OF i`,[p.itemId])).rows[0];
  if(!i||!['held','needs_review'].includes(i.status)||!i.input.targets.some((t:any)=>t.platform==='youtube'))throw Error('Not a held or needs_review Short: '+p.itemId);
  if(i.share_claimed_at||i.state==='armed'||i.state==='running')throw Error('Release is active or claimed; reconcile manually: '+p.itemId);
  const known=i.results?.externalYouTubeDelivery?.publicUrl;
  if(known&&!String(known).includes(p.videoId))throw Error('Recorded URL is a different video: '+p.itemId);
  if(p.privacyStatus!=='public')throw Error('Upload is not public: '+p.videoId);
  const url='https://www.youtube.com/shorts/'+p.videoId;
  const release={receipts:{youtube:{verified:true,url,source:'youtube_data_api',evidence:`Public upload ${p.videoId} "${p.title}" on channel ${i.input.youtube.channelId}, published ${p.publishedAt}; read from the uploads playlist`}},
   externalDelivery:true,doNotReupload:true,checkedAt:new Date().toISOString()};
  if(apply)await c.query(`UPDATE scheduler.publishing_items SET status='published',version=version+1,results=results||jsonb_build_object('release',$2::jsonb),updated_at=now() WHERE id=$1 AND version=$3`,[i.id,release,i.version]);
  console.log(apply?'published:':'would publish:',i.id,url);
 }
 await c.query(apply?'COMMIT':'ROLLBACK');
}catch(e){await c.query('ROLLBACK');throw e}finally{c.release();await db.close()}
