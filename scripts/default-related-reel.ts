/** Give armed Instagram posts without a related Reel the reviewed default Reel. Keeps each post's time.
 * Dry run by default; --apply writes. Skips posts due within 30 minutes and any release with a Share claim. */
import {createDatabaseConnection} from '../src/database/client.js';
import {requestHash,validatePostingInput} from '../src/publishing/model.js';
import {reviewedRelatedReel} from '../src/publishing/instagram-related.js';
const apply=process.argv.includes('--apply'),db=createDatabaseConnection(),c=await db.pool.connect();
try{
 await c.query('BEGIN');
 if(!(await c.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) l',['00008130-000229EE1AA0001C'])).rows[0].l)throw Error('Phone busy');
 const ref=(await c.query(`SELECT input->'instagramRelatedReel' r FROM scheduler.publishing_items WHERE input->'instagramRelatedReel'->>'url'=$1 LIMIT 1`,[reviewedRelatedReel])).rows[0]?.r;
 if(!ref)throw Error('No saved details for the reviewed related Reel');
 const rows=(await c.query(`SELECT i.* FROM scheduler.publishing_items i JOIN scheduler.publishing_releases r ON r.item_id=i.id
   WHERE r.state='armed' AND r.share_claimed_at IS NULL AND r.run_at>now()+interval '30 minutes' AND r.item_version=i.version
   AND i.input->'targets' @> '[{"platform":"instagram"}]' AND NOT (i.input ? 'instagramRelatedReel') ORDER BY r.run_at FOR UPDATE OF i,r`)).rows;
 for(const i of rows){
  if(i.media.sha256&&i.input.caption===ref.caption)continue; // never link a Reel to itself
  const input=validatePostingInput({...i.input,instagramRelatedReel:ref});
  await c.query('UPDATE scheduler.publishing_items SET input=$2,request_hash=$3,version=version+1,updated_at=now() WHERE id=$1',[i.id,input,requestHash(input,i.media.sha256)]);
  await c.query('UPDATE scheduler.publishing_releases SET item_version=item_version+1,updated_at=now() WHERE item_id=$1',[i.id]);
  console.log((apply?'linked: ':'would link: ')+i.media.name);
 }
 await c.query(apply?'COMMIT':'ROLLBACK');console.log(rows.length,'Instagram posts',apply?'updated':'(dry run)');
}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();await db.close();}
