import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema.js';

export interface DatabaseConnection {
    pool: Pool;
    db: NodePgDatabase<typeof schema>;
    close(): Promise<void>;
}

export function databaseUrl(): string {
    const value = process.env.DATABASE_URL;
    if (!value) throw new Error('DATABASE_URL is required');
    return value;
}

export function createDatabaseConnection(connectionString = databaseUrl()): DatabaseConnection {
    // Oct 19 09:37 PT: after three pooler drops, all 4 clients were checked out and dead, and pool.connect() waited
    // forever with no socket open. Posting stopped for five hours. Never wait forever for a client or a query.
    // query_timeout stays above the 180 s statement_timeout that attended scripts set for a blocking phone lock.
    const pool = new Pool({
        connectionString, max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
        connectionTimeoutMillis: 30_000, query_timeout: 300_000, keepAlive: true, keepAliveInitialDelayMillis: 10_000,
    });
    // Oct 13 02:00 and Oct 15 20:11: the Supabase pooler dropped a connection ("Connection terminated unexpectedly").
    // With no listener, pg re-throws the client's 'error' event and the whole worker crashed mid-post. Log it instead:
    // the query in flight still rejects and its own handler records the failure; the pool replaces the client.
    const logDropped = (error: Error) => console.error(new Date().toISOString(), 'database connection dropped:', error.message);
    pool.on('error', logDropped);
    pool.on('connect', (client) => client.on('error', logDropped));
    return {
        pool,
        db: drizzle(pool, { schema }),
        close: () => pool.end(),
    };
}

export async function assertDatabaseReady(connection: DatabaseConnection): Promise<void> {
    const result = await connection.pool.query<{ present: string | null }>(
        `select to_regclass('scheduler.schedules')::text as present`,
    );
    if (!result.rows[0]?.present) {
        throw new Error('Scheduler database is not migrated; run npm run db:setup');
    }
}
