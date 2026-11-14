/** Link each Instagram post to the owned Reel that matches its topic (src/publishing/instagram-related.ts).
 * Usage: link-reels-by-topic.ts <id,id,...|--queued> [--apply]. --queued takes every Instagram item that is held,
 * armed 10+ minutes out, or in review, with no Share claim. Database only; no phone input.
 * The post's own cover headline is read from its opening frame, so a re-cut of the same video is never linked.
 * An armed release keeps its slot: its item_version moves with the item, like link-shorts-long-form.ts. */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createDatabaseConnection} from '../src/database/client.js';
import {chooseRelatedReel,coverHeadline,relatedReelInput} from '../src/publishing/instagram-related.js';
import {requestHash,validatePostingInput} from '../src/publishing/model.js';
const run=promisify(execFile),[list]=process.argv.slice(2),apply=process.argv.includes('--apply');
if(!list)throw Error('Usage: link-reels-by-topic.ts <id,id,...|--queued> [--apply]');
const db=createDatabaseConnection(),c=await db.pool.connect();
try{
 await c.query('BEGIN');
 const rows=(await c.query(`SELECT i.* FROM scheduler.publishing_items i LEFT JOIN scheduler.publishing_releases r ON r.item_id=i.id
   WHERE i.input->'targets' @> '[{"platform":"instagram"}]' AND i.status IN ('held','needs_review') AND r.share_claimed_at IS NULL
   AND (r.item_id IS NULL OR r.state IN ('needs_review','cancelled') OR (r.state='armed' AND r.run_at>now()+interval '10 minutes'))
   AND ($1::uuid[] IS NULL OR i.id=ANY($1::uuid[])) FOR UPDATE OF i`,[list==='--queued'?null:list.split(',')])).rows;
 for(const i of rows){
  let headline='';
  try{const {stdout}=await run('ffmpeg',['-loglevel','error','-i',i.media.path,'-frames:v','1','-f','image2pipe','-vcodec','png','-'],{encoding:'buffer',maxBuffer:64<<20});headline=await coverHeadline(stdout as unknown as Buffer);}
  catch{console.log('skip  ',i.media.name,'(opening frame unreadable)');continue;}
  const pick=chooseRelatedReel({caption:i.input.caption,sha256:i.media.sha256,headline}),from=i.input.instagramRelatedReel?.url;
  if(pick.reel.url===from){console.log('keep  ',i.media.name.slice(0,40).padEnd(40),'->',pick.reel.label);continue;}
  const input=validatePostingInput({...i.input,instagramRelatedReel:relatedReelInput(pick.reel)});
  const choice={at:new Date().toISOString(),from:from??null,to:pick.reel.url,score:pick.score,topics:pick.topics};
  await c.query(`UPDATE scheduler.publishing_items SET input=$2,request_hash=$3,version=version+1,updated_at=now(),
    results=results||jsonb_build_object('relatedReel',$4::jsonb) WHERE id=$1`,[i.id,input,requestHash(input,i.media.sha256),JSON.stringify(choice)]);
  await c.query(`UPDATE scheduler.publishing_releases SET item_version=item_version+1,updated_at=now() WHERE item_id=$1 AND state='armed' AND share_claimed_at IS NULL`,[i.id]);
  console.log(apply?'linked':'would ',i.media.name.slice(0,40).padEnd(40),'->',pick.reel.label,'['+pick.topics.join(', ')+']');
 }
 await c.query(apply?'COMMIT':'ROLLBACK');
}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();await db.close();}
