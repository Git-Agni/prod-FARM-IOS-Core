import { access } from 'node:fs/promises';

import { requestWdaService } from './wda-service-client.js';
import { wdaServiceSocketPath } from './wda-service-protocol.js';

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

try {
    const socketPath = wdaServiceSocketPath();
    const lockPath = `${socketPath}.lock`;
    const response = await requestWdaService('/shutdown', { method: 'POST' });
    if (response.statusCode !== 202) throw new Error(`WDA service returned status ${response.statusCode}`);
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
        await delay(100);
        try {
            await access(socketPath);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            try {
                await access(lockPath);
            } catch (lockError) {
                if ((lockError as NodeJS.ErrnoException).code !== 'ENOENT') throw lockError;
                console.log('WDA service stopped');
                process.exit(0);
            }
        }
    }
    throw new Error('WDA service did not stop within 10 seconds');
} catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ECONNREFUSED') {
        console.log('WDA service is not running');
    } else {
        throw error;
    }
}
