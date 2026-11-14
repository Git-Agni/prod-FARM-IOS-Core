import { startStorySchedule } from '../publishing/story-schedule.js';
import { createPublishingPlugin } from '../publishing/plugin.js';
import { startReleaseLoop } from '../publishing/release-loop.js';
import type { JobWithMetadata } from 'pg-boss';

import { assertDatabaseReady, createDatabaseConnection } from '../database/client.js';
import { activeDevices, loadRegisteredDevices } from '../devices/registry.js';
import { configuredPluginModules, loadPlugins } from '../loader.js';
import { PluginRegistry } from '../registry.js';
import { executeAutomation } from './executor.js';
import { createQueue, ensureDeviceQueue, type ExecutionJob } from './queue.js';
import { SchedulerRepository } from './repository.js';
import { createTikTokPlugin } from '../tiktok-plugin.js';
import { phoneControlMode, requireWdaControl } from '../devices/control-mode.js';

export interface WorkerRuntime { close(): Promise<void> }

export async function startWorker(plugins: PluginRegistry): Promise<WorkerRuntime> {
    // General device queues contain XCTest tasks. Mirroring has its own worker below.
    requireWdaControl();
    const connection = createDatabaseConnection();
    await assertDatabaseReady(connection);
    const boss = createQueue();
    await boss.start();
    const repository = new SchedulerRepository(connection, boss, plugins);
    const workingQueues = new Set<string>();

    const registerDeviceWorkers = async (): Promise<void> => {
        for (const device of activeDevices(await loadRegisteredDevices())) {
            const queue = await ensureDeviceQueue(boss, device.udid);
            if (workingQueues.has(queue)) continue;
            await boss.work<ExecutionJob>(queue, { includeMetadata: true }, async ([job]) => {
                if (!job) return;
                const metadata = job as JobWithMetadata<ExecutionJob>;
                const attempt = metadata.retryCount + 1;
                const execution = await repository.startAttempt(job.data.executionId, attempt);
                if (!execution) return;
                const result = await executeAutomation(repository, plugins, execution, attempt, job.signal);
                await repository.finishAttempt(execution.id, attempt, result.exitCode, result.error);
                if (result.stopped) {
                    await repository.finishExecution(execution.id, 'stopped', result.exitCode, result.error);
                    return;
                }
                if (!result.error && result.exitCode === 0) {
                    await repository.finishExecution(execution.id, 'succeeded', 0);
                    return;
                }
                const message = result.error ?? 'Automation failed';
                const task = plugins.task({
                    pluginId: execution.pluginId, taskType: execution.taskType,
                    taskVersion: execution.taskVersion, payload: execution.payload,
                });
                const policy = task.retryPolicy(execution.payload);
                if (metadata.retryCount < policy.retryLimit && Date.now() < execution.deadlineAt.getTime()) {
                    await repository.resetForRetry(execution.id, message);
                    throw new Error(message);
                }
                await repository.finishExecution(execution.id, 'failed', result.exitCode, message);
            });
            workingQueues.add(queue);
            console.log(`Worker listening on ${queue} for ${device.name}`);
        }
    };

    await registerDeviceWorkers();
    await repository.reconcileQueueStates();
    await repository.materializeDue();
    const materializeTimer = setInterval(() => void repository.materializeDue().catch(console.error), 5_000);
    const deviceTimer = setInterval(() => void registerDeviceWorkers().catch(console.error), 30_000);
    const cleanupTimer = setInterval(() => {
        void repository.cleanup().catch(console.error);
        void repository.sweepOrphanedAssets().catch(console.error);
    }, 60 * 60_000);
    const reconcileTimer = setInterval(() => void repository.reconcileQueueStates().catch(console.error), 60_000);
    const releases = await startReleaseLoop(connection.pool);
    const stories = await startStorySchedule(connection.pool,'publishing');
    return {
        async close() {
            clearInterval(materializeTimer);
            clearInterval(deviceTimer);
            clearInterval(cleanupTimer);
            clearInterval(reconcileTimer);
            await releases.close();
            await stories.close();
            await boss.stop({ graceful: true, timeout: 30_000 });
            await connection.close();
        },
    };
}

/** App-owned publishing and Story planning. Does not consume unrelated device automation queues. */
export async function startPublishingOnlyWorker(): Promise<WorkerRuntime> {
    const connection = createDatabaseConnection();
    let stories: Awaited<ReturnType<typeof startStorySchedule>> | undefined;
    try {
        await assertDatabaseReady(connection);
        // Take the existing scheduler ownership lock before starting release checks.
        stories = await startStorySchedule(connection.pool, 'publishing');
        const releases = await startReleaseLoop(connection.pool);
        return { async close() { await releases.close(); await stories!.close(); await connection.close(); } };
    } catch (error) {
        await stories?.close();
        await connection.close();
        throw error;
    }
}

async function main(): Promise<void> {
    if (['mirroring_publishing','direct_publishing'].includes(process.env.PHONE_FARM_WORKER_MODE ?? '')) {
        const runtime = await startPublishingOnlyWorker();
        console.log('Phone Farm publishing-only worker is running in '+phoneControlMode()+' mode. Unselected items and general automation queues do not run.');
        process.once('SIGINT', () => void runtime.close());
        process.once('SIGTERM', () => void runtime.close());
        return;
    }
    // The same app worker can run the review calendar without activating untested phone actions.
    if (process.env.PHONE_FARM_WORKER_MODE === 'story_planning') {
        const connection = createDatabaseConnection();
        await assertDatabaseReady(connection);
        const stories = await startStorySchedule(connection.pool);
        console.log('Phone Farm Story planner running. Native publication is disabled; review targets only.');
        const close = async () => { await stories.close(); await connection.close(); };
        process.once('SIGINT', () => void close());
        process.once('SIGTERM', () => void close());
        return;
    }
    const plugins = new PluginRegistry([
        createPublishingPlugin(),
        createTikTokPlugin({ bundleId: process.env.TIKTOK_BUNDLE_ID }),
        ...await loadPlugins(configuredPluginModules()),
    ]);
    const runtime = await startWorker(plugins);
    const shutdown = async (signal: string) => {
        console.log(`Scheduler worker stopping after ${signal}`);
        await runtime.close();
    };
    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) await main();
