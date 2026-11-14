import type { Pool, PoolClient } from 'pg';
import { setTimeout as delay } from 'node:timers/promises';

/** Shared with timed releases, comments and attended controls. Never expire a live owner's lock. */
export async function acquireDeviceLock(pool: Pool, udid: string, signal: AbortSignal, deadline: Date): Promise<PoolClient> {
    const client = await pool.connect();
    try {
        while (!signal.aborted && Date.now() < deadline.getTime()) {
            if ((await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', [udid])).rows[0].locked) return client;
            await delay(Math.min(1000, Math.max(1, deadline.getTime() - Date.now())), undefined, { signal });
        }
        throw new Error(signal.aborted ? 'Stopped while waiting for the phone' : 'Phone remained busy until the job window expired');
    } catch (error) { client.release(); throw error; }
}

export async function releaseDeviceLock(client: PoolClient, udid: string): Promise<void> {
    try { await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [udid]); }
    finally { client.release(true); }
}
