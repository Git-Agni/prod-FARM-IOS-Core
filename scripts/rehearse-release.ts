/** Rehearse one calendar item on the phone up to the final Share/Post/Upload step, then back out. Never submits.
 * Usage: rehearse-release.ts ITEM_ID. Holds the phone lock, runs the zero-volume check, and leaves the item and
 * its release unchanged. A failure saves a screenshot and screen tree under .scheduler-data/release-failures. */
import {createDatabaseConnection} from '../src/database/client.js';
import {DirectMediaStore} from '../src/publishing/direct-media.js';
import {NativeMuteGuard} from '../src/publishing/native-mute.js';
import {YouTubeRelease} from '../src/publishing/youtube-release.js';
import {InstagramRelease} from '../src/publishing/instagram-release.js';
import {TikTokRelease} from '../src/publishing/tiktok-release.js';
const id=process.argv[2];if(!/^[a-f0-9-]{36}$/.test(id??''))throw Error('Usage: rehearse-release.ts ITEM_ID');
const db=createDatabaseConnection(),c=await db.pool.connect(),base='http://127.0.0.1:8100';
const signal=AbortSignal.timeout(15*60_000);let locked=false,phone='',driver:any;
try{
 const item=(await c.query('SELECT * FROM scheduler.publishing_items WHERE id=$1',[id])).rows[0];if(!item)throw Error('Item not found');
 const release=(await c.query('SELECT share_claimed_at FROM scheduler.publishing_releases WHERE item_id=$1',[id])).rows[0];
 if(release?.share_claimed_at||item.status==='published')throw Error('This item already has a Share attempt; not rehearsed');
 phone=item.input.deviceUdid;
 locked=(await c.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) l',[phone])).rows[0].l;if(!locked)throw Error('Phone busy');
 const imports=new DirectMediaStore(db.pool);await imports.initialize();
 const platforms=item.input.targets.map((t:any)=>t.platform);
 const sibling=(await c.query(`SELECT 1 FROM scheduler.publishing_items s WHERE s.id<>$1 AND s.media->>'sha256'<>$2 AND s.input->>'caption'=$3
   AND s.input->'targets'->0->>'platform'='tiktok' AND s.status='published' LIMIT 1`,[item.id,item.media.sha256,item.input.caption])).rowCount===1;
 driver=platforms.includes('youtube')?new YouTubeRelease(base,signal,item,imports):platforms.includes('tiktok')?new TikTokRelease(base,signal,imports,sibling):new InstagramRelease(base,signal,imports);
 if(!platforms.includes('youtube'))await new NativeMuteGuard(base,signal).prepare();
 const started=Date.now();
 const evidence=await driver.preflight(item.input,item.media);
 console.log(`REHEARSAL PASSED ${platforms.join('+')} in ${Math.round((Date.now()-started)/1000)} s; stopped before submit.`);
 if(driver?.evidence?.captionBeforeShare)console.log("caption before Share: "+driver.evidence.captionBeforeShare);
 console.log(JSON.stringify(evidence).slice(0,600));
}catch(e:any){
 console.log('REHEARSAL STOPPED:',e.message);
 if(driver?.captureFailure)console.log('evidence:',await driver.captureFailure('rehearse-'+id.slice(0,8)).catch(()=>'none'));
}finally{
 try{if(driver?.resetAfterFailure)await driver.resetAfterFailure();}catch{}
 if(locked)await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[phone]);c.release();await db.close();
}
