/** Record a frame-zero cover review for held YouTube Shorts. The worker's YouTube driver requires this record.
 * Usage: record-shorts-cover-review.ts <reviewer> <id,id,...> [--apply]. Hashes each file again; skips any Short
 * without an owned long-form link from src/publishing/youtube-longform.json. Writes no phone input and arms nothing. */
import {createDatabaseConnection} from '../src/database/client.js';
import {longFormById} from '../src/publishing/youtube-longform.js';
import {createHash} from 'node:crypto';import {createReadStream} from 'node:fs';
const [reviewer,list]=process.argv.slice(2),apply=process.argv.includes('--apply');
if(!reviewer||!list)throw Error('Usage: record-shorts-cover-review.ts <reviewer> <id,id,...> [--apply]');
const db=createDatabaseConnection();
try{
 for(const id of list.split(',')){
  const i=(await db.pool.query('SELECT * FROM scheduler.publishing_items WHERE id=$1',[id])).rows[0];
  if(!i||i.status!=='held'||!i.input.targets.some((t:any)=>t.platform==='youtube')){console.log('skip (not a held Short):',id);continue;}
  if(!longFormById(i.input.youtube?.publishing?.relatedVideoId)){console.log('skip (no owned long-form link):',i.media.name);continue;}
  const h=createHash('sha256');for await(const c of createReadStream(i.media.path))h.update(c);const sha=h.digest('hex');
  if(sha!==i.media.sha256){console.log('skip (file changed):',i.media.name);continue;}
  const review={checkedAt:new Date().toISOString(),sourceSha256:sha,coverReviewed:true,coverReview:{method:'frame zero visual review: readable headline',reviewer},relatedVideoId:i.input.youtube.publishing.relatedVideoId,nativePreflightRequired:true};
  if(apply)await db.pool.query(`UPDATE scheduler.publishing_items SET results=results||jsonb_build_object('directYouTubeReview',$2::jsonb),updated_at=now() WHERE id=$1 AND status='held'`,[id,review]);
  console.log(apply?'recorded:':'would record:',i.media.name);
 }
}finally{await db.close();}
