import {NativeStoryStore,NativeStoryDriver,loadNativeStoryFlow,nativeStoryRevision,type NativeStoryFrame} from './mirroring-stories.js';
import {loadRegisteredDevices} from '../devices/registry.js';
import type {Pool} from 'pg';
import path from 'node:path';
import {MirroringAutomationStore,nativeGroup,nativeFingerprint,loadNativeVideoFlow} from './mirroring-automation.js';
import {MirroringMediaStore} from './mirroring-media-store.js';
import {MirroringInstagramRelease} from './mirroring-release.js';
import {MirroringFlowRelease} from './mirroring-flow.js';
export async function createMirroringDriver(pool:Pool,item:any,signal:AbortSignal){
    const automation=new MirroringAutomationStore(pool),imports=new MirroringMediaStore(pool);
    if(!await automation.foregroundAllowed())throw new Error('Phone control is paused');
    const group=nativeGroup(item.input),fingerprint=await nativeFingerprint(group);
    const root=path.resolve('.scheduler-data/publishing/native-runs',item.id+'-'+Date.now());
    const driver=group==='instagram_facebook'
        ?new MirroringInstagramRelease(signal,root,(url,caption)=>automation.ownedReel(url,caption),imports.forPhone(item.input.deviceUdid),item.media)
        :new MirroringFlowRelease(signal,await loadNativeVideoFlow(group as 'tiktok'|'youtube'),root,imports.forPhone(item.input.deviceUdid),item.media);
    driver.nativeFlowFingerprint=fingerprint;
    driver.screen.beforeInput=async()=>{
        if(!await automation.foregroundAllowed())throw new Error('Phone control was paused; no input was sent');
        if(await nativeFingerprint(group)!==fingerprint)throw new Error('Native code or layout changed. Stop and restart the worker');
    };
    return driver;
}
/** Explicit foreground dry run. It has no submission path and leaves every Share claim intact. */
export async function dryRunMirroringItem(pool:Pool,id:string,version:number){
    const c=await pool.connect();let phone='';let locked=false;let driver:Awaited<ReturnType<typeof createMirroringDriver>>|undefined;
    try{
        const item=(await c.query('SELECT i.*,r.share_claimed_at FROM scheduler.publishing_items i LEFT JOIN scheduler.publishing_releases r ON r.item_id=i.id WHERE i.id=$1',[id])).rows[0];
        if(!item||item.version!==version||item.status!=='held'||item.share_claimed_at)throw new Error('Choose the current held item without a Share claim');
        phone=item.input.deviceUdid;locked=(await c.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[phone])).rows[0].locked;if(!locked)throw new Error('Phone busy');
        driver=await createMirroringDriver(pool,item,AbortSignal.timeout(15*60_000));
        const evidence=await driver.preflight(item.input,item.media);
        // No Share, no arm and no publication status change.
        await c.query("UPDATE scheduler.publishing_items SET results=jsonb_set(results,'{nativeDryRun}',$3::jsonb),updated_at=now() WHERE id=$1 AND version=$2 AND status='held'",[id,version,JSON.stringify({evidence,published:false,shareAttempted:false,checkedAt:new Date().toISOString(),nativeFlowFingerprint:driver.nativeFlowFingerprint})]);
        return {itemId:id,evidence,published:false,shareAttempted:false,needsWorkerPilot:true};
    }finally{await driver?.leaveVideo().catch(()=>undefined);if(locked)await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[phone]);c.release();}
}

/** Capture native draft screens only. There is no frame claim or Share call in this path. */
export async function captureNativeStoryDraft(pool:Pool,sequenceId:string,frames:NativeStoryFrame[]) {
    const a=new MirroringAutomationStore(pool),store=new NativeStoryStore(pool);
    if(!await a.foregroundAllowed())throw new Error('Phone control is paused');
    const fingerprint=await nativeFingerprint('stories');
    const c=await pool.connect();let locked=false,phone='';let driver:NativeStoryDriver|undefined;
    try {
        const sequence=(await c.query('SELECT * FROM scheduler.story_sequences WHERE id=$1',[sequenceId])).rows[0];
        if(!sequence||sequence.state!=='needs_review'||new Date(sequence.run_at).getTime()<=Date.now())throw new Error('Choose a future reviewed Story sequence');
        if(!(await loadRegisteredDevices()).some(d=>!d.disabled&&d.coordinateProfile==='iphone15promax'&&d.udid===sequence.device_udid))throw new Error('The reviewed Story phone is unavailable');
        if((await c.query('SELECT 1 FROM scheduler.mirroring_story_jobs WHERE sequence_id=$1',[sequenceId])).rowCount)throw new Error('This sequence already has a native approval job');
        await nativeStoryRevision(sequence.draft,frames);
        phone=sequence.device_udid;locked=(await c.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[phone])).rows[0].locked;
        if(!locked)throw new Error('Phone busy');
        driver=new NativeStoryDriver(AbortSignal.timeout(15*60_000),await loadNativeStoryFlow(),path.resolve('.scheduler-data/publishing/native-story-drafts',sequenceId+'-'+Date.now()));
        driver.screen.beforeInput=async()=>{if(!await a.foregroundAllowed()||await nativeFingerprint('stories')!==fingerprint)throw new Error('Native Story control was paused or changed');};
        const captured:NativeStoryFrame[]=[];
        for(const frame of frames){captured.push(await driver.captureDraftFrame(frame));await driver.leaveVideo();}
        const revision=await nativeStoryRevision(sequence.draft,captured);
        await c.query('INSERT INTO scheduler.mirroring_story_preview_sets(sequence_id,native_frames,revision,fingerprint) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[sequenceId,JSON.stringify(captured),revision,fingerprint]);
        const row=await store.prepare(sequenceId,captured,fingerprint);
        return {id:row.id,revision:row.revision,state:row.state,published:false,shareAttempted:false,previewUrls:[1,2,3,4,5].map(n=>'/api/publishing/stories/native/'+row.id+'/frames/'+n)};
    } finally {await driver?.leaveVideo().catch(()=>undefined);if(locked)await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[phone]);c.release();}
}
