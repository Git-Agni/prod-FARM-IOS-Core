/** Post (or pin) the first comment on one published post older than the worker's 24-hour comment window.
 * Usage: backfill-comment.ts instagram|facebook|tiktok ITEM_ID. Uses the normal one-shot claim (runPostComment):
 * an uncertain comment is never typed again. Refuses while a video release is due within 15 minutes. */
import {createDatabaseConnection} from '../src/database/client.js';
import {InstagramRelease} from '../src/publishing/instagram-release.js';
import {FacebookComments} from '../src/publishing/facebook-comments.js';
import {TikTokRelease} from '../src/publishing/tiktok-release.js';
import {runPostComment,commentKey} from '../src/publishing/post-comments.js';
const [platform,id]=process.argv.slice(2) as any;
if(!['instagram','facebook','tiktok'].includes(platform)||!/^[a-f0-9-]{36}$/.test(id??''))throw Error('Usage: backfill-comment.ts instagram|facebook|tiktok ITEM_ID');
const db=createDatabaseConnection(),base='http://127.0.0.1:8100',signal=AbortSignal.timeout(8*60_000);
try{
 const due=(await db.pool.query(`SELECT 1 FROM scheduler.publishing_releases WHERE state IN ('armed','running') AND run_at<now()+interval '15 minutes' AND run_at>now()-interval '30 minutes'`)).rowCount;
 if(due)throw Error('A video release is due within 15 minutes; try after it');
 const driver:any=platform==='instagram'?new InstagramRelease(base,signal):platform==='facebook'?new FacebookComments(base,signal):new TikTokRelease(base,signal);
 await runPostComment(db.pool,id,platform,driver);
 const r=(await db.pool.query('SELECT status,result FROM scheduler.engagement_actions WHERE claim_key=$1',[commentKey(platform,id)])).rows[0];
 console.log(JSON.stringify({platform,id,status:r?.status,result:r?.result}));
}finally{await db.close();}
