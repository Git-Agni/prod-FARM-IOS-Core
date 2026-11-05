import type {PostingInput} from './model.js';
import{NativeMuteGuard}from'./native-mute.js';
import{YouTubeRelease}from'./youtube-release.js';
import{runDirectStories}from'./wda-stories.js';
import {PreparedTikTokRelease} from './prepared-tiktok.js';
import {PreparedInstagramRelease} from './prepared-instagram.js';
import {PreparedYouTubeRelease} from './prepared-youtube.js';
import {DirectMediaStore} from './direct-media.js';
import {directReleaseIds,directReleaseAllArmed,directPausedCommentPlatforms} from './direct-policy.js';
import {directVideoDueSoon} from './direct-comments.js';
import {MirroringCommentDriver,loadNativeCommentFlow} from './mirroring-comments.js';
import {createMirroringDriver} from './mirroring-driver.js';
import type { Pool } from 'pg';
import { loadRegisteredDevices } from '../devices/registry.js';
import { TimedReleaseStore } from './timed-release.js';
import { TikTokRelease } from './tiktok-release.js';
import {FacebookComments} from './facebook-comments.js';
import {YouTubeComments} from './youtube-comments.js';
import {runPostComment, commentKey, type CommentPlatform} from './post-comments.js';
import {ENGAGEMENT_SCHEMA} from './engage-task.js';
import { InstagramRelease } from './instagram-release.js';
import { nativeDriverStatus } from './driver-health.js';
import { phoneControlMode } from '../devices/control-mode.js';
import {MirroringAutomationStore,nativeGroup,nativeFingerprint} from './mirroring-automation.js';
import {MirroringMediaStore} from './mirroring-media-store.js';
import {NativeStoryStore,NativeStoryDriver,loadNativeStoryFlow} from './mirroring-stories.js';
import path from 'node:path';
import { ReleaseWorkerStatusStore } from './worker-health.js';
import { mirroringStatus } from '../devices/mirroring/controller.js';
import { phoneAudioStatus, verifiedPhoneMute } from '../devices/mirroring/audio.js';
import { instagramWriteHold } from './instagram-write-hold.js';

/** Oct 19: one tick waited forever on an exhausted database pool and posting stopped for five hours. No single step
 * (a 25-minute release, a 15-minute Story run, an 8-minute receipt or comment check) may go this long without progress.
 * Exiting lets launchd's KeepAlive restart the worker, and startup marks the interrupted job for review. */
export const stalledTickMs = 40 * 60_000;
export const tickStalled = (busy: boolean, progressAt: number, now = Date.now()) => busy && now - progressAt > stalledTickMs;

