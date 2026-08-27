import { assertDatabaseReady, createDatabaseConnection } from '../database/client.js';
import { createQueue } from './queue.js';
import { SchedulerRepository } from './repository.js';
import type { PluginRegistry } from '../registry.js';

export async function createSchedulerRuntime(plugins: PluginRegistry) {
    const connection = createDatabaseConnection();
    try {
        await assertDatabaseReady(connection);
        const boss = createQueue();
        await boss.start();
        return {
            repository: new SchedulerRepository(connection, boss, plugins),
            async close() {
                await boss.stop({ graceful: true, timeout: 10_000 });
                await connection.close();
            },
        };
    } catch (error) {
        await connection.close();
        throw error;
    }
}
