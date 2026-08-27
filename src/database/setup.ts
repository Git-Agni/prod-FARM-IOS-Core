import { spawn } from 'node:child_process';

import { createDatabaseConnection } from './client.js';

function run(command: string, args: string[], timeoutMs = 120_000): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd: process.cwd(), stdio: 'inherit' });
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error(`${command} did not finish within ${timeoutMs / 1_000} seconds`));
        }, timeoutMs);
        child.once('error', (error) => { clearTimeout(timer); reject(error); });
        child.once('exit', (code) => {
            clearTimeout(timer);
            if (code === 0) resolve();
            else reject(new Error(`${command} exited with ${code}`));
        });
    });
}

await run('docker', ['compose', 'up', '-d', '--wait', 'postgres']);
const connection = createDatabaseConnection();
try {
    await connection.pool.query('select 1');
} finally {
    await connection.close();
}
await run(process.execPath, ['--env-file-if-exists=.env', '--import', 'tsx', 'src/database/migrate.ts']);
