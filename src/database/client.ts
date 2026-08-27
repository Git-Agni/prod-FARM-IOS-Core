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
    const pool = new Pool({ connectionString, max: Number(process.env.DATABASE_POOL_SIZE ?? 10) });
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
