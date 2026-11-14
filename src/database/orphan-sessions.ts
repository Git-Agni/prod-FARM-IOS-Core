import pg from 'pg';

import { databaseUrl, transactionPoolerUrl } from './client.js';

/**
 * Nov 13 (12:04 to 13:05 PT, then again from 13:07 PT): the Supabase session pooler counted 15 phone_farm clients
 * while this Mac held 3 sockets. The other 12 sessions were idle for 5 to 17 minutes and held no advisory lock.
 * The pooler keeps a client's slot until it sees that client's socket close, and after a network stall it never saw
 * the close. Every new connection then failed with EMAXCONNSESSION until the orphans were ended by hand.
 *
 * A live phone_farm session is never idle for minutes without a lock: pg pools close idle clients after 10 s, the
 * pg-boss LISTEN client checks in every 10 s, and the long-held clients (phone locks, the Story scheduler owner)
 * hold an advisory lock. "idle in transaction" sessions are never touched.
 */
export const DEFAULT_ORPHAN_IDLE_SECONDS = 180;

export const orphanSessionSql = `
SELECT a.pid,
       round(extract(epoch FROM now() - a.state_change))::int AS idle_seconds,
       left(regexp_replace(a.query, '\\s+', ' ', 'g'), 60) AS last_query,
       CASE WHEN $2::boolean THEN pg_terminate_backend(a.pid) ELSE false END AS terminated
  FROM pg_stat_activity a
 WHERE a.usename = current_user
   AND a.pid <> pg_backend_pid()
   AND a.state = 'idle'
   AND a.state_change < now() - make_interval(secs => $1::int)
   AND NOT EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid = a.pid AND l.locktype = 'advisory' AND l.granted)
 ORDER BY a.state_change`;

export interface OrphanSession { pid: number; idle_seconds: number; last_query: string; terminated: boolean }

/**
 * Lists (apply=false) or ends (apply=true) this role's orphaned sessions. It connects through the transaction
 * pooler, because the session pooler refuses every new client while it is full. Returns undefined when the URL is
 * not a Supabase pooler URL.
 */
export async function reapOrphanSessions({
    apply = false,
    minIdleSeconds = DEFAULT_ORPHAN_IDLE_SECONDS,
    connectionString = databaseUrl(),
}: { apply?: boolean; minIdleSeconds?: number; connectionString?: string } = {}): Promise<OrphanSession[] | undefined> {
    const url = transactionPoolerUrl(connectionString);
    if (!url) return undefined;
    if (!Number.isFinite(minIdleSeconds) || minIdleSeconds < 60) throw new Error('minIdleSeconds must be at least 60');
    const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10_000, query_timeout: 20_000 });
    client.on('error', () => undefined);
    await client.connect();
    try {
        return (await client.query<OrphanSession>(orphanSessionSql, [Math.round(minIdleSeconds), apply])).rows;
    } finally {
        await client.end().catch(() => undefined);
    }
}

/** True for the Supavisor error that means the session pool is full. */
export function isSessionPoolFull(error: unknown): boolean {
    return /EMAXCONNSESSION|max clients reached in session mode/.test(String((error as Error)?.message ?? error));
}

/**
 * Runs the reaper when the session pool is full, at most once per interval. ORPHAN_REAPER=off turns it off;
 * ORPHAN_REAPER=dry-run only logs the sessions it would end.
 */
export function createFullPoolReaper({ intervalMs = 120_000, log = console.error } = {}) {
    let lastRun = 0;
    let running = false;
    return async (error: unknown): Promise<void> => {
        const mode = process.env.ORPHAN_REAPER ?? 'apply';
        if (mode === 'off' || running || !isSessionPoolFull(error) || Date.now() - lastRun < intervalMs) return;
        running = true;
        lastRun = Date.now();
        try {
            const apply = mode !== 'dry-run';
            const rows = await reapOrphanSessions({ apply, minIdleSeconds: Number(process.env.ORPHAN_IDLE_SECONDS ?? DEFAULT_ORPHAN_IDLE_SECONDS) });
            if (!rows) return;
            const ended = rows.filter((row) => row.terminated).length;
            log(new Date().toISOString(), `session pool full: ${rows.length} orphaned phone_farm session(s) idle over the limit, ${apply ? `ended ${ended}` : 'dry run, ended none'}:`,
                rows.map((row) => `${row.pid} idle ${row.idle_seconds}s "${row.last_query}"`).join('; '));
        } catch (reapError) {
            log(new Date().toISOString(), 'orphan session reaper failed:', (reapError as Error).message);
        } finally {
            running = false;
        }
    };
}
