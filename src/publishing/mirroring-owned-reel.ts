import type {Pool} from 'pg';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {MirrorScreen,type MirrorSnapshot} from '../devices/mirroring/screen.js';
import {MirroringReceiptReader} from './mirroring-receipts.js';
import {MirroringAutomationStore,nativeFingerprint} from './mirroring-automation.js';
import {loadRegisteredDevices} from '../devices/registry.js';

/** An old attended post may have no scheduler Share claim. Observe its existing
 * owned link without changing any publication status or manufacturing a claim. */
export function assertOwnedSourceAnchor(source:any,anchor:any){
    const owns=(item:any)=>item?.input?.targets?.some((t:any)=>t.platform==='instagram'&&t.account.replace(/^@/,'')==='antoniorevenue');
    if(!source||!anchor||source.id===anchor.id||!['needs_review','published'].includes(source.status)||!owns(source)||!owns(anchor)
        ||source.input.deviceUdid!==anchor.input.deviceUdid||anchor.status!=='published'
        ||anchor.results?.release?.receipts?.instagram?.verified!==true
        ||anchor.results?.release?.receipts?.instagram?.source!=='instagram_app'
        ||!anchor.input.instagramRelatedReel||anchor.input.instagramRelatedReel.caption!==source.input.caption)
        throw new Error('Choose an owned source linked from a verified Instagram post');
    return anchor.input.instagramRelatedReel;
}
export async function observeOwnedReel(pool:Pool,sourceId:string,anchorId:string){
    if(![sourceId,anchorId].every(id=>/^[a-f0-9-]{36}$/.test(id??'')))throw new Error('Choose the source and its verified anchor post');
    const automation=new MirroringAutomationStore(pool),fingerprint=await nativeFingerprint('instagram_facebook');
    if(!await automation.foregroundAllowed())throw new Error('Phone control is paused');
    const c=await pool.connect();let locked=false,phone='';
    const screen=new MirrorScreen(AbortSignal.timeout(240_000));
    screen.beforeInput=async()=>{if(!await automation.foregroundAllowed()||await nativeFingerprint('instagram_facebook')!==fingerprint)throw new Error('Native source observation was paused or changed');};
    const root=path.resolve('.scheduler-data/publishing/owned-reel-observations',sourceId+'-'+Date.now());
    async function proof(name:string,s?:MirrorSnapshot){const v=s??await screen.snapshot();await mkdir(root,{recursive:true,mode:0o700});await writeFile(path.join(root,name+'.png'),Buffer.from(v.png,'base64'),{mode:0o600});return v;}
    try{
        const source=(await c.query('SELECT * FROM scheduler.publishing_items WHERE id=$1',[sourceId])).rows[0];
        const anchor=(await c.query('SELECT * FROM scheduler.publishing_items WHERE id=$1',[anchorId])).rows[0];
        const reel=assertOwnedSourceAnchor(source,anchor);
        phone=source.input.deviceUdid;
        if(!(await loadRegisteredDevices()).some(d=>!d.disabled&&d.udid===phone&&d.coordinateProfile==='iphone15promax'))throw new Error('The owned source phone is unavailable');
        if(createHash('sha256').update(await readFile(source.media.path)).digest('hex')!==source.media.sha256)throw new Error('The owned source media changed');
        locked=(await c.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[phone])).rows[0].locked;
        if(!locked)throw new Error('Phone busy');
        const receipt=await new MirroringReceiptReader(screen,proof).verifyRelated(reel);
        await screen.beforeInput();
        await c.query('BEGIN');
        const currentSource=(await c.query('SELECT * FROM scheduler.publishing_items WHERE id=$1 FOR UPDATE',[sourceId])).rows[0];
        const currentAnchor=(await c.query('SELECT * FROM scheduler.publishing_items WHERE id=$1 FOR UPDATE',[anchorId])).rows[0];
        assertOwnedSourceAnchor(currentSource,currentAnchor);
        if(currentSource.version!==source.version||currentAnchor.version!==anchor.version||currentSource.media.sha256!==source.media.sha256)throw new Error('Owned source records changed during observation');
        const r=await c.query(`INSERT INTO scheduler.mirroring_owned_reel_observations(url,caption,source_item_id,anchor_item_id,source_sha256,fingerprint,proof_root)
            VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(url) DO UPDATE SET caption=EXCLUDED.caption,source_item_id=EXCLUDED.source_item_id,
            anchor_item_id=EXCLUDED.anchor_item_id,source_sha256=EXCLUDED.source_sha256,fingerprint=EXCLUDED.fingerprint,proof_root=EXCLUDED.proof_root,verified_at=now()
            RETURNING verified_at`,[reel.url,reel.caption,source.id,anchor.id,source.media.sha256,fingerprint,root]);
        await c.query('COMMIT');
        return {sourceItemId:source.id,anchorItemId:anchor.id,...receipt,verifiedAt:r.rows[0].verified_at,publishedStatusChanged:false,shareClaimCreated:false};
    }catch(error){await c.query('ROLLBACK').catch(()=>undefined);await proof('failure').catch(()=>undefined);throw error;}
    finally{if(locked){await screen.home().catch(()=>undefined);await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[phone]);}c.release();}
}
