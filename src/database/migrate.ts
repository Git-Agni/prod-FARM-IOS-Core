import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDatabaseConnection } from './client.js';
import { createQueue } from '../scheduler/queue.js';

const connection = createDatabaseConnection();
try {
    await migrate(connection.db, {
        migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
        migrationsSchema: 'drizzle',
    });
    const boss = createQueue({ migrate: true });
    await boss.start();
    await boss.stop();
    console.log('Scheduler database migrations are current');
} finally {
    await connection.close();
}
