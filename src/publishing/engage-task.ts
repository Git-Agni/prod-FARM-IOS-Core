import type { TaskDefinition } from '../plugin.js';
import { createDatabaseConnection } from '../database/client.js';
import { loadRegisteredDevices } from '../devices/registry.js';
import { validateEngagePayload, type EngagePayload } from './engage-model.js';
import { InstagramEngage } from './instagram-engage.js';
import { InstagramRelease } from './instagram-release.js';

const localDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());

// Claim ledger: one row per claim key. 'claimed' is written right before the one step that changes the post, so a
// crash or timeout after it is never repeated automatically; only 'failed_before_action' rows may run again.
export const ENGAGEMENT_SCHEMA = `CREATE TABLE IF NOT EXISTS scheduler.engagement_actions (
    claim_key text PRIMARY KEY, action text NOT NULL, post_url text NOT NULL, status text NOT NULL,
    result jsonb NOT NULL DEFAULT '{}'::jsonb, execution_id text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`;

export const instagramEngageTask: TaskDefinition<EngagePayload> = {
    type: 'instagram-engage', version: 1, displayName: 'Instagram pin first comment or share reel to Story',
    validate(value, context) {
        if (context.timingKind === 'daily' || context.timingKind === 'weekly') throw new Error('Each engagement names one reel; schedule it once');
        return validateEngagePayload(value, localDate());
    },
    summarize: p => p.action === 'pin' ? `Pin the first comment on ${p.postUrl}` : p.action === 'story_best' ? 'Share the best trial reel to the Story' : `Share ${p.postUrl} to the Story`,
    estimateDurationMs: () => 120_000,
    retryPolicy: () => ({ retryLimit: 0, retryDelaySeconds: 0, retryBackoff: false }), supportsStop: () => true,
    async execute(context, raw) {
        const payload = validateEngagePayload(raw, localDate());
        const connection = createDatabaseConnection();
        const client = await connection.pool.connect();
        let locked = false, claimed = false, lostRace = false;
        const mark = (status: string, result: object) => client.query(
            `INSERT INTO scheduler.engagement_actions(claim_key,action,post_url,status,result,execution_id) VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (claim_key) DO UPDATE SET status=$4,result=$5,execution_id=$6,updated_at=now()`,
            [payload.claimKey, payload.action, payload.postUrl, status, JSON.stringify(result), context.executionId]);
        try {
            await client.query(ENGAGEMENT_SCHEMA);
            if (!context.deviceLockHeld) locked = (await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', [context.device.udid])).rows[0].locked;
            if (!context.deviceLockHeld && !locked) throw new Error('Another publishing action owns this phone');
            const prior = (await client.query('SELECT status FROM scheduler.engagement_actions WHERE claim_key=$1', [payload.claimKey])).rows[0];
            if (prior && prior.status !== 'failed_before_action') {
                await context.log(`Skipped: ${payload.claimKey} is already ${prior.status}. Nothing was tapped.`);
                return { exitCode: 0, stopped: false };
            }
            const device = (await loadRegisteredDevices()).find(d => d.udid === context.device.udid);
            if (device?.coordinateProfile !== 'iphone15promax') throw new Error('Engagement controls are mapped only for iPhone 15 Pro Max');
            const driver = new InstagramEngage(`http://127.0.0.1:${device.wdaLocalPort ?? 8100}`, context.signal);
            const claim = async () => {
                // Atomic: only one run can move a key from absent/failed_before_action to claimed.
                const row = await client.query(
                    `INSERT INTO scheduler.engagement_actions(claim_key,action,post_url,status,execution_id) VALUES ($1,$2,$3,'claimed',$4)
                     ON CONFLICT (claim_key) DO UPDATE SET status='claimed',execution_id=$4,updated_at=now()
                     WHERE scheduler.engagement_actions.status='failed_before_action' RETURNING claim_key`,
                    [payload.claimKey, payload.action, payload.postUrl, context.executionId]);
                if (!row.rowCount) { lostRace = true; throw new Error('Another run already claimed this action'); }
                claimed = true;
            };
            let result: Record<string, unknown>;
            if (payload.action === 'story_best') result = await new InstagramRelease(`http://127.0.0.1:${device.wdaLocalPort ?? 8100}`, context.signal).storyFromBestTrialReel(claim);
            else { await driver.open(payload); result = payload.action === 'pin' ? await driver.pin(payload, claim) : await driver.story(payload, claim); }
            await mark('done', result);
            await context.log(`${payload.action} done: ${String(result.status)}`);
            return { exitCode: 0, stopped: false };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // After the claim the post may already have changed: record it for review and never repeat it.
            // A run that lost the claim race must not overwrite the winner's row.
            if (!lostRace) await mark(claimed ? 'uncertain_review' : 'failed_before_action', { error: message }).catch(() => undefined);
            await context.log(claimed ? `Uncertain after the action; review the reel before any retry: ${message}` : message);
            return { exitCode: null, stopped: context.signal.aborted, error: message };
        } finally {
            if (locked) await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [context.device.udid]);
            client.release(); await connection.close();
        }
    },
};
