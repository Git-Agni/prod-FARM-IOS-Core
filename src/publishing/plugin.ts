import{captureDirectStoryDraft,directStoryStatus,directStoryFingerprint}from'./wda-stories.js';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {directPublicationStatus} from './direct-policy.js';
import {nativeDriverStatus,withSupervisorReason} from './driver-health.js';
import {requestWdaService} from '../devices/wda-service-client.js';
import {dryRunMirroringItem,captureNativeStoryDraft} from './mirroring-driver.js';
import {observeOwnedReel} from './mirroring-owned-reel.js';
import {revisePendingItem} from './queue-revision.js';
import {MirroringAutomationStore,nativeFingerprint} from './mirroring-automation.js';
import {NativeStoryStore} from './mirroring-stories.js';
import { registerStoryApprovalRoutes } from './story-approval.js';
import { phoneControlMode } from '../devices/control-mode.js';
import { mirroringStatus } from '../devices/mirroring/controller.js';
import { phoneAudioStatus, recordOwnerSilenceCheck,verifiedPhoneMute } from '../devices/mirroring/audio.js';
import { publishingCadence, upcomingVideoSlots } from './cadence.js';
import { laneHours, saveLaneHours, postNow } from './lanes.js';
import { execFile } from 'node:child_process';
import { StoryScheduleStore } from './story-schedule.js';
import { StorySequenceStore } from './story-sequences.js';
import { prepareYouTubeCover } from './youtube-cover.js';
import { inspectShortsVideo } from './youtube-shorts.js';
import { storyPolicy, reviewStoryDraft } from './story-policy.js';
import { instagramPreviewTask } from './preview-task.js';
import { instagramEngageTask, ENGAGEMENT_SCHEMA } from './engage-task.js';
import { assertReleaseTargets } from './release-policy.js';
import { TimedReleaseStore } from './timed-release.js';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PhoneFarmPlugin } from '../plugin.js';
import { readiness, requestHash, validatePostingInput } from './model.js';
import { PublishingStore, publicItem, type MediaFile } from './store.js';
import { linkRelatedReel } from './related-autolink.js';
import { ReleaseWorkerStatusStore } from './worker-health.js';

