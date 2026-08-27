import { closeSync, mkdirSync, openSync, renameSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { requestWdaService } from './wda-service-client.js';
import { wdaServiceSocketPath } from './wda-service-protocol.js';

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function rotateLogIfLarge(logPath: string, maxBytes = 5 * 1024 * 1024): void {
    try {
        if (statSync(logPath).size > maxBytes) renameSync(logPath, `${logPath}.1`);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
}

async function serviceState(socketPath: string): Promise<'absent' | 'starting' | 'ready'> {
    try {
        const response = await requestWdaService('/health', { socketPath, timeoutMs: 750 });
        return response.statusCode === 200 ? 'ready' : 'starting';
    } catch {
        return 'absent';
    }
}

export async function ensureWdaService(): Promise<void> {
    const socketPath = wdaServiceSocketPath();
    const initialState = await serviceState(socketPath);
    if (initialState === 'ready') return;

    const stateDirectory = path.dirname(socketPath);
    const logPath = path.join(stateDirectory, 'wda-service.log');
    if (initialState === 'absent') {
        await mkdir(stateDirectory, { recursive: true });
        mkdirSync(path.dirname(logPath), { recursive: true });
        rotateLogIfLarge(logPath);
        const logFd = openSync(logPath, 'a');
        const script = fileURLToPath(new URL('./wda-service.ts', import.meta.url));
        try {
            const child = spawn(process.execPath, [
                '--env-file-if-exists=.env',
                '--import', 'tsx',
                script,
            ], {
                cwd: process.cwd(),
                detached: true,
                env: process.env,
                stdio: ['ignore', logFd, logFd],
            });
            child.unref();
        } finally {
            closeSync(logFd);
        }
    }

    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
        if (await serviceState(socketPath) === 'ready') return;
        await delay(250);
    }
    throw new Error(`WDA service did not become ready; inspect ${logPath}`);
}
