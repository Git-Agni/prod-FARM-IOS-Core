import type { Pool } from 'pg';

/** Only admitted, runnable slots may take priority over comments on this phone. */
export async function directVideoDueSoon(pool: Pool, allowed: readonly string[], deviceUdid: string): Promise<boolean> {
    if (!allowed.length) return false;
    const result = await pool.query(`SELECT 1 FROM scheduler.publishing_releases r
        JOIN scheduler.publishing_items i ON i.id=r.item_id
        WHERE r.state='armed' AND i.status='held' AND r.item_id=ANY($1::uuid[])
        AND i.input->>'deviceUdid'=$2
        AND r.run_at>=now()-interval '10 minutes' AND r.run_at<now()+interval '5 minutes'
        LIMIT 1`, [allowed, deviceUdid]);
    return !!result.rowCount;
}
