import { PgBoss } from 'pg-boss';
import crypto from 'node:crypto';

import { databaseUrl } from '../database/client.js';

export interface ExecutionJob {
    executionId: string;
}

export function queueNameForDevice(udid: string): string {
    const key = crypto.createHash('sha256').update(udid).digest('hex').slice(0, 20);
    return `ios-device-${key}`;
}

export function createQueue({ migrate = false }: { migrate?: boolean } = {}): PgBoss {
    const boss = new PgBoss({
        connectionString: databaseUrl(),
        schema: 'pgboss',
        schedule: false,
        useListenNotify: true,
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
