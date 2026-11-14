/** Score a captured Story job with the vision model and save it on the job. Usage: score-story.ts JOB_ID [...] | --held */
import {createDatabaseConnection} from '../src/database/client.js';
import {scoreStory} from '../src/publishing/story-score.js';
const db=createDatabaseConnection();
try{
 const ids=process.argv.includes('--held')?(await db.pool.query("SELECT id FROM scheduler.mirroring_story_jobs WHERE state IN ('needs_review','prepared','armed') AND native_frames IS NOT NULL AND approved_at>now()-interval '3 days'")).rows.map(r=>r.id):process.argv.slice(2);
 for(const id of ids){
  const j=(await db.pool.query('SELECT j.id,s.title,s.draft FROM scheduler.mirroring_story_jobs j JOIN scheduler.story_sequences s ON s.id=j.sequence_id WHERE j.id=$1',[id])).rows[0];if(!j)continue;
  const frames=await Promise.all([1,2,3,4,5].map(async f=>{const r=await fetch(`http://127.0.0.1:3000/api/publishing/stories/native/${id}/frames/${f}`);if(!r.ok)throw Error('frame '+f+' HTTP '+r.status);return Buffer.from(await r.arrayBuffer());}));
  try{const s=await scoreStory(frames,j.title,(j.draft?.frames??[]).map((f:any)=>String(f.text??'')));await db.pool.query(`UPDATE scheduler.mirroring_story_jobs SET result=result||jsonb_build_object('qualityScore',$2::jsonb) WHERE id=$1`,[id,JSON.stringify(s)]);
   console.log(`${j.title.slice(0,60)} | ${s.pass?'PASS':'FAIL'} overall ${s.overall} hook ${s.hook} cta ${s.cta} (${s.model})`);for(const f of s.frames)console.log(`  ${f.frame}: read ${f.readability} clip ${f.clipping} img ${f.image} fit ${f.fit} ${f.privacy} | ${f.note}${f.textFound!==undefined?' | OCR: '+f.textFound.slice(0,70):''}`);if(s.reasons.length)console.log('  reasons:',s.reasons.join('; '));}
  catch(e){console.log(j.title.slice(0,60),'| score error:',e instanceof Error?e.message:e);}
 }
}finally{await db.close();}