export function createPublishingPlugin(): PhoneFarmPlugin {
    return {
        id: 'ai.clicktoclose.publishing', version: '0.1.0', displayName: 'Central publishing', tasks: [instagramPreviewTask, instagramEngageTask],
        navLinks: [{ label: 'Publishing', href: '/publishing', order: 5 }],
        async registerRoutes(ctx) {
            const store = new PublishingStore(ctx.scheduler.connection.pool);
            await store.initialize();
            const releaseWorker = new ReleaseWorkerStatusStore(ctx.scheduler.connection.pool);
            await releaseWorker.initialize();
            const automation=new MirroringAutomationStore(ctx.scheduler.connection.pool),nativeStories=new NativeStoryStore(ctx.scheduler.connection.pool);
            await automation.initialize();await nativeStories.initialize();
            const base = '/api/publishing';
            ctx.app.get(`${base}/automation`,async()=>({...await automation.status(),nativeStories:await nativeStories.list()}));
            ctx.app.post(`${base}/automation/pause`,async()=>{await automation.pause();return automation.status();});
            ctx.app.post(`${base}/automation/allow-foreground`,async(req,reply)=>{try{await automation.allowForeground((req.body as any)?.confirmed);return automation.status();}catch(e){return reply.code(409).send({error:e instanceof Error?e.message:String(e)});}});
            ctx.app.post(`${base}/automation/pilot`,async(req,reply)=>{try{const b=req.body as any;return await automation.requestPilot(b?.itemId,b?.version);}catch(e){return reply.code(409).send({error:e instanceof Error?e.message:String(e)});}});
            ctx.app.post(`${base}/automation/dry-run`,async(req,reply)=>{try{const b=req.body as any;if(phoneControlMode()!=='mirroring')throw new Error('Choose Mirroring mode');return await dryRunMirroringItem(ctx.scheduler.connection.pool,b?.itemId,b?.version);}catch(e){return reply.code(409).send({error:e instanceof Error?e.message:String(e)});}});
            ctx.app.post(`${base}/stories/native/dry-run`,async(req,reply)=>{try{const b=req.body as any;return phoneControlMode()==='wda'?await captureDirectStoryDraft(ctx.scheduler.connection.pool,b?.sequenceId,b?.frames):await captureNativeStoryDraft(ctx.scheduler.connection.pool,b?.sequenceId,b?.frames);}catch(e){return reply.code(409).send({error:e instanceof Error?e.message:String(e)});}});
            ctx.app.post(`${base}/stories/native`,async(req,reply)=>{try{const b=req.body as any;const row=await nativeStories.prepare(b?.sequenceId,b?.frames,phoneControlMode()==='wda'?await directStoryFingerprint():await nativeFingerprint('stories'));return {id:row.id,revision:row.revision,state:row.state,previewUrls:[1,2,3,4,5].map(n=>`${base}/stories/native/${row.id}/frames/${n}`)};}catch(e){return reply.code(409).send({error:e instanceof Error?e.message:String(e)});}});
            ctx.app.post(`${base}/automation/owned-reels`,async(req,reply)=>{try{return await automation.registerOwnedReel(req.body);}catch(e){return reply.code(409).send({error:e instanceof Error?e.message:String(e)});}});
            ctx.app.post(`${base}/automation/owned-reels/observe`,async(req,reply)=>{try{if(phoneControlMode()!=='mirroring')throw new Error('Choose Mirroring mode');const b=req.body as any;return await observeOwnedReel(ctx.scheduler.connection.pool,b?.sourceItemId,b?.anchorItemId);}catch(e){return reply.code(409).send({error:e instanceof Error?e.message:String(e)});}});
            ctx.app.post(`${base}/stories/native/:id/approve`,async(req,reply)=>{try{const b=req.body as any;await nativeStories.approve((req.params as any).id,b?.revision,b?.reviewedFrames,b?.confirmed);return {state:'armed',publicationNeedsQualifiedFlow:true};}catch(e){return reply.code(409).send({error:e instanceof Error?e.message:String(e)});}});
            ctx.app.get(`${base}/stories/native/:id/frames/:frame`,async(req,reply)=>{try{const p=req.params as any;return reply.type('image/png').send(await nativeStories.preview(p.id,Number(p.frame)));}catch(e){return reply.code(404).send({error:e instanceof Error?e.message:String(e)});}});
            ctx.app.post(`${base}/stories/native/:id/pilot`,async(req,reply)=>{try{if(phoneControlMode()==='mirroring'&&!await automation.foregroundAllowed())throw new Error('Phone control is paused');await nativeStories.requestPilot((req.params as any).id);return {state:'pilot_pending'};}catch(e){return reply.code(409).send({error:e instanceof Error?e.message:String(e)});}});

            ctx.app.get(`${base}/control`, async () => {
                const mode=phoneControlMode(),a=await automation.status();
                const mirroring=mode==='mirroring'?await mirroringStatus():null,audio=mode==='mirroring'?await phoneAudioStatus():null;
                return {mode,...(mode==='mirroring'?{mirroring,audio}:{}),automation:a,
                    automatedMirroringPublication:mode==='mirroring'&&a.foregroundAllowed&&mirroring?.controlReady===true&&verifiedPhoneMute(audio)&&Object.values(a.flows).some((f:any)=>f.qualified)};
            });
            ctx.app.post(`${base}/audio/confirm-silence`,async(req,reply)=>{
                if(phoneControlMode()!=='mirroring'||!(await mirroringStatus()).controlReady)
                    return reply.code(409).send({error:'Connect the locked iPhone before confirming the silence check.'});
                try {return {audio:await recordOwnerSilenceCheck(req.body),publicationEnabled:false};}
                catch(error){return reply.code(409).send({error:error instanceof Error?error.message:String(error)});}
            });
            const stories = new StoryScheduleStore(ctx.scheduler.connection.pool);
            await stories.initialize();
            await registerStoryApprovalRoutes(ctx, ctx.scheduler.connection.pool);
            ctx.app.get(`${base}/stories/schedule`, async () => {
                const status=await stories.status(),a=await automation.status();
                const control=phoneControlMode()==='mirroring'?await mirroringStatus():null,audio=phoneControlMode()==='mirroring'?await phoneAudioStatus():null;
                const direct=phoneControlMode()==='wda'?await directStoryStatus(ctx.scheduler.connection.pool):null;
                const ready=direct?direct.qualified:a.foregroundAllowed&&control?.controlReady===true&&verifiedPhoneMute(audio)&&a.flows.stories.qualified;
                return {...status,publicationEnabled:ready,unattendedPilotVerified:direct?.qualified??a.flows.stories.qualified,...(direct?{direct}:{}),blockers:ready?['Each exact native sequence still needs owner approval.']:['Native Story controls and a verified worker pilot are required.','Approve all five actual frames for each new sequence.']};
            });
            // Autopilot controls (Oct 15): lane hours and Post now. The hourly lane-slotter.ts owns every armed post's time.
            ctx.app.get(`${base}/lanes`, async () => {
                const upcoming=(await ctx.scheduler.connection.pool.query(`SELECT i.id,i.media->>'name' AS name,r.run_at,(i.results ? 'repost') AS repost,
                  (SELECT array_agg(t->>'platform') FROM jsonb_array_elements(i.input->'targets') t) AS platforms
                  FROM scheduler.publishing_releases r JOIN scheduler.publishing_items i ON i.id=r.item_id
                  WHERE r.state='armed' AND r.share_claimed_at IS NULL AND r.run_at<now()+interval '48 hours' ORDER BY r.run_at`)).rows;
                return {hours:laneHours(),upcoming};
            });
            ctx.app.post(`${base}/lanes`, async (req, reply) => {
                try{
                    const hours=saveLaneHours((req.body as any)?.hours);
                    const root=fileURLToPath(new URL('../../',import.meta.url));
                    const out=await new Promise<string>((ok)=>execFile(process.execPath,['--env-file-if-exists=.env','--import','tsx','scripts/lane-slotter.ts','--apply'],{cwd:root,timeout:120000},(e,so,se)=>ok(String(so||se||e?.message||'').trim().split('\n').pop()??'')));
                    return {hours,slotter:out};
                }catch(e){return reply.code(400).send({error:e instanceof Error?e.message:String(e)});}
            });
            ctx.app.post(`${base}/post-now`, async (req, reply) => {
                try{return await postNow(ctx.scheduler.connection.pool,(req.body as any)?.itemId||undefined);}
                catch(e){return reply.code(409).send({error:e instanceof Error?e.message:String(e)});}
            });
            ctx.app.get(`${base}/cadence`, async () => {
                const status = await stories.status();
                const releaseStatus = await releaseWorker.status();
                const controlMode = phoneControlMode();
                const enabledDevices = controlMode === 'wda' ? (await ctx.loadDevices()).filter(d => !d.disabled) : [];
                const drivers = await Promise.all(enabledDevices.map(async d =>
                    (await nativeDriverStatus(`http://127.0.0.1:${d.wdaLocalPort ?? 8100}`,AbortSignal.timeout(7000))).ready));
                const nativeState=controlMode==='mirroring'?await automation.status():null;
                const mirror=controlMode==='mirroring'?await mirroringStatus():null;
                const audio=controlMode==='mirroring'?await phoneAudioStatus():null;
                const nativeDriverReady = controlMode==='mirroring'?!!mirror?.controlReady&&verifiedPhoneMute(audio)&&!!nativeState?.foregroundAllowed&&Object.values(nativeState.flows).some((f:any)=>f.qualified):drivers.length > 0 && drivers.every(Boolean);
                return { ...publishingCadence,
                    upcomingVideoSlots: upcomingVideoSlots().map(d => d.toISOString()),
                    runtime: {...status.worker,controlMode,nativeDriverReady,releaseWorker:releaseStatus,
                        automaticPostingRequested:releaseStatus.automaticPostingRequested,
                        videoPostingRunning:status.worker.healthy && status.worker.mode==='publishing'
                            && nativeDriverReady && releaseStatus.videoPostingRunning && releaseStatus.controlMode===controlMode},
                    ...(controlMode === 'mirroring' ? {mirroring:mirror,audio,automation:nativeState} : {}),
                    publicationRequires: ['Reviewed content', 'Armed release', 'Running native driver and release worker'],
                    youtubePublicationEnabled: !!mirror?.controlReady&&verifiedPhoneMute(audio)&&!!nativeState?.foregroundAllowed&&!!nativeState?.flows.youtube.qualified, storyPublicationEnabled: !!mirror?.controlReady&&verifiedPhoneMute(audio)&&!!nativeState?.foregroundAllowed&&!!nativeState?.flows.stories.qualified,
                };
            });
            ctx.app.post<{Params:{id:string};Body:{updatedAt:string;runAt:string}}>(`${base}/stories/sequences/:id/reschedule`,async(req,reply)=>{
                try{return await new StorySequenceStore(ctx.scheduler.connection.pool).reschedule(req.params.id,req.body?.updatedAt,req.body?.runAt);}
                catch(error){return reply.code(409).send({error:error instanceof Error?error.message:String(error)});}
            });
            ctx.app.post(`${base}/stories/sequences`, async (req, reply) => {
                try {
                    const udid = (req.body as any)?.deviceUdid;
                    if (!(await ctx.loadDevices()).some(d => d.udid === udid && !d.disabled)) return reply.code(422).send({error:'Choose an enabled registered phone'});
                    return reply.code(201).send(await new StorySequenceStore(ctx.scheduler.connection.pool).save(req.body));
                } catch (error) { return reply.code(409).send({error:error instanceof Error ? error.message : String(error)}); }
            });
            ctx.app.get(`${base}/stories/policy`, async () => storyPolicy);
            ctx.app.post(`${base}/stories/review`, async (req, reply) => {
                const review = reviewStoryDraft(req.body);
                return reply.code(review.valid ? 200 : 422).send(review);
            });
            ctx.app.get('/publishing', async (_req, reply) => reply.type('text/html').header('Cache-Control', 'no-cache').send(await readFile(fileURLToPath(new URL('../../static/publishing/index.html', import.meta.url)), 'utf8')));
            ctx.app.get('/publishing/app.js', async (_req, reply) => reply.type('application/javascript').header('Cache-Control', 'no-cache').send(await readFile(fileURLToPath(new URL('../../static/publishing/app.js', import.meta.url)), 'utf8')));
            ctx.app.get('/publishing/groups.mjs', async (_req, reply) => reply.type('application/javascript').header('Cache-Control', 'no-cache').send(await readFile(fileURLToPath(new URL('../../static/publishing/groups.mjs', import.meta.url)), 'utf8')));
            ctx.app.get('/publishing/styles.css', async (_req, reply) => reply.type('text/css').header('Cache-Control', 'no-cache').send(await readFile(fileURLToPath(new URL('../../static/publishing/styles.css', import.meta.url)), 'utf8')));
            // Draft studio is read-only on the server and has no publishing or phone actions.
            for (const [route, file, mime] of [
                ['/publishing/stories', 'index.html', 'text/html'],
                ['/publishing/stories/history', 'history.html', 'text/html'],
                ['/publishing/stories/style.css', 'style.css', 'text/css'],
                ['/publishing/stories/editor.js', 'editor.js', 'application/javascript'],
                ['/publishing/stories/roadmap-v1', 'roadmap-v1/index.html', 'text/html'],
                ['/publishing/stories/roadmap-v1/moment.jpg', 'roadmap-v1/moment.jpg', 'image/jpeg'],
                ['/publishing/stories/roadmap-v1/work.jpg', 'roadmap-v1/work.jpg', 'image/jpeg'],
                ['/publishing/stories/roadmap-v1/reel.jpg', 'roadmap-v1/reel.jpg', 'image/jpeg'],
                ['/publishing/stories/roadmap-v1/closing.jpg', 'roadmap-v1/closing.jpg', 'image/jpeg'],
                ['/publishing/stories/nora-v2/preview.mp4', 'nora-v2/preview.mp4', 'video/mp4'],
                ['/publishing/stories/nora-v2/frame-1.jpg', 'nora-v2/frame-1.jpg', 'image/jpeg'],
                ['/publishing/stories/nora-v2/frame-2.jpg', 'nora-v2/frame-2.jpg', 'image/jpeg'],
                ['/publishing/stories/nora-v2/frame-3.jpg', 'nora-v2/frame-3.jpg', 'image/jpeg'],
                ['/publishing/stories/nora-v2/frame-4.jpg', 'nora-v2/frame-4.jpg', 'image/jpeg'],
                ['/publishing/stories/nora-v2/frame-5.jpg', 'nora-v2/frame-5.jpg', 'image/jpeg'],
                ['/publishing/stories/calendar.png', 'calendar.png', 'image/png'],
                ['/publishing/stories/oct1-frame-3.png', 'oct1-frame-3.png', 'image/png'],
                ['/publishing/stories/oct1-frame-4.png', 'oct1-frame-4.png', 'image/png'],
                ['/publishing/stories/oct1-frame-5.png', 'oct1-frame-5.png', 'image/png'],
                ['/publishing/stories/native-draft.png', 'native-draft.png', 'image/png'],
                ['/publishing/stories/sequence-1.png', 'sequence-1.png', 'image/png'],
                ['/publishing/stories/sequence-2.png', 'sequence-2.png', 'image/png'],
                ['/publishing/stories/sequence-3.png', 'sequence-3.png', 'image/png'],
                ['/publishing/stories/sequence-4.png', 'sequence-4.png', 'image/png'],
                ['/publishing/stories/sequence-5.png', 'sequence-5.png', 'image/png'],
            ]) ctx.app.get(route!, async (_req, reply) => reply.type(mime!).header('Cache-Control', 'no-cache').send(await readFile(fileURLToPath(new URL(`../../static/publishing/stories/${file}`, import.meta.url)))));
            const releases = new TimedReleaseStore(ctx.scheduler.connection.pool);
            await releases.initialize();
            await ctx.scheduler.connection.pool.query(ENGAGEMENT_SCHEMA);
            // Read-only views for the calendar: timed releases and after-publish pin/Story results.
            // Arm one held item for its target time. The worker's release loop posts it once; disarm while still armed.
            ctx.app.post<{ Params: { id: string }; Body: { version: number } }>(`${base}/items/:id/arm`, async (req, reply) => {
                if (!/^[0-9a-f-]{36}$/.test(req.params.id) || !Number.isInteger(req.body?.version)) return reply.code(400).send({ error: 'Item ID and current version are required' });
                const item = await store.get(req.params.id);
                if (!item || item.status !== 'held' || item.version !== req.body.version) return reply.code(409).send({ error: 'Item changed or is not on hold' });
                const a=await automation.status();
                // Direct mode: a Short may be armed once its frame-zero cover review exists; the worker still runs native checks.
                const reviewedShort=phoneControlMode()==='wda'&&item.results?.directYouTubeReview?.coverReviewed===true&&item.results.directYouTubeReview.sourceSha256===item.media.sha256;
                const releaseOptions={nativeYouTubeLayout:(phoneControlMode()==='mirroring'&&!!a.flows.youtube.layoutAvailable)||reviewedShort};
                try { assertReleaseTargets(item.input,releaseOptions); } catch(error) { return reply.code(409).send({error:error instanceof Error?error.message:String(error)}); }
                if (item.input.targets.some((t: {platform:string}) => t.platform === 'tiktok') && !readiness.tiktok.ready) return reply.code(409).send({ error: readiness.tiktok.reason });
                if (item.cover && !(item.input.youtube&&item.results?.youtubeCover)) return reply.code(409).send({ error: 'Custom covers are not supported; the cover is a frame of the video' });
                try { await releases.arm(item.id, item.version,releaseOptions); } catch (error) { return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) }); }
                return reply.code(201).send({ itemId: item.id, state: 'armed', runAt: item.input.runAt });
            });
            ctx.app.post<{ Params: { id: string } }>(`${base}/items/:id/disarm`, async (req, reply) => {
                if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return reply.code(400).send({ error: 'Invalid item ID' });
                return (await releases.cancel(req.params.id)) ? { itemId: req.params.id, state: 'cancelled' } : reply.code(409).send({ error: 'Only an armed release can be disarmed' });
            });
            ctx.app.get(`${base}/releases`, async () => ({ releases: (await ctx.scheduler.connection.pool.query(
                `SELECT item_id, item_version, run_at, state, share_claimed_at, result, updated_at FROM scheduler.publishing_releases ORDER BY run_at DESC LIMIT 500`)).rows }));
            ctx.app.get(`${base}/engagements`, async () => ({ engagements: (await ctx.scheduler.connection.pool.query(
                `SELECT claim_key, action, post_url, status, result, execution_id, created_at, updated_at FROM scheduler.engagement_actions ORDER BY updated_at DESC LIMIT 500`)).rows }));
            // Oct 26 health strip: everything Antonio needs to run the Phone Farm without asking Claude.
            ctx.app.get(`${base}/health`,async()=>{
                const pool=ctx.scheduler.connection.pool,root=process.cwd();
                let captions:any=null;
                try{captions=JSON.parse(await readFile(join(root,'.scheduler-data/caption-block/latest.json'),'utf8'));delete captions.pairs;}catch{/* monitor has not run */}
                const lanes=laneHours();
                const armed=(await pool.query(`SELECT CASE WHEN i.input->'targets' @> '[{"platform":"youtube"}]' THEN 'youtube' WHEN i.input->'targets' @> '[{"platform":"tiktok"}]' THEN 'tiktok' ELSE 'instagram' END lane, count(*)::int n
                    FROM scheduler.publishing_releases r JOIN scheduler.publishing_items i ON i.id=r.item_id
                    WHERE r.state='armed' AND r.run_at BETWEEN now() AND now()+interval '24 hours' GROUP BY 1`)).rows;
                const supply=(['instagram','tiktok','youtube'] as const).map(lane=>({lane,armed24h:armed.find((r:any)=>r.lane===lane)?.n??0,target:lanes[lane].length}));
                const pins=(await pool.query(`SELECT status, count(*)::int n FROM scheduler.engagement_actions WHERE updated_at>now()-interval '72 hours' GROUP BY 1`)).rows;
                const rearmable=(await pool.query(`SELECT count(*)::int n FROM scheduler.publishing_releases WHERE state='needs_review' AND share_claimed_at IS NULL AND run_at>now()-interval '7 days'`)).rows[0].n;
                let services:{name:string;running:boolean}[]=[];
                try{services=(await promisify(execFile)('launchctl',['list'])).stdout.split('\n').filter(l=>l.includes('ai.clicktoclose.phone-farm.'))
                    .map(l=>{const [pid,,label]=l.trim().split(/\s+/);return {name:label!.replace('ai.clicktoclose.phone-farm.',''),running:pid!=='-'};});}catch{/* not on macOS */}
                return {checkedAt:new Date().toISOString(),captions,supply,pins,rearmable,services};
            });
            // Re-arm a post that stopped before Share (missed window, failed preflight). Never one with a Share attempt.
            ctx.app.post(`${base}/items/:id/rearm`,async(req,reply)=>{
                const id=(req.params as any).id;if(!/^[0-9a-f-]{36}$/.test(id))return reply.code(400).send({error:'Invalid item ID'});
                const r=await ctx.scheduler.connection.pool.query(`UPDATE scheduler.publishing_releases r SET state='armed',result='{}'::jsonb,run_at=now()+interval '3 days',updated_at=now(),
                    item_version=(SELECT version FROM scheduler.publishing_items WHERE id=r.item_id)
                    WHERE item_id=$1 AND state='needs_review' AND share_claimed_at IS NULL RETURNING item_id`,[id]);
                if(!r.rowCount)return reply.code(409).send({error:'Only a needs-review post with no Share attempt can be re-armed'});
                // The lane slotter moves it into the next free slot in its lane.
                await promisify(execFile)(process.execPath,['--env-file-if-exists=.env','--import','tsx','scripts/lane-slotter.ts','--apply'],{cwd:process.cwd(),timeout:120_000});
                const after=(await ctx.scheduler.connection.pool.query(`SELECT run_at,state FROM scheduler.publishing_releases WHERE item_id=$1`,[id])).rows[0];
                return {itemId:id,state:after.state,runAt:after.run_at};
            });
            ctx.app.get(`${base}/capabilities`,async()=>{
                const mirrorMode=phoneControlMode()==='mirroring';
                const a=await automation.status();
                const audio=mirrorMode?await phoneAudioStatus():null;
                const control=mirrorMode?await mirroringStatus():null;
                const direct=directPublicationStatus();
                let supervisors:Array<{udid:string;wda:string;message:string}>=[];
                if(!mirrorMode)try{const response=await requestWdaService('/devices');if(response.statusCode===200)supervisors=JSON.parse(response.body).devices??[];}catch{/* Native checks remain authoritative. */}
                const directPhones=mirrorMode?[]:await Promise.all((await ctx.loadDevices()).filter(d=>!d.disabled).map(async d=>({udid:d.udid,...withSupervisorReason(await nativeDriverStatus(`http://127.0.0.1:${d.wdaLocalPort??8100}`,AbortSignal.timeout(7000)),supervisors.find(s=>s.udid===d.udid))})));
                const directStories=mirrorMode?null:await directStoryStatus(ctx.scheduler.connection.pool);
                const directReady=direct.enabled&&directPhones.some(d=>d.ready);
                const directPlatforms=Object.fromEntries(Object.entries(readiness).map(([platform,capability])=>[platform,{
                    // Oct 26: all four lanes post live on timed releases with native receipts; "not ready" was old pilot text.
                    ...capability,ready:directReady,
                    reason:!direct.enabled?direct.reason:!directReady?(directPhones[0]?.reason??'No enabled iPhone is registered.'):platform==='youtube'?'Live: armed Shorts upload natively at their time and are checked on the public feed.':platform==='instagram'||platform==='facebook'?'Live: armed Trial Reels post natively with linked Facebook sharing, then a Graph receipt check.':capability.reason,
                }]));
                const ready=(group:string)=>mirrorMode&&a.foregroundAllowed&&control?.controlReady===true&&verifiedPhoneMute(audio)&&a.flows[group]?.qualified===true;
                return {version:1,mode:'timed_release',controlMode:phoneControlMode(),...(mirrorMode?{audio,automation:a}:{direct:{...direct,phones:directPhones}}),
                    platforms:mirrorMode?Object.fromEntries(Object.entries(readiness).map(([platform,capability])=>[platform,{...capability,codeImplemented:true,layoutAvailable:a.flows[platform==='instagram'||platform==='facebook'?'instagram_facebook':platform]?.layoutAvailable===true,ready:ready(platform==='instagram'||platform==='facebook'?'instagram_facebook':platform),reason:!a.foregroundAllowed?a.reason:'A current native layout and worker pilot receipt are required.'}])):directPlatforms,
                    comments:Object.fromEntries(['instagram','facebook','tiktok'].map(platform=>[platform,{post:ready(platform==='tiktok'?'tiktok':'instagram_facebook')&&a.comments[platform]?.qualified===true,pin:platform!=='tiktok'&&ready('instagram_facebook')&&a.comments[platform]?.qualified===true,reason:a.comments[platform]?.qualified?'Native worker comment receipt verified.':'Native comment layouts and worker receipts still need tests.'}])),
                    publicationEnabled:mirrorMode?['instagram_facebook','tiktok','youtube','stories'].some(ready):directReady,
                    releaseRequiresArming:true,instagramPreviewAvailable:!mirrorMode,youtube:ready('youtube')?'native_release':'preparation_only',
                    storyPublicationEnabled:mirrorMode?ready('stories'):directStories?.qualified===true,stories:directStories,quickTimeRequired:false,
                    facebookPolicy:'Use native linked sharing when requested. Never silently create a separate Facebook upload.',
                    instructions:'Upload reviewed content to the calendar. Held items do not publish. Keep requestId stable when retrying the same upload.'};
            });
            ctx.app.get<{ Querystring: { offset?: string; limit?: string } }>(`${base}/items`, async (req) => {
                const limit = Math.min(100, Math.max(1, Math.floor(Number(req.query.limit) || 50)));
                const offset = Number.isSafeInteger(Number(req.query.offset)) ? Math.max(0, Number(req.query.offset)) : 0;
                const rows = await store.list(limit + 1, offset);
                return { items: rows.slice(0,limit).map(publicItem), nextOffset: rows.length > limit ? offset + limit : null };
            });
            ctx.app.get<{ Params: { id: string } }>(`${base}/items/:id`, async (req, reply) => {
                if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return reply.code(400).send({ error: 'Invalid item ID' });
                const item = await store.get(req.params.id);
                return item ? publicItem(item) : reply.code(404).send({ error: 'Post not found' });
            });
            ctx.app.post(`${base}/items/:id/revise`,async(req,reply)=>{
                try{
                    const b=req.body as any,p=req.params as any;
                    return publicItem(await revisePendingItem(ctx.scheduler.connection.pool,p.id,b?.version,b?.runAt,
                        b?.instagramRelatedReel,(url,caption)=>automation.ownedReel(url,caption)));
                }catch(error){return reply.code(409).send({error:error instanceof Error?error.message:String(error)});}
            });
            ctx.app.get<{ Params: { id: string; kind: string } }>(`${base}/items/:id/media/:kind`, async (req, reply) => {
                if (!/^[0-9a-f-]{36}$/.test(req.params.id) || !['video','cover'].includes(req.params.kind)) return reply.code(400).send({ error: 'Invalid media request' });
                const item = await store.get(req.params.id);
                const file = req.params.kind === 'video' ? item?.media : item?.cover;
                if (!file) return reply.code(404).send({ error: 'Media not found' });
                const size = (await stat(file.path)).size;
                reply.header('Accept-Ranges','bytes').header('X-Content-Type-Options','nosniff').type(file.mimeType);
                const range = req.headers.range;
                if (range) {
                    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
                    const start = match ? Number(match[1]) : NaN;
                    const end = match?.[2] ? Math.min(Number(match[2]),size-1) : size-1;
                    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return reply.code(416).header('Content-Range',`bytes */${size}`).send();
                    return reply.code(206).header('Content-Range',`bytes ${start}-${end}/${size}`).header('Content-Length',end-start+1).send(createReadStream(file.path,{start,end}));
                }
                return reply.header('Content-Length',size).send(createReadStream(file.path));
            });
            ctx.app.post(`${base}/items`, async (req, reply) => {
                const root = path.resolve(process.env.SCHEDULER_DATA_DIR ?? '.scheduler-data', 'publishing');
                await mkdir(root, { recursive: true, mode: 0o700 });
                const directory = await mkdtemp(path.join(root, 'upload-'));
                let keep = false;
                try {
                    const fields = new Map<string, string>();
                    const files = new Map<string, MediaFile>();
                    for await (const part of req.parts({ limits: { files: 2, fileSize: 350 * 1024 * 1024, fields: 1 } })) {
                        if (part.type === 'field') {
                            if (part.fieldname !== 'input' || fields.has('input') || part.valueTruncated) throw new Error('Send one input JSON field');
                            fields.set('input', String(part.value)); continue;
                        }
                        if (!['video','cover'].includes(part.fieldname) || files.has(part.fieldname)) throw new Error('Upload one video and an optional cover');
                        const mimeType = part.mimetype;
                        if (part.fieldname === 'video' && !['video/mp4','video/quicktime'].includes(mimeType)) throw new Error('Use an MP4 or MOV video');
                        if (part.fieldname === 'cover' && !['image/jpeg','image/png'].includes(mimeType)) throw new Error('Use a JPEG or PNG cover');
                        const name = path.basename(part.filename).replace(/[^A-Za-z0-9._-]/g,'_').slice(0,160) || part.fieldname;
                        const filePath = path.join(directory, `${part.fieldname}-${name}`);
                        const hash = createHash('sha256');
                        part.file.on('data', chunk => hash.update(chunk));
                        await pipeline(part.file, createWriteStream(filePath, { flags: 'wx', mode: 0o600 }));
                        if (part.file.truncated) throw new Error('The file exceeds 350 MiB');
                        const size = (await stat(filePath)).size;
                        if (size === 0) throw new Error('The uploaded file is empty');
                        files.set(part.fieldname, { path: filePath, name, mimeType, size, sha256: hash.digest('hex') });
                    }
                    const input = validatePostingInput(JSON.parse(fields.get('input') ?? 'null'));
                    const device = (await ctx.loadDevices()).find(d => d.udid === input.deviceUdid);
                    if (!device || device.disabled) throw new Error('Choose an enabled, registered phone');
                    const video = files.get('video');
                    if (!video) throw new Error('Upload a video');
                    const cover = files.get('cover');
                    let results = {};
                    let preparedVideo = video;
                    if (input.youtube) {
                        const coverMode = input.youtube.publishing?.coverMode;
                        if (cover && coverMode !== 'replace_first_frame') throw new Error('Choose Replace first frame to prepare a YouTube cover');
                        if (!cover && coverMode === 'replace_first_frame') throw new Error('Upload a cover image for first-frame preparation');
                        results = { youtubePreparation: { ...(await inspectShortsVideo(video.path)), checkedAt: new Date().toISOString(), status: 'media_validated', uploaded: false, published: false, nativeChannelVerified: false } };
                    }
                    if (input.youtube && cover) {
                        const prepared = await prepareYouTubeCover(video.path, cover.path, directory);
                        preparedVideo = prepared.media;
                        results = { ...results, youtubeCover: prepared.receipt, sourceVideo: video };
                    }
                    // Instagram posts get their topic-matched related Reel now, so the calendar shows it before arming.
                    const linked = await linkRelatedReel(input, preparedVideo);
                    if (linked) results = { ...results, relatedReel: linked.choice };
                    const saved = await store.create(linked?.input ?? input, requestHash(linked?.input ?? input, video.sha256, cover?.sha256), preparedVideo, cover, results);
                    keep = !saved.replayed;
                    return reply.code(saved.replayed ? 200 : 201).send({ ...publicItem(saved.item), replayed: saved.replayed });
                } catch (error) {
                    return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
                } finally { if (!keep) await rm(directory, { recursive: true, force: true }); }
            });
            ctx.app.post<{ Params: { id: string }; Body: { version: number } }>(`${base}/items/:id/cancel`, async (req, reply) => {
                if (!/^[0-9a-f-]{36}$/.test(req.params.id) || !Number.isInteger(req.body?.version)) return reply.code(400).send({ error: 'Item ID and current version are required' });
                const item = await store.cancel(req.params.id,req.body.version);
                if (item) await releases.cancel(req.params.id);   // a cancelled post must never keep an armed release
                return item ? publicItem(item) : reply.code(409).send({ error: 'Post changed or cannot be cancelled. Refresh it first.' });
            });
            ctx.app.post<{ Params: { id: string }; Body: { version: number } }>(`${base}/items/:id/preview`, async (req, reply) => {
                if (!/^[0-9a-f-]{36}$/.test(req.params.id) || !Number.isInteger(req.body?.version)) return reply.code(400).send({error:'Item ID and current version are required'});
                const client = await ctx.scheduler.connection.pool.connect();
                let locked = false;
                try {
                    locked = (await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',['preview-request:'+req.params.id])).rows[0].locked;
                    if (!locked) return reply.code(409).send({error:'A preview request is already being prepared'});
                    const item = await store.get(req.params.id);
                    if (!item || item.status !== 'held' || item.version !== req.body.version) return reply.code(409).send({error:'Item changed or is not on hold'});
                    if (item.results.previewScheduleId) return {scheduleId:item.results.previewScheduleId,replayed:true};
                    const device = (await ctx.loadDevices()).find(d=>d.udid===item.input.deviceUdid);
                    if (!device || device.disabled) throw new Error('Phone is not enabled');
                    if (device.coordinateProfile !== 'iphone15promax') throw new Error('Preview controls are verified only on iPhone 15 Pro Max');
                    if (!item.input.targets.some((t: {platform:string})=>t.platform==='instagram')) throw new Error('Choose Instagram for this preview');
                    if (item.cover) throw new Error('Custom cover selection still needs calibration');
                    if (await ctx.scheduler.activeExecution(device.udid)) throw new Error('The phone already has queued or running work');
                    const root = path.resolve(process.env.SCHEDULER_DATA_DIR ?? '.scheduler-data');
                    await mkdir(path.join(root,'assets'),{recursive:true});
                    const dir = await mkdtemp(path.join(root,'assets','ig-preview-'));
                    const file = path.join(dir,'video.mp4');
                    let assets: Array<{id:string}> = [];
                    let scheduled = false;
                    try {
                        await copyFile(item.media.path,file);
                        assets = await ctx.scheduler.registerAssets([{relativePath:path.relative(root,file),originalName:item.media.name,mimeType:item.media.mimeType,size:item.media.size,sha256:item.media.sha256}]);
                        const schedule = await ctx.scheduler.createTask({deviceUdid:device.udid,task:{pluginId:'ai.clicktoclose.publishing',taskType:'instagram-preview',taskVersion:1,payload:{itemId:item.id,version:item.version}},timing:{kind:'now'},runWindowMinutes:10},{},new Date(),assets.map(a=>a.id));
                        scheduled = true;
                        await client.query("UPDATE scheduler.publishing_items SET results=jsonb_set(results,'{previewScheduleId}',$2::jsonb),updated_at=now() WHERE id=$1",[item.id,JSON.stringify(schedule.id)]);
                        return reply.code(202).send({scheduleId:schedule.id,replayed:false,published:false});
                    } finally {
                        if(!scheduled) { if(assets.length) await ctx.scheduler.deleteAssets(assets.map(a=>a.id));await rm(dir,{recursive:true,force:true}); }
                    }
                } catch(error) {return reply.code(409).send({error:error instanceof Error ? error.message : String(error)});}
                finally {if(locked)await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',['preview-request:'+req.params.id]);client.release();}
            });
            ctx.app.post(`${base}/items/:id/publish`, async (_req, reply) => reply.code(409).send({
                error: 'Publication is not enabled. The native posting and verification flows still need testing.', readiness,
            }));
        },
    };
}
