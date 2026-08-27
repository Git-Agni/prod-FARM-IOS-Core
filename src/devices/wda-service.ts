import { chmod, mkdir, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';

import { DeviceConnectionManager } from './connection-manager.js';
import { createWdaServiceHttpServer } from './wda-service-http.js';
import { requestWdaService } from './wda-service-client.js';
import { wdaServiceSocketPath } from './wda-service-protocol.js';

const socketPath = wdaServiceSocketPath();
const lockPath = `${socketPath}.lock`;
await mkdir(path.dirname(socketPath), { recursive: true, mode: 0o700 });

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function serviceResponding(): Promise<boolean> {
    try {
        await requestWdaService('/health', { socketPath, timeoutMs: 750 });
        return true;
    } catch {
        return false;
    }
}

async function acquireServiceLock(): Promise<void> {
    try {
        await mkdir(lockPath, { mode: 0o700 });
        return;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
        if (await serviceResponding()) {
            console.log(`WDA service is already running at ${socketPath}`);
            process.exit(0);
        }
        await delay(250);
    }
    await rmdir(lockPath);
    await acquireServiceLock();
}

if (await serviceResponding()) {
    console.log(`WDA service is already running at ${socketPath}`);
    process.exit(0);
}
await acquireServiceLock();
if (await serviceResponding()) {
    await rmdir(lockPath);
    console.log(`WDA service is already running at ${socketPath}`);
    process.exit(0);
}
await unlink(socketPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
});

const connections = new DeviceConnectionManager();
let stopping = false;
let ready = false;
const server = createWdaServiceHttpServer(connections, () => void shutdown('request'), () => ready);

async function shutdown(reason: string): Promise<void> {
    if (stopping) return;
    stopping = true;
    console.log(`Stopping WDA service after ${reason}`);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await connections.close();
    await unlink(socketPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
    });
    await rmdir(lockPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
    });
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

server.once('error', (error) => {
    console.error(error);
    process.exitCode = 1;
});

await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
        server.off('error', reject);
        resolve();
    });
});
await chmod(socketPath, 0o600);
console.log(`WDA service listening at ${socketPath}`);
try {
    await connections.start();
    ready = true;
    console.log('WDA service is ready');
} catch (error) {
    console.error(error);
    await shutdown('startup failure');
    process.exitCode = 1;
}
