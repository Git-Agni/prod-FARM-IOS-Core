import { spawn, type ChildProcess } from 'node:child_process';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import { diagnoseWdaLaunchFailure, wdaUnavailableTooLong } from './diagnostics.js';
import { resolveDeveloperDir } from './xcode-env.js';

function required(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is required in .env`);
    return value;
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

type WdaState = 'disconnected' | 'connecting' | 'unlock-required' | 'ready' | 'error';

let lastState = '';
function report(state: WdaState, message: string): void {
    const value = JSON.stringify({ state, message });
    if (value === lastState) return;
    lastState = value;
    console.log(`[wda-state] ${value}`);
}

const udid = required('IOS_UDID');
const teamId = required('XCODE_ORG_ID');
const developerDir = resolveDeveloperDir();
const driverPath = path.resolve(process.env.XCUITEST_DRIVER_PATH
    ?? '.appium2/node_modules/appium-xcuitest-driver');
const projectPath = path.resolve(process.env.WDA_PROJECT_PATH ?? path.join(
    driverPath,
    'node_modules/appium-webdriveragent/WebDriverAgent.xcodeproj',
));
const localPort = Number.parseInt(process.env.WDA_LOCAL_PORT ?? '8100', 10);
const remotePort = Number.parseInt(process.env.WDA_REMOTE_PORT ?? '8100', 10);
const mjpegLocalPort = Number.parseInt(process.env.MJPEG_LOCAL_PORT ?? '9100', 10);
const mjpegRemotePort = Number.parseInt(process.env.MJPEG_REMOTE_PORT ?? '9100', 10);

await access(projectPath);
if (![localPort, remotePort, mjpegLocalPort, mjpegRemotePort].every(Number.isSafeInteger)) {
    throw new Error('WDA and MJPEG port values must be integers');
}

// Two supervisors racing on the same device corrupt the shared WDA build (concurrent
// installs can leave WebDriverAgentRunner-Runner.app with no executable inside it), so
// only one `start.ts` per UDID is allowed at a time — whether spawned by wda-service.ts
// or run directly via `npm run wda:start`.
const lockPath = path.resolve('.wda', `${udid}.supervisor.lock`);

function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
}

async function acquireDeviceLock(): Promise<void> {
    await mkdir(path.dirname(lockPath), { recursive: true });
    for (;;) {
        try {
            await writeFile(lockPath, String(process.pid), { flag: 'wx' });
            return;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
        const holder = Number.parseInt((await readFile(lockPath, 'utf8').catch(() => '')).trim(), 10);
        if (Number.isInteger(holder) && holder > 0 && isProcessAlive(holder)) {
            throw new Error(`Another WDA supervisor (pid ${holder}) is already managing device ${udid}. `
                + 'Stop it first — running two supervisors for the same device corrupts the shared build.');
        }
        await rm(lockPath, { force: true }); // stale lock from a crashed/killed supervisor
    }
}

async function releaseDeviceLock(): Promise<void> {
    await rm(lockPath, { force: true }).catch(() => {});
}

await acquireDeviceLock();

const require = createRequire(import.meta.url);
const factoryPath = path.join(driverPath, 'build/lib/device-connections-factory.js');
interface DeviceConnections {
    requestConnection(udid: string, localPort: number, options: {
        usePortForwarding: boolean;
        devicePort: number;
    }): Promise<void>;
    releaseConnection(udid: string, localPort: number): void;
}
interface IosUtilities {
    getConnectedDevices(): Promise<string[]>;
}

const { DEVICE_CONNECTIONS_FACTORY: deviceConnections } = require(factoryPath) as {
    DEVICE_CONNECTIONS_FACTORY: DeviceConnections;
};
const { utilities } = require('appium-ios-device') as { utilities: IosUtilities };

const args = [
    'test-without-building',
    '-project', projectPath,
    '-scheme', 'WebDriverAgentRunner',
    '-destination', `id=${udid}`,
    `IPHONEOS_DEPLOYMENT_TARGET=${process.env.IOS_PLATFORM_VERSION ?? '16.7'}`,
    `DEVELOPMENT_TEAM=${teamId}`,
    `PRODUCT_BUNDLE_IDENTIFIER=${required('WDA_BUNDLE_ID')}`,
    `CODE_SIGN_IDENTITY=${process.env.XCODE_SIGNING_ID ?? 'Apple Development'}`,
    'CODE_SIGN_STYLE=Automatic',
    'GCC_TREAT_WARNINGS_AS_ERRORS=0',
    'COMPILER_INDEX_STORE_ENABLE=NO',
];

let child: ChildProcess | undefined;
let forwarding = false;
let stopping = false;
let locked = false;
let startedAt = 0;
let lastReadyAt: number | undefined;
let failures = 0;
let retryAt = 0;
let launchFailure: string | undefined;

function releaseForwarding(): void {
    if (!forwarding) return;
    forwarding = false;
    deviceConnections.releaseConnection(udid, localPort);
    deviceConnections.releaseConnection(udid, mjpegLocalPort);
}

async function stopRunner(): Promise<void> {
    const running = child;
    child = undefined;
    if (running && running.exitCode === null && !running.killed) {
        running.kill('SIGTERM');
        await Promise.race([
            new Promise<void>((resolve) => running.once('exit', () => resolve())),
            delay(3_000),
        ]);
        if (running.exitCode === null) running.kill('SIGKILL');
    }
    releaseForwarding();
}

function observeOutput(chunk: Buffer, stderr: boolean): void {
    const output = chunk.toString();
    (stderr ? process.stderr : process.stdout).write(output);
    const diagnosis = diagnoseWdaLaunchFailure(output);
    if (diagnosis?.startsWith('Unlock')) {
        locked = true;
        report('unlock-required', diagnosis);
    } else if (diagnosis) {
        launchFailure = diagnosis;
        report('error', diagnosis);
    }
}

async function startRunner(): Promise<void> {
    await deviceConnections.requestConnection(udid, localPort, {
        usePortForwarding: true,
        devicePort: remotePort,
    });
    forwarding = true;
    try {
        await deviceConnections.requestConnection(udid, mjpegLocalPort, {
            usePortForwarding: true,
            devicePort: mjpegRemotePort,
        });
    } catch (error) {
        releaseForwarding();
        throw error;
    }
    locked = false;
    launchFailure = undefined;
    startedAt = Date.now();
    lastReadyAt = undefined;
    report('connecting', 'Starting WDA');
    const running = spawn('xcodebuild', args, {
        env: { ...process.env, DEVELOPER_DIR: developerDir },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    child = running;
    running.stdout?.on('data', (chunk: Buffer) => observeOutput(chunk, false));
    running.stderr?.on('data', (chunk: Buffer) => observeOutput(chunk, true));
    running.once('error', (error) => report('error', `Unable to start xcodebuild: ${error.message}`));
    running.once('exit', (code, signal) => {
        if (child === running) child = undefined;
        releaseForwarding();
        if (!stopping) {
            failures += 1;
            const retrySeconds = [2, 5, 10, 30][Math.min(failures - 1, 3)]!;
            retryAt = Date.now() + retrySeconds * 1_000;
            report('error', launchFailure
                ? `${launchFailure}; retrying in ${retrySeconds}s`
                : `WDA exited ${signal ? `after ${signal}` : `with code ${code ?? 'unknown'}`}; retrying in ${retrySeconds}s`);
        }
    });
}

async function wdaReady(): Promise<boolean> {
    try {
        const response = await fetch(`http://127.0.0.1:${localPort}/status`, { signal: AbortSignal.timeout(2_000) });
        return response.ok;
    } catch {
        return false;
    }
}