/** Runs armed native releases at their target time. One release at a time; the store's phone lock and Share claim do the rest. */
export async function startReleaseLoop(pool: Pool): Promise<{ close(): Promise<void> }> {
    const store = new TimedReleaseStore(pool);
    await store.initialize();
    const directImports=new DirectMediaStore(pool);await directImports.initialize();
    await pool.query(ENGAGEMENT_SCHEMA);
    await store.recoverInterrupted();   // never replay a release the worker lost mid-run
    const health = new ReleaseWorkerStatusStore(pool);
    await health.initialize();
    const automation=new MirroringAutomationStore(pool),imports=new MirroringMediaStore(pool),nativeStories=new NativeStoryStore(pool);
    await automation.initialize();await imports.initialize();await nativeStories.initialize();await nativeStories.recoverInterrupted();
    let busy = false, progressAt = Date.now();
    const progress = () => { progressAt = Date.now(); };
    const controller = new AbortController();
    // While a long job runs, keep the heartbeat current so a stale heartbeat means the worker is really stuck or gone.
    const watchdog = setInterval(() => {
        if (tickStalled(busy, progressAt)) {
            console.error(new Date().toISOString(), `release worker made no progress for ${Math.round((Date.now()-progressAt)/60_000)} min; exiting so launchd restarts it`);
            process.exit(1);
        }
        if (busy) void health.touch().catch(() => undefined);
    }, 30_000);
    // Nov 5: a 03:19 PT network drop left dead clients checked out. The pool stayed full, every release from 08:00 PT
    // failed in 40 s with "timeout exceeded when trying to connect", and nothing restarted the worker for 9 hours.
    // Probe the pool every minute; three failed probes in a row while it is full means it is wedged: exit for launchd.
    let poolFailures = 0;
    const poolProbe = setInterval(() => {
        pool.query('SELECT 1').then(() => { poolFailures = 0; }).catch((error: Error) => {
            const full = pool.totalCount >= ((pool as any).options?.max ?? 10) && pool.idleCount === 0;
            poolFailures = full ? poolFailures + 1 : 0;
            console.error(new Date().toISOString(), `database pool probe failed (${poolFailures}/3, total ${pool.totalCount}, idle ${pool.idleCount}, waiting ${pool.waitingCount}):`, error.message);
            if (poolFailures >= 3) { console.error(new Date().toISOString(), 'database pool is wedged; exiting so launchd restarts the worker'); process.exit(1); }
        });
    }, 60_000);
    poolProbe.unref();
    const tick = async () => {
        if (busy) return;
        busy = true; progress();
        try {
            if (phoneControlMode() === 'mirroring') {
                const status=await automation.status();
                if(!status.foregroundAllowed){await health.tick({controlMode:'mirroring',state:'blocked',blockers:[status.reason]});return;}
                const [control,audio]=await Promise.all([mirroringStatus(),phoneAudioStatus()]);
                const blockers=[...(!control.controlReady?[control.reason]:[]),...(!verifiedPhoneMute(audio)?['Phone audio mute must pass before posting.']:[])];
                if(blockers.length){await health.tick({controlMode:'mirroring',state:'blocked',blockers});return;}
                const pilots=await automation.pendingPilots();
                const devices=(await loadRegisteredDevices()).filter(d=>!d.disabled&&d.coordinateProfile==='iphone15promax');
                const rows=(await pool.query("SELECT i.id,i.input FROM scheduler.publishing_items i JOIN scheduler.publishing_releases r ON r.item_id=i.id WHERE r.state='armed' AND i.status='held'")).rows;
                const allowed:string[]=[];
                for(const row of rows){
                    try{
                        const group=nativeGroup(row.input),flow=status.flows[group];
                        if(!flow?.fingerprint||!devices.some(d=>d.udid===row.input.deviceUdid))continue;
                        const pilot=pilots.some(p=>p.item_id===row.id&&p.state==='pending'&&p.fingerprint===flow.fingerprint);
                        const commentsReady=!row.input.firstComment||row.input.targets.every((t:any)=>status.comments[t.platform]?.qualified===true);
                        if(flow.qualified&&commentsReady||pilot)allowed.push(row.id);
                    }catch{/* Unmapped items remain unchanged. */}
                }
                const driverFor=async(item:any)=>(progress(),createMirroringDriver(pool,item,AbortSignal.any([controller.signal,AbortSignal.timeout(15*60_000)])));
                const qualified=Object.values(status.flows).some((f:any)=>f.qualified);
                await health.tick({controlMode:'mirroring',state:allowed.length||qualified?'running':'blocked',blockers:allowed.length||qualified?[]:['Native layouts and a real worker pilot are required before automatic posting.']});
                await store.tick(driverFor,udid=>devices.some(d=>d.udid===udid),allowed);
                for(const pilot of pilots)await automation.finishPilot(pilot.item_id);
                // Reconciliation can read receipts, but cannot call import or Share.
                for(const row of (await pool.query("SELECT i.id,i.input FROM scheduler.publishing_items i JOIN scheduler.publishing_releases r ON r.item_id=i.id WHERE r.state='needs_review' AND r.share_claimed_at IS NOT NULL AND r.updated_at<now()-interval '5 minutes' ORDER BY r.updated_at LIMIT 20")).rows){
                    try{if(status.flows[nativeGroup(row.input)]?.qualified||pilots.some(p=>p.item_id===row.id&&p.fingerprint===status.flows[nativeGroup(row.input)]?.fingerprint)){await store.reconcilePending(driverFor,row.id);break;}}catch{/* Keep uncertain claims intact. */}
                }
                // First comments use their own lock and one-shot claim, after verified native delivery.
                const urgent=(await pool.query("SELECT 1 FROM scheduler.publishing_releases WHERE state='armed' AND item_id=ANY($1::uuid[]) AND run_at>now()-interval '10 minutes' AND run_at<now()+interval '5 minutes' LIMIT 1",[allowed])).rowCount;
                if(!urgent){
                    const recent=(await pool.query("SELECT * FROM scheduler.publishing_items WHERE status='published' AND input ? 'firstComment' AND updated_at>now()-interval '24 hours' ORDER BY updated_at DESC LIMIT 30")).rows;
                    let ran=false;
                    for(const item of recent){
                        if(!devices.some(d=>d.udid===item.input.deviceUdid))continue;
                        const group=nativeGroup(item.input);
                        if(item.results?.release?.nativeFlowFingerprint!==status.flows[group]?.fingerprint)continue;
                        for(const platform of ['instagram','facebook','tiktok'] as CommentPlatform[]){
                        if(directPausedCommentPlatforms().includes(platform))continue;
                            if(!item.input.targets.some((t:any)=>t.platform===platform)||!status.comments[platform]?.layoutAvailable)continue;
                            const pilot=pilots.some(p=>p.item_id===item.id)||status.flows[group]?.pilotItemId===item.id;
                            if(!status.comments[platform].qualified&&!pilot)continue;
                            const key=commentKey(platform,item.id);
                            if((await pool.query('SELECT 1 FROM scheduler.engagement_actions WHERE claim_key=$1',[key])).rowCount)continue;
                            const d=new MirroringCommentDriver(AbortSignal.any([controller.signal,AbortSignal.timeout(180_000)]),await loadNativeCommentFlow(platform),path.resolve('.scheduler-data/publishing/native-comment-runs',item.id+'-'+platform));
                            const fingerprint=await automation.commentFingerprint(platform);
                            d.screen.beforeInput=async()=>{if(!await automation.foregroundAllowed()||await automation.commentFingerprint(platform)!==fingerprint)throw new Error('Native comment control was paused or changed');};
                            await runPostComment(pool,item.id,platform,d);await automation.certifyComment(item.id,platform,key);ran=true;break;
                        }
                        if(ran)break;
                    }
                }
                const story=status.flows.stories;
                if(story?.fingerprint){
                    await nativeStories.tick(story.fingerprint,async row=>{
                        if(!devices.some(d=>d.udid===row.device_udid)||!await automation.foregroundAllowed())throw new Error('Story phone is unavailable or paused');
                        const d=new NativeStoryDriver(AbortSignal.any([controller.signal,AbortSignal.timeout(15*60_000)]),await loadNativeStoryFlow(),path.resolve('.scheduler-data/publishing/native-story-runs',row.id));
                        d.screen.beforeInput=async()=>{if(!await automation.foregroundAllowed()||await nativeFingerprint('stories')!==story.fingerprint)throw new Error('Story control was paused or changed');};return d;
                    },!story.qualified);
                }
                return;
            }
            // All-armed mode also admits the last two days of releases for receipt and comment follow-up.
            let allowed = directReleaseAllArmed() ? (await pool.query(`SELECT item_id::text id FROM scheduler.publishing_releases
                WHERE state IN ('armed','running') OR run_at>now()-interval '48 hours'`)).rows.map((r:any)=>r.id as string) : directReleaseIds();
            // Preserve armed Instagram items while Meta restricts writes. Other platform queues keep running.
            if (await instagramWriteHold()) allowed = (await pool.query(`SELECT id FROM scheduler.publishing_items WHERE id=ANY($1::uuid[])
                AND NOT (input->'targets' @> '[{"platform":"instagram"}]')`, [allowed])).rows.map((r:any) => r.id as string);
            if (!allowed.length) { await health.tick({controlMode:'wda',state:'blocked',blockers:['Direct posting is paused. No calendar items are selected.']}); return; }
            const devices = (await loadRegisteredDevices()).filter(d => !d.disabled);
            const states = await Promise.all(devices.map(async d =>
                [d.udid, await nativeDriverStatus(`http://127.0.0.1:${d.wdaLocalPort ?? 8100}`, controller.signal)] as const));
            const readiness = new Map(states.map(([id,status])=>[id,status.ready]));
            if (![...readiness.values()].some(Boolean)) {
                await health.tick({controlMode:'wda',state:'blocked',blockers:states.length?[...new Set(states.map(([,status])=>status.reason))]:['No enabled iPhone is registered.']});
                return;
            }
            await health.tick({controlMode:'wda',state:'running',blockers:[]});
            const stale = await store.recoverStale();
            if (stale.length) console.error(new Date().toISOString(), 'recovered stalled releases with no Share claim:', stale.join(','));
            const driverFor = async (item: any, timeoutMs = 25*60000) => {
                progress();
                const releaseSignal=AbortSignal.any([controller.signal,AbortSignal.timeout(timeoutMs)]);
                const device = (await loadRegisteredDevices()).find(d => d.udid === item.input.deviceUdid);
                if (!device || device.disabled) throw new Error('Phone is not enabled');
                if (!readiness.get(device.udid)) throw new Error('Native phone driver is unavailable');
                if (device.coordinateProfile !== 'iphone15promax') throw new Error('Release controls are mapped only for iPhone 15 Pro Max');
                if(!item.results?.preparedNative&&!item.input.targets.some((t:any)=>t.platform==='youtube'))await new NativeMuteGuard(`http://127.0.0.1:${device.wdaLocalPort ?? 8100}`,releaseSignal).prepare();
                if(item.results?.preparedNative?.kind==='youtube')return new PreparedYouTubeRelease(`http://127.0.0.1:${device.wdaLocalPort ?? 8100}`,releaseSignal,item);
                if(item.input.targets.length===1&&item.input.targets[0].platform==='youtube')return new YouTubeRelease(`http://127.0.0.1:${device.wdaLocalPort ?? 8100}`,releaseSignal,item,directImports);
                if(item.results?.preparedNative?.kind==='tiktok') return new PreparedTikTokRelease(`http://127.0.0.1:${device.wdaLocalPort ?? 8100}`,releaseSignal,item);
                if (item.input.targets.length === 1 && item.input.targets[0].platform === 'tiktok')
                {
                    // A hook variant may reuse a caption another video of ours already posted (Antonio, Oct 8: post everything).
                    const sibling=(await pool.query(`SELECT 1 FROM scheduler.publishing_items s WHERE s.id<>$1 AND s.media->>'sha256'<>$2
                      AND s.input->>'caption'=$3 AND s.input->'targets'->0->>'platform'='tiktok' AND s.status='published' LIMIT 1`,[item.id,item.media.sha256,item.input.caption])).rowCount===1;
                    return new TikTokRelease(`http://127.0.0.1:${device.wdaLocalPort ?? 8100}`, releaseSignal,directImports,sibling);
                }
                if(item.results?.preparedNative?.kind==='instagram') return new PreparedInstagramRelease(`http://127.0.0.1:${device.wdaLocalPort ?? 8100}`,releaseSignal,item);
                return new InstagramRelease(`http://127.0.0.1:${device.wdaLocalPort ?? 8100}`, releaseSignal,directImports);
            };
            // Log any step that holds a tick for more than 20 s, so a starved comment queue shows its cause.
            const timed=async(step:string,run:()=>Promise<unknown>)=>{const t=Date.now();progress();try{await run();}finally{const s=Math.round((Date.now()-t)/1000);if(s>20)console.log(new Date().toISOString(),'tick step',step,s+'s');}};
            await timed('releases',()=>store.tick(driverFor, udid => readiness.get(udid) === true, allowed));
            // Oct 17: a Story failure (vision-score outage, plan error) must never skip the receipt checks and comments below.
            await timed('stories',()=>runDirectStories(pool,AbortSignal.any([controller.signal,AbortSignal.timeout(15*60000)]))).catch(e=>console.error('Stories step:',e));
            // Up to three read-only receipt passes, ten minutes apart. Never a second Share.
            const receiptChecks=await pool.query(`SELECT item_id FROM scheduler.publishing_releases
                WHERE item_id=ANY($1::uuid[]) AND state='needs_review' AND share_claimed_at IS NOT NULL
                AND updated_at<now()-interval '10 minutes'
                AND COALESCE((result->>'receiptChecks')::int,CASE WHEN result ? 'lastReceiptCheck' THEN 1 ELSE 0 END)<3`,[allowed]);
            // Read-only receipt checks get 8 minutes, never the 25-minute posting budget (Oct 8: one held the phone 25 min).
            for (const row of receiptChecks.rows) await timed('receipt check '+row.item_id.slice(0,8),()=>store.reconcilePending((item:any)=>driverFor(item,8*60000), row.item_id));
            // One comment job per tick, after due video releases. Never delay an imminent slot.
            {
                progress();
                const candidates=await pool.query(`SELECT i.* FROM scheduler.publishing_items i
                  WHERE i.status IN ('published','needs_review') AND i.id=ANY($1::uuid[])
                  AND (i.input ? 'firstComment' OR (i.input->'targets'->0->>'platform'='youtube' AND EXISTS(SELECT 1 FROM scheduler.publishing_items s
                    WHERE s.media->>'sha256'=i.media->>'sha256' AND s.input ? 'firstComment')))
                  AND i.updated_at>now()-interval '24 hours'
                  ORDER BY i.updated_at DESC LIMIT 30`,[allowed]);
                let ran=false;
                for(const item of candidates.rows){
                    if(await directVideoDueSoon(pool,allowed,item.input.deviceUdid))continue;
                    for(const platform of ['instagram','facebook','tiktok','youtube'] as CommentPlatform[]){
                        if(directPausedCommentPlatforms().includes(platform))continue;
                        if(!item.input.targets.some((t:any)=>t.platform===platform)||!item.results?.release?.receipts?.[platform]?.verified)continue;
                        // failed_before_action posted nothing and may be retried; uncertain Instagram/Facebook comments get pin-only retries
                        // (3 times, 10 minutes apart). TikTok uncertain stays final.
                        if((await pool.query(`SELECT 1 FROM scheduler.engagement_actions WHERE claim_key=$1 AND NOT ((status='failed_before_action' OR (status='uncertain_review' AND $2))
                          AND updated_at<now()-interval '10 minutes' AND COALESCE((result->>'retries')::int,0)<3)`,[commentKey(platform,item.id),platform!=='tiktok'])).rowCount)continue;
                        const device=(await loadRegisteredDevices()).find(d=>d.udid===item.input.deviceUdid);
                        if(!device||device.disabled||device.coordinateProfile!=='iphone15promax'||!readiness.get(device.udid))continue;
                        const base=`http://127.0.0.1:${device.wdaLocalPort??8100}`;
                        const commentSignal=AbortSignal.any([controller.signal,AbortSignal.timeout(8*60_000)]);
                        const driver=platform==='instagram'?new InstagramRelease(base,commentSignal):platform==='facebook'?new FacebookComments(base,commentSignal):platform==='youtube'?new YouTubeComments(base,commentSignal,undefined):new TikTokRelease(base,commentSignal);
                        const comment=driver.commentOnPost.bind(driver);
                        driver.commentOnPost=async(input:PostingInput,text:string,claim:()=>Promise<void>,existingOnly?:boolean,postUrl?:string)=>{
                            // runPostComment already owns the phone advisory lock here.
                            await new NativeMuteGuard(base,commentSignal).prepare();
                            return comment(input,text,claim,existingOnly,postUrl);
                        };
                        // runPostComment closes the app under the phone lock. Oct 13: this reset ran here after "phone busy"
                        // too, pressing Home in the middle of whichever job held the phone.
                        await runPostComment(pool,item.id,platform,driver);
                        ran=true;break;
                    }
                    if(ran)break;
                }
            }
        } catch (error) {
            await health.tick({controlMode:phoneControlMode(),state:'blocked',blockers:['The release worker encountered an error. Check its log before resuming.']}).catch(()=>undefined);
            console.error('Release loop:', error);
        }
        finally { busy = false; }
    };
    let pending = tick();
    const timer = setInterval(() => { if (!busy) pending = tick(); }, 20_000);
    await pending;
    return { async close() { clearInterval(timer); clearInterval(watchdog); clearInterval(poolProbe); controller.abort(); await pending; } };
}
