import type { Pool } from 'pg';

export const mirroringPublisherBlocker = 'The Mirroring posting flow is being built. Related-Reel selection and native Instagram and Facebook receipt checks still need calibration. Automatic posting remains blocked.';

export interface ReleaseWorkerTick {
    controlMode: 'wda' | 'mirroring';
    state: 'running' | 'blocked';
    blockers: string[];
}

export function releaseWorkerHealth(row: any, now = new Date()) {
    const tick = row?.last_tick ? new Date(row.last_tick) : null;
    const age = tick ? now.getTime() - tick.getTime() : Infinity;
    const healthy = Number.isFinite(age) && age >= 0 && age < 90_000;
    const blocked = row?.state !== 'running' || !Array.isArray(row?.blockers) || row.blockers.length > 0;
    return {
        lastTick: tick?.toISOString() ?? null,
        healthy,
        controlMode: row?.control_mode ?? null,
        state: healthy ? blocked ? 'blocked' : 'running' : 'stopped',
        blockers: healthy && Array.isArray(row?.blockers) ? row.blockers : ['The release worker is not running.'],
        automaticPostingRequested: healthy,
        videoPostingRunning: healthy && !blocked,
    };
}

/** Oct 19: the heartbeat sat at 09:37 PT for five hours and nothing alerted. The worker touches it every 30 s, even
 * during a long job, so 5 minutes of silence means it is stuck or gone. device-alert.ts sends this and, past 15 minutes,
 * restarts the worker through launchd. */
export const workerStaleAlertMs = 5 * 60_000, workerRestartMs = 15 * 60_000;
export function workerHeartbeatIssue(lastTick: Date | null, now = Date.now()) {
    const age = lastTick ? now - lastTick.getTime() : Infinity;
    if (age <= workerStaleAlertMs) return null;
    const since = lastTick ? lastTick.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }) + ' PT' : 'never';
    return { key: 'worker:stale', text: `The posting worker's heartbeat is *stale* (last ${since}). Nothing posts until it runs again.`, restart: age > workerRestartMs };
}

export class ReleaseWorkerStatusStore {
    constructor(private pool: Pool) {}
    async initialize() {
        await this.pool.query(`CREATE TABLE IF NOT EXISTS scheduler.publishing_worker_health (
            id integer PRIMARY KEY CHECK (id=1), last_tick timestamptz NOT NULL,
            control_mode text NOT NULL CHECK (control_mode IN ('wda','mirroring')),
            state text NOT NULL CHECK (state IN ('running','blocked')),
            blockers jsonb NOT NULL
        )`);
    }
    async tick(value: ReleaseWorkerTick) {
        await this.pool.query(`INSERT INTO scheduler.publishing_worker_health(id,last_tick,control_mode,state,blockers)
            VALUES(1,now(),$1,$2,$3) ON CONFLICT(id) DO UPDATE SET last_tick=EXCLUDED.last_tick,
            control_mode=EXCLUDED.control_mode,state=EXCLUDED.state,blockers=EXCLUDED.blockers`,
            [value.controlMode,value.state,JSON.stringify(value.blockers)]);
    }
    /** Liveness only, while a long job holds the tick. The state and blockers from the tick's start stay unchanged. */
    async touch() {
        await this.pool.query('UPDATE scheduler.publishing_worker_health SET last_tick=now() WHERE id=1');
    }
    async status() {
        return releaseWorkerHealth((await this.pool.query('SELECT * FROM scheduler.publishing_worker_health WHERE id=1')).rows[0]);
    }
}