async function shutdown(): Promise<void> {
    if (stopping) return;
    stopping = true;
    await stopRunner();
    await releaseDeviceLock();
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

console.log(`Supervising persistent WDA for ${udid}`);
while (!stopping) {
    let connected = false;
    try {
        connected = (await utilities.getConnectedDevices()).includes(udid);
    } catch (error) {
        report('error', `Could not inspect USB devices: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!connected) {
        if (child || forwarding) await stopRunner();
        failures = 0;
        retryAt = 0;
        report('disconnected', 'Reconnect the USB cable');
    } else if (child) {
        if (await wdaReady()) {
            failures = 0;
            locked = false;
            lastReadyAt = Date.now();
            report('ready', 'WDA is ready');
        } else if (wdaUnavailableTooLong({
            now: Date.now(),
            launchedAt: startedAt,
            lastReadyAt,
            timeoutMs: 120_000,
        })) {
            await stopRunner();
            failures += 1;
            retryAt = Date.now() + 30_000;
            report('error', `${lastReadyAt === undefined ? 'WDA did not become ready' : 'WDA remained unavailable'} for 120 seconds; retrying in 30s`);
        } else if (!locked) {
            report('connecting', 'Waiting for WDA to become ready');
        }
    } else if (Date.now() >= retryAt) {
        try {
            await startRunner();
        } catch (error) {
            failures += 1;
            const retrySeconds = [2, 5, 10, 30][Math.min(failures - 1, 3)]!;
            retryAt = Date.now() + retrySeconds * 1_000;
            report('error', `${error instanceof Error ? error.message : String(error)}; retrying in ${retrySeconds}s`);
        }
    }
    await delay(2_000);
}
