import type { TaskDefinition } from '../plugin.js';
import type { JsonObject } from '../types.js';
import { createDatabaseConnection } from '../database/client.js';
import { loadRegisteredDevices } from '../devices/registry.js';
import { InstagramPreview } from './instagram-preview.js';
import type { PostingInput } from './model.js';
interface PreviewPayload extends JsonObject { itemId: string; version: number }
export const instagramPreviewTask: TaskDefinition<PreviewPayload> = {
    type:'instagram-preview', version:1, displayName:'Instagram preview without posting',
    validate(value, context) {
        if (!value || Array.isArray(value) || typeof value !== 'object' || typeof value.itemId !== 'string' || !/^[0-9a-f-]{36}$/.test(value.itemId) || typeof value.version !== 'number' || !Number.isInteger(value.version) || value.version < 1) throw new Error('Item ID and version are required');
        if (context.timingKind === 'daily' || context.timingKind === 'weekly') throw new Error('Composer previews cannot repeat');
        return {itemId:value.itemId,version:value.version};
    },
    summarize:()=> 'Prepare Instagram composer for review. Does not publish.', estimateDurationMs:()=>180_000,
    retryPolicy:()=>({retryLimit:0,retryDelaySeconds:0,retryBackoff:false}),supportsStop:()=>true,
    async execute(context,payload) {
        const connection = createDatabaseConnection();
        const client = await connection.pool.connect();
        let locked = false;
        try {
            if (!context.deviceLockHeld) locked = (await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[context.device.udid])).rows[0].locked;
            if (!context.deviceLockHeld && !locked) throw new Error('Another publishing action owns this phone');
            const item = (await client.query('SELECT * FROM scheduler.publishing_items WHERE id=$1',[payload.itemId])).rows[0];
            if (!item || item.status !== 'held' || item.version !== payload.version || item.input.deviceUdid !== context.device.udid) throw new Error('Calendar item changed or is no longer held');
            if (item.cover) throw new Error('Custom cover selection still needs calibration. The item stays on hold.');
            const device = (await loadRegisteredDevices()).find(d=>d.udid===context.device.udid);
            if (device?.coordinateProfile !== 'iphone15promax') throw new Error('This preview flow is calibrated only for iPhone 15 Pro Max');
            const asset = context.assets.find(a=>a.sha256===item.media.sha256);
            if (!asset) throw new Error('The staged video is missing');
            const driver = new InstagramPreview(`http://127.0.0.1:${device.wdaLocalPort ?? 8100}`,context.signal, async () => {
                const current = (await client.query('SELECT status,version FROM scheduler.publishing_items WHERE id=$1',[payload.itemId])).rows[0];
                if(current?.status !== 'held' || current.version !== payload.version) throw new Error('Calendar item changed; preview stopped');
            });
            const result = await driver.run(item.input as PostingInput,asset,item.media.sha256);
            await client.query(`UPDATE scheduler.publishing_items SET results=jsonb_set(results,'{instagramPreview}',$2::jsonb),updated_at=now() WHERE id=$1`,[payload.itemId,JSON.stringify({...result,executionId:context.executionId})]);
            await context.log('Instagram preview prepared. Nothing was published. Visual review is required.');
            return {exitCode:0,stopped:false};
        } catch(error) {
            const message = error instanceof Error ? error.message : String(error);
            await context.log(message);
            await client.query(`UPDATE scheduler.publishing_items SET results=jsonb_set(results,'{instagramPreview}',$2::jsonb),updated_at=now() WHERE id=$1`,[payload.itemId,JSON.stringify({status:'blocked',error:message,published:false,executionId:context.executionId})]);
            return {exitCode:null,stopped:context.signal.aborted,error:message};
        } finally {
            if(locked) await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[context.device.udid]);
            client.release();await connection.close();
        }
    },
};
