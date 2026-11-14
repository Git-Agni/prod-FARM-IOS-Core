/** Switch queued Instagram items back to Trial Reels with automatic promotion (Antonio, Oct 13: "We can go back to
 * Trial Reels, the account has been fixed"). Reverses instagram-trial-off.ts. Usage: instagram-trial-on.ts [--apply]
 * [--item=ID]. Only held items with an Instagram target and no Share claim change; armed releases keep their time.
 * Database only; no phone input. */
import {createDatabaseConnection} from '../src/database/client.js';
import {validatePostingInput,requestHash} from '../src/publishing/model.js';
const apply=process.argv.includes('--apply'),only=process.argv.find(a=>a.startsWith('--item='))?.slice(7);
const db=createDatabaseConnection();
try{
 const rows=(await db.pool.query(`SELECT i.* FROM scheduler.publishing_items i LEFT JOIN scheduler.publishing_releases r ON r.item_id=i.id
   WHERE i.status='held' AND NOT coalesce((i.input->>'instagramTrial')::boolean,false) AND r.share_claimed_at IS NULL
   AND i.input->'targets' @> '[{"platform":"instagram"}]' AND ($1::uuid IS NULL OR i.id=$1)`,[only??null])).rows;
 for(const i of rows){
  const input=validatePostingInput({...i.input,instagramTrial:true,automaticPromotion:true});
  if(!apply){console.log('would switch:',i.id,i.media.name);continue;}
  await db.pool.query(`UPDATE scheduler.publishing_items SET input=$2,request_hash=$3,version=version+1,
    results=results||jsonb_build_object('trialOn',jsonb_build_object('at',now(),'reason','Account fixed; Antonio restored Trial Reels on Oct 13')),updated_at=now() WHERE id=$1 AND status='held'`,[i.id,input,requestHash(input,i.media.sha256)]);
  await db.pool.query(`UPDATE scheduler.publishing_releases SET item_version=item_version+1,updated_at=now() WHERE item_id=$1 AND state='armed' AND share_claimed_at IS NULL`,[i.id]);
  console.log('switched:',i.id,i.media.name);
 }
 console.log(rows.length,'items',apply?'switched':'(dry run)');
}finally{await db.close();}
