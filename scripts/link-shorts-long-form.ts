/** Link each Short to the owned long-form video that matches its topic (src/publishing/youtube-longform.ts).
 * Usage: link-shorts-long-form.ts <id,id,...|--queued> [--apply]. An entry id=VIDEO_ID sets that long-form by hand
 * (Oct 20: a reviewed pick beats a weak topic match). --queued takes every unclaimed Short that is held,
 * armed 10+ minutes out, or in review with no Upload claim. Database only; no phone input.
 * An armed release keeps its slot: its item_version moves with the item, like lane-slotter.ts.
 * The cover review keeps its frame-zero result and is rebound to the new link. */
import {createDatabaseConnection} from '../src/database/client.js';
import {chooseLongForm,longFormById} from '../src/publishing/youtube-longform.js';
import {requestHash,validatePostingInput} from '../src/publishing/model.js';
const [list]=process.argv.slice(2),apply=process.argv.includes('--apply');
if(!list)throw Error('Usage: link-shorts-long-form.ts <id,id,...|--queued> [--apply]');
const db=createDatabaseConnection(),c=await db.pool.connect();
try{
 await c.query('BEGIN');
 const rows=(await c.query(`SELECT i.*,r.state,r.share_claimed_at,r.run_at FROM scheduler.publishing_items i LEFT JOIN scheduler.publishing_releases r ON r.item_id=i.id
   WHERE i.input->'targets' @> '[{"platform":"youtube"}]' AND i.status IN ('held','needs_review') AND r.share_claimed_at IS NULL
   AND (r.item_id IS NULL OR r.state IN ('needs_review','cancelled') OR (r.state='armed' AND r.run_at>now()+interval '10 minutes'))
   AND ($1::uuid[] IS NULL OR i.id=ANY($1::uuid[])) FOR UPDATE OF i`,[list==='--queued'?null:list.split(',').map(x=>x.split('=')[0])])).rows;
 const manual=new Map(list==='--queued'?[]:list.split(',').filter(x=>x.includes('=')).map(x=>x.split('=') as [string,string]));
 for(const [id,video] of manual)if(!longFormById(video))throw Error(`${id}: ${video} is not an owned long-form video`);
 for(const i of rows){
  const by=manual.get(i.id),pick=by?{video:longFormById(by)!,score:null,topics:['reviewed by hand']}:chooseLongForm(i.input),from=i.input.youtube?.publishing?.relatedVideoId;
  if(pick.video.id===from){console.log('keep  ',i.media.name.slice(0,40).padEnd(40),'->',pick.video.titles[0]);continue;}
  const input=validatePostingInput({...i.input,youtube:{...i.input.youtube,publishing:{...i.input.youtube.publishing,relatedVideoId:pick.video.id}}});
  const choice={at:new Date().toISOString(),from,to:pick.video.id,score:pick.score,topics:pick.topics};
  const review=i.results?.directYouTubeReview?{...i.results.directYouTubeReview,relatedVideoId:pick.video.id}:undefined;
  await c.query(`UPDATE scheduler.publishing_items SET input=$2,request_hash=$3,version=version+1,updated_at=now(),
    results=results||jsonb_build_object('relatedLongForm',$4::jsonb)||CASE WHEN $5::jsonb IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('directYouTubeReview',$5::jsonb) END WHERE id=$1`,
    [i.id,input,requestHash(input,i.media.sha256),JSON.stringify(choice),review?JSON.stringify(review):null]);
  await c.query(`UPDATE scheduler.publishing_releases SET item_version=item_version+1,updated_at=now() WHERE item_id=$1 AND state='armed' AND share_claimed_at IS NULL`,[i.id]);
  console.log(apply?'linked':'would ',i.media.name.slice(0,40).padEnd(40),'->',pick.video.titles[0],'['+pick.topics.join(', ')+']');
 }
 await c.query(apply?'COMMIT':'ROLLBACK');
}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();await db.close();}
