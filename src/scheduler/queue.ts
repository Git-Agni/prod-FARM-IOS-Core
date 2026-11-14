import { PgBoss } from 'pg-boss';
import crypto from 'node:crypto';

import { databaseUrl, transactionPoolerUrl } from '../database/client.js';

export interface ExecutionJob {
    executionId: string;
}

export function queueNameForDevice(udid: string): string {
    const key = crypto.createHash('sha256').update(udid).digest('hex').slice(0, 20);
    return `ios-device-${key}`;
}

/**
 * Nov 13: two pooler stalls (12:04 to 13:05 PT and again from 13:07 PT) filled the 15-client session pool with
 * orphans. The Mac held 3 sockets; Supavisor still counted 15 clients. 10 of the 15 orphans were pg-boss: LISTEN
 * clients that never sent their first heartbeat, heartbeat checks, and maintenance updates. Each heartbeat timeout
 * makes pg-boss end the LISTEN client and open a new one, and the pooler kept every old slot. pg-boss needs no
 * session state (only SET LOCAL and transaction advisory locks), so it uses the transaction pooler and polls
 * instead of LISTEN. PGBOSS_LISTEN_NOTIFY=1 restores LISTEN on the session URL; PGBOSS_DATABASE_URL overrides both.
 */
export function pgBossListenNotify(): boolean {
    return process.env.PGBOSS_LISTEN_NOTIFY === '1';
}

export function queueDatabaseUrl({ migrate = false }: { migrate?: boolean } = {}): string {
    if (process.env.PGBOSS_DATABASE_URL) return process.env.PGBOSS_DATABASE_URL;
    const session = databaseUrl();
    // Migrations run DDL once at setup; LISTEN needs a session. Both keep the session URL.
    if (migrate || pgBossListenNotify()) return session;
    return transactionPoolerUrl(session) ?? session;
}

export function createQueue({ migrate = false }: { migrate?: boolean } = {}): PgBoss {
    const boss = new PgBoss({
        connectionString: queueDatabaseUrl({ migrate }),
        // Nov 10: pg-boss read DATABASE_POOL_SIZE too, so raising the app pool to 8 (Nov 8) also gave pg-boss 8 and the
        // Supabase session pooler hit its 15-client cap. pg-boss gets its own small size.
        max: Number(process.env.PGBOSS_POOL_SIZE ?? process.env.DATABASE_POOL_SIZE ?? 10),
        schema: 'pgboss',
        schedule: false,
        useListenNotify: pgBossListenNotify(),
        migrate,
        createSchema: migrate,
    });
    boss.on('error', (error) => console.error('pg-boss:', error));
    return boss;
}

export async function ensureDeviceQueue(boss: PgBoss, udid: string): Promise<string> {
    const name = queueNameForDevice(udid);
    if (!await boss.getQueue(name)) {
        await boss.createQueue(name, {
            policy: 'singleton',
            notify: true,
            heartbeatSeconds: 60,
            deleteAfterSeconds: 30 * 24 * 60 * 60,
        });
    }
    return name;
}
