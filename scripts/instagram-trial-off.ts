/** Switch queued Instagram items from Trial to regular Reels (Antonio, Oct 11: "Trial reels are not available for now,
 * keep the actual posting through normal reels"). Usage: instagram-trial-off.ts [--apply]. Only held items with no Share
 * claim change; armed releases keep their time. Database only; no phone input. */
import {createDatabaseConnection} from '../src/database/client.js';
import {validatePostingInput,requestHash} from '../src/publishing/model.js';
const apply=process.argv.includes('--apply');const db=createDatabaseConnection();
try{
 const rows=(await db.pool.query(`SELECT i.* FROM scheduler.publishing_items i LEFT JOIN scheduler.publishing_releases r ON r.item_id=i.id
   WHERE i.status='held' AND (i.input->>'instagramTrial')::boolean AND r.share_claimed_at IS NULL`)).rows;
 for(const i of rows){
  const input=validatePostingInput({...i.input,instagramTrial:false,automaticPromotion:false});
  if(!apply){console.log('would switch:',i.media.name);continue;}
  await db.pool.query(`UPDATE scheduler.publishing_items SET input=$2,request_hash=$3,version=version+1,
    results=results||jsonb_build_object('trialOff',jsonb_build_object('at',now(),'reason','Trial Reels unavailable; Antonio approved regular Reels on Oct 11')),updated_at=now() WHERE id=$1 AND status='held'`,[i.id,input,requestHash(input,i.media.sha256)]);
  await db.pool.query(`UPDATE scheduler.publishing_releases SET item_version=item_version+1,updated_at=now() WHERE item_id=$1 AND state='armed' AND share_claimed_at IS NULL`,[i.id]);
  console.log('switched:',i.media.name);
 }
 console.log(rows.length,'items',apply?'switched':'(dry run)');
}finally{await db.close();}
