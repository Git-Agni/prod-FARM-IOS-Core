import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { remote, type Browser } from 'webdriverio';

import { switchTikTokAccount, tapCoordinate } from '../tiktok/actions.js';
import { coordinateProfiles, coordinatesForProfile, profileForProductType, type CoordinateProfile } from './coordinates.js';
import { discoverConnectedDevices, type Device } from './discovery.js';
import { loadRegisteredDevices, saveRegisteredDevices, type RegisteredDevice } from './registry.js';
import { passcodeForDevice, setDevicePasscode } from './secrets.js';
import { WdaRemoteControl } from './wda-remote.js';
import { diagnoseWdaLaunchFailure } from './wda/diagnostics.js';

export type RegistrationCheckState = 'pending' | 'checking' | 'blocked' | 'passed' | 'failed';
export type RegistrationAction = 'refresh' | 'prepare' | 'verify' | 'finalize';
export type RegistrationCheckName = 'host' | 'connection' | 'signing' | 'developer'
    | 'wda' | 'appium' | 'video' | 'touch' | 'tiktok' | 'accounts';

export interface RegistrationCheck {
    state: RegistrationCheckState;
    message: string;
    updatedAt: string;
}

export interface RegistrationSnapshot {
    id: string;
    device: Device;
    name: string;
    coordinateProfile?: CoordinateProfile;
    availableProfiles: Array<{ name: CoordinateProfile; displayName: string; screenSize: { width: number; height: number } }>;
    recommendedProfile?: CoordinateProfile;
    wdaLocalPort: number;
    mjpegLocalPort: number;
    tiktokAccounts: string[];
    hasPasscode: boolean;
    busy: boolean;
    checks: Record<RegistrationCheckName, RegistrationCheck>;
    logs: string[];
    canFinalize: boolean;
    finalized: boolean;
}

export interface RegistrationUpdate {
    name?: string;
    coordinateProfile?: string;
    tiktokAccounts?: string[];
    passcode?: string;
}

interface RegistrationSession extends RegistrationSnapshot {
    passcode?: string;
    supervisor?: ChildProcess;
}

export interface DeviceRegistrationManager {
    start(): Promise<void>;
    close(): Promise<void>;
    candidates(): Promise<Device[]>;
    create(udid: string): Promise<RegistrationSnapshot>;
    get(id: string): Promise<RegistrationSnapshot | undefined>;
    update(id: string, input: RegistrationUpdate): Promise<RegistrationSnapshot>;
    run(id: string, action: RegistrationAction, options?: { authorizeTeamRegistration?: boolean }): Promise<RegistrationSnapshot>;
    cancel(id: string): Promise<void>;
}

interface RegistrationManagerOptions {
    repositoryRoot?: string;
    discoverDevices?: () => Promise<Device[]>;
    loadDevices?: () => Promise<RegisteredDevice[]>;
    stateDirectory?: string;
    fetchImpl?: typeof fetch;
}

const checkNames: RegistrationCheckName[] = [
    'host', 'connection', 'signing', 'developer', 'wda', 'appium', 'video', 'touch', 'tiktok', 'accounts',
];

function now(): string {
    return new Date().toISOString();
}

function check(state: RegistrationCheckState, message: string): RegistrationCheck {
    return { state, message, updatedAt: now() };
}

function publicSnapshot(session: RegistrationSession): RegistrationSnapshot {
    const { passcode: _passcode, supervisor: _supervisor, ...snapshot } = session;
    return structuredClone(snapshot);
}

function normalizeAccounts(accounts: string[]): string[] {
    const normalized = accounts.map((value) => value.trim()).filter(Boolean).map((value) => value.startsWith('@') ? value : `@${value}`);
    return Array.from(new Set(normalized));
}

function sanitizedLine(line: string): string {
    return line
        .replace(/IOS_PASSCODE[^\s=]*=\S+/gi, 'IOS_PASSCODE=<redacted>')
        .replace(/(-?password\s*[=:]\s*)\S+/gi, '$1<redacted>')
        .slice(0, 1_000);
}

async function portAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.unref();
        server.once('error', () => resolve(false));
        server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
    });
}

export function allocateDevicePorts(devices: RegisteredDevice[], reserved: Array<{ wdaLocalPort: number; mjpegLocalPort: number }> = []): Promise<{ wdaLocalPort: number; mjpegLocalPort: number }> {
    return (async () => {
        const used = new Set<number>();
        for (const device of devices) {
            used.add(device.wdaLocalPort ?? 8100);
            used.add(device.mjpegLocalPort ?? 9100);
        }
        for (const pair of reserved) {
            used.add(pair.wdaLocalPort);
            used.add(pair.mjpegLocalPort);
        }
        for (let offset = 0; offset < 1_000; offset += 1) {
            const wdaLocalPort = 8100 + offset;
            const mjpegLocalPort = 9100 + offset;
            if (used.has(wdaLocalPort) || used.has(mjpegLocalPort)) continue;
            if (await portAvailable(wdaLocalPort) && await portAvailable(mjpegLocalPort)) {
                return { wdaLocalPort, mjpegLocalPort };
            }
        }
        throw new Error('No free WDA/MJPEG port pair is available');
    })();
}

export class DeviceRegistrationService implements DeviceRegistrationManager {
    private readonly workspaceRoot: string;
    private readonly packageRoot: string;
    private readonly discoverDevices: () => Promise<Device[]>;
    private readonly loadDevices: () => Promise<RegisteredDevice[]>;
    private readonly stateDirectory: string;
    private readonly fetch: typeof fetch;
    private readonly sessions = new Map<string, RegistrationSession>();
    private activePreparation?: string;

    constructor(options: RegistrationManagerOptions = {}) {
        this.workspaceRoot = options.repositoryRoot ?? process.cwd();
        this.packageRoot = fileURLToPath(new URL('../../', import.meta.url));
        this.discoverDevices = options.discoverDevices ?? discoverConnectedDevices;
        this.loadDevices = options.loadDevices ?? loadRegisteredDevices;
        this.stateDirectory = options.stateDirectory ?? path.join(this.workspaceRoot, '.wda/registrations');
        this.fetch = options.fetchImpl ?? fetch;
    }

    async start(): Promise<void> {
        await mkdir(this.stateDirectory, { recursive: true });
        for (const entry of await readdir(this.stateDirectory)) {
            if (!entry.endsWith('.json')) continue;
            try {
                const stored = JSON.parse(await readFile(path.join(this.stateDirectory, entry), 'utf8')) as RegistrationSnapshot & {
                    compatibleProfiles?: CoordinateProfile[];
                };
                if (!stored.finalized) {
                    const recommendedProfile = stored.recommendedProfile ?? profileForProductType(stored.device.productType);
                    const hasPasscode = Boolean(await passcodeForDevice(stored.id, { allowLegacyFallback: false }));
                    const restored: RegistrationSession & { compatibleProfiles?: CoordinateProfile[] } = {
                    ...stored,
                    availableProfiles: coordinateProfiles().map(({ name, displayName, screenSize }) => ({ name, displayName, screenSize })),
                    ...(recommendedProfile ? { recommendedProfile } : {}),
                    coordinateProfile: stored.coordinateProfile ?? recommendedProfile,
                    busy: false,
                    hasPasscode,
                    };
                    delete restored.compatibleProfiles;
                    this.sessions.set(stored.id, restored);
                }
            } catch {
                // Ignore an incomplete local draft and let the user start again.
            }
        }
    }

    async close(): Promise<void> {
        await Promise.all(Array.from(this.sessions.values(), (session) => this.stopSupervisor(session)));
    }

    async candidates(): Promise<Device[]> {
        const [connected, registered] = await Promise.all([this.discoverDevices(), this.loadDevices()]);
        const known = new Set(registered.map(({ udid }) => udid));
        return connected.filter(({ udid }) => !known.has(udid) || this.sessions.get(udid)?.finalized === false);
    }

    async create(udid: string): Promise<RegistrationSnapshot> {
        const existing = this.sessions.get(udid);
        if (existing) {
            await this.refresh(existing);
            existing.recommendedProfile ??= profileForProductType(existing.device.productType);
            if (!existing.coordinateProfile && existing.recommendedProfile) existing.coordinateProfile = existing.recommendedProfile;
            await this.persist(existing);
            return publicSnapshot(existing);
        }
        const candidate = (await this.candidates()).find((device) => device.udid === udid);
        if (!candidate) throw new Error('The selected device is not connected or is already registered');
        const ports = await allocateDevicePorts(await this.loadDevices(), Array.from(this.sessions.values()));
        const checks = Object.fromEntries(checkNames.map((name) => [name, check('pending', 'Not checked yet')])) as RegistrationSession['checks'];
        const session: RegistrationSession = {
            id: udid,
            device: candidate,
            name: candidate.name,
            availableProfiles: coordinateProfiles().map(({ name, displayName, screenSize }) => ({ name, displayName, screenSize })),
            recommendedProfile: profileForProductType(candidate.productType),
            coordinateProfile: profileForProductType(candidate.productType),
            ...ports,
            tiktokAccounts: [],
            hasPasscode: false,
            busy: false,
            checks,
            logs: [],
            canFinalize: false,
            finalized: false,
        };
        this.sessions.set(udid, session);
        await this.refresh(session);
        return publicSnapshot(session);
    }

    async get(id: string): Promise<RegistrationSnapshot | undefined> {
        const session = this.sessions.get(id);
        return session ? publicSnapshot(session) : undefined;
    }

    async update(id: string, input: RegistrationUpdate): Promise<RegistrationSnapshot> {
        const session = this.required(id);
        if (session.busy) throw new Error('Wait for the current registration check to finish');
        if (input.name !== undefined) {
            const name = input.name.trim();
            if (!name) throw new Error('Device name is required');
            session.name = name.slice(0, 100);
        }
        if (input.coordinateProfile !== undefined) {
            if (!session.availableProfiles.some(({ name }) => name === input.coordinateProfile)) {
                throw new Error('Unknown coordinate profile');
            }
            session.coordinateProfile = input.coordinateProfile as CoordinateProfile;
        }
        if (input.tiktokAccounts !== undefined) session.tiktokAccounts = normalizeAccounts(input.tiktokAccounts);
        if (input.passcode !== undefined) {
            if (input.passcode && !/^\d{4,}$/.test(input.passcode)) throw new Error('Device passcode must contain at least four digits');
            session.passcode = input.passcode || undefined;
            session.hasPasscode = Boolean(input.passcode);
        }
        session.checks.accounts = check('pending', 'Verify the configured TikTok accounts');
        this.recalculate(session);
        await this.persist(session);
        return publicSnapshot(session);
    }

    async run(id: string, action: RegistrationAction, options: { authorizeTeamRegistration?: boolean } = {}): Promise<RegistrationSnapshot> {
        const session = this.required(id);
        if (session.busy) throw new Error('A registration action is already running');
        if (action === 'prepare' && this.activePreparation && this.activePreparation !== id) {
            throw new Error('Another device is currently being provisioned by Xcode');
        }
        if (action === 'finalize') {
            session.busy = true;
            try {
                return await this.finalize(session);
            } finally {
                session.busy = false;
                await this.persist(session);
            }
        }
        if (action === 'prepare') this.activePreparation = id;
        session.busy = true;
        void (async () => {
            try {
                if (action === 'refresh') await this.refresh(session);
                if (action === 'prepare') await this.prepare(session, Boolean(options.authorizeTeamRegistration));
                if (action === 'verify') await this.verify(session);
            } catch (error) {
                this.log(session, error instanceof Error ? error.message : String(error));
            } finally {
                if (action === 'prepare' && this.activePreparation === id) this.activePreparation = undefined;
                session.busy = false;
                this.recalculate(session);
                await this.persist(session);
            }
        })();
        await this.persist(session);
        return publicSnapshot(session);
    }

    async cancel(id: string): Promise<void> {
        const session = this.required(id);
        await this.stopSupervisor(session);
        this.sessions.delete(id);
        await rm(this.statePath(id), { force: true });
    }

    private required(id: string): RegistrationSession {
        const session = this.sessions.get(id);
        if (!session) throw new Error('Registration draft not found');
        return session;
    }

    private async refresh(session: RegistrationSession): Promise<void> {
        session.checks.host = check('checking', 'Checking local iOS tooling');
        session.checks.connection = check('checking', 'Checking the USB device');
        const driverProject = path.resolve(this.workspaceRoot, process.env.XCUITEST_DRIVER_PATH
            ?? '.appium2/node_modules/appium-xcuitest-driver', 'node_modules/appium-webdriveragent/WebDriverAgent.xcodeproj');
        try {
            await Promise.all([access(driverProject), access(process.env.XCODE_DEVELOPER_DIR ?? '/Applications/Xcode_26.2.app/Contents/Developer')]);
            session.checks.host = check('passed', 'Xcode, XCUITest, and WebDriverAgent are available');
        } catch {
            session.checks.host = check('blocked', 'Install the repository XCUITest driver and configure XCODE_DEVELOPER_DIR');
        }
        const connected = (await this.discoverDevices()).find(({ udid }) => udid === session.device.udid);
        if (connected) {
            session.device = connected;
            session.recommendedProfile = profileForProductType(connected.productType);
            session.coordinateProfile ??= session.recommendedProfile;
            session.checks.connection = check('passed', `${connected.name} is connected, paired, and readable over USB`);
        } else {
            session.checks.connection = check('blocked', 'Reconnect USB, unlock the device, and accept Trust This Computer');
        }
        const signingValues = ['XCODE_ORG_ID', 'WDA_BUNDLE_ID'].filter((name) => !process.env[name]);
        session.checks.signing = signingValues.length
            ? check('blocked', `Configure ${signingValues.join(' and ')} in .env after signing in to Xcode`)
            : check('passed', 'Shared WDA signing settings are configured');
        await this.inspectWda(session);
        await this.inspectTikTok(session);
        await this.persist(session);
    }

    private async prepare(session: RegistrationSession, authorized: boolean): Promise<void> {
        if (session.checks.connection.state !== 'passed' || session.checks.host.state !== 'passed') {
            throw new Error('Connect and trust the device and complete host setup before preparing WDA');
        }
        session.checks.signing = check('checking', 'Building and provisioning WebDriverAgent');
        session.checks.developer = check('checking', 'Checking Developer Mode through an Xcode device build');
        session.checks.wda = check('checking', 'Preparing WebDriverAgent');
        const prepareScript = path.join(this.packageRoot, 'src/devices/wda/prepare.ts');
        const result = await this.runCommand(session, process.execPath, [
            '--env-file-if-exists=.env', '--env-file-if-exists=.env.devices', '--import', 'tsx', prepareScript,
        ], {
            ...process.env,
            IOS_UDID: session.device.udid,
            WDA_LOCAL_PORT: String(session.wdaLocalPort),
            MJPEG_LOCAL_PORT: String(session.mjpegLocalPort),
            ALLOW_PROVISIONING_DEVICE_REGISTRATION: String(authorized),
        });
        if (!result.ok) {
            const diagnosis = diagnoseWdaLaunchFailure(result.output) ?? 'WDA preparation failed; inspect the sanitized setup log';
            const target: RegistrationCheckName = /Developer Mode/i.test(diagnosis) ? 'developer' : 'signing';
            session.checks[target] = check('blocked', diagnosis);
            session.checks.wda = check('failed', diagnosis);
            return;
        }
        session.checks.signing = check('passed', 'Xcode signing and provisioning succeeded');
        session.checks.developer = check('passed', 'The device accepted an Xcode development build');
        await this.startSupervisor(session);
        const ready = await this.waitForEndpoint(`http://127.0.0.1:${session.wdaLocalPort}/status`, 120_000);
        if (!ready) {
            session.checks.wda = check('blocked', 'WDA did not become ready; unlock the phone and trust WebDriverAgent under VPN & Device Management if prompted');
            return;
        }
        session.checks.wda = check('passed', 'WebDriverAgent is installed, running, and reachable');
        await this.refreshScreenProfiles(session);
    }

    private async verify(session: RegistrationSession): Promise<void> {
        await this.inspectWda(session);
        if (session.checks.wda.state !== 'passed') throw new Error('Prepare and start WDA before runtime verification');
        if (!session.coordinateProfile) throw new Error('Choose a coordinate profile that matches the device screen');
        session.checks.appium = check('checking', 'Creating a no-reset Appium session');
        session.checks.video = check('checking', 'Reading the WDA video stream');
        session.checks.touch = check('checking', 'Checking mapped TikTok touch input');
        session.checks.accounts = check('checking', 'Verifying TikTok accounts with OCR');
        await this.inspectTikTok(session);
        if (session.checks.tiktok.state !== 'passed') return;
        const control = new WdaRemoteControl({
            deviceUdid: session.device.udid,
            wdaUrl: `http://127.0.0.1:${session.wdaLocalPort}`,
            mjpegUrl: `http://127.0.0.1:${session.mjpegLocalPort}`,
            passcode: session.passcode ?? await passcodeForDevice(session.device.udid, { allowLegacyFallback: false }),
            passcodeKeypadLayout: coordinatesForProfile(session.coordinateProfile).passcodeKeypad,
        });
        let driver: Browser | undefined;
        try {
            const appiumPort = Number(process.env.APPIUM_PORT ?? 4725);
            driver = await remote({
                hostname: process.env.APPIUM_HOST ?? '127.0.0.1',
                port: appiumPort,
                path: '/',
                logLevel: 'error',
                capabilities: {
                    platformName: 'iOS',
                    'appium:automationName': 'XCUITest',
                    'appium:udid': session.device.udid,
                    'appium:bundleId': process.env.TIKTOK_BUNDLE_ID ?? 'com.zhiliaoapp.musically',
                    'appium:noReset': true,
                    'appium:forceAppLaunch': true,
                    'appium:webDriverAgentUrl': `http://127.0.0.1:${session.wdaLocalPort}`,
                },
            });
            session.checks.appium = check('passed', 'Appium attached to WDA and launched TikTok without resetting it');
            const stream = await control.getMjpegStream(session.device.udid);
            const reader = stream.body!.getReader();
            const first = await reader.read();
            await reader.cancel();
            if (first.done || !first.value?.length) throw new Error('The WDA video stream returned no frames');
            session.checks.video = check('passed', 'WDA returned a live MJPEG frame');
            const coordinates = coordinatesForProfile(session.coordinateProfile).tiktok;
            const beforeTouch = await control.getScreenshot(session.device.udid);
            await tapCoordinate(driver, coordinates.profileTab.x, coordinates.profileTab.y, 'Profile tab readiness check');
            await driver.pause(1_000);
            const profileScreen = await control.getScreenshot(session.device.udid);
            if (profileScreen.equals(beforeTouch)) throw new Error('The Profile tap produced no visible screen change');
            await tapCoordinate(driver, coordinates.homeTab.x, coordinates.homeTab.y, 'Home tab readiness check');
            await driver.pause(1_000);
            const homeScreen = await control.getScreenshot(session.device.udid);
            if (homeScreen.equals(profileScreen)) throw new Error('The Home tap produced no visible screen change');
            session.checks.touch = check('passed', 'Profile and Home taps both produced visible screen changes');
            const accountCoordinates = {
                profileTabX: coordinates.profileTab.x,
                profileTabY: coordinates.profileTab.y,
                switcherTriggerX: coordinates.accountSwitcher.x,
                switcherTriggerY: coordinates.accountSwitcher.y,
            };
            if (session.tiktokAccounts.length) {
                for (const account of session.tiktokAccounts) {
                    await switchTikTokAccount(driver, control, session.device.udid, account, accountCoordinates);
                }
                session.checks.accounts = check('passed', `Verified ${session.tiktokAccounts.length} TikTok account${session.tiktokAccounts.length === 1 ? '' : 's'}`);
            } else {
                session.checks.accounts = check('passed', 'No TikTok accounts configured; add them later from the device workspace');
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log(session, message);
            if (session.checks.appium.state === 'checking') session.checks.appium = check('failed', message);
            else if (session.checks.video.state === 'checking') session.checks.video = check('failed', message);
            else if (session.checks.touch.state === 'checking') session.checks.touch = check('failed', message);
            else session.checks.accounts = check('blocked', message);
        } finally {
            if (driver) await driver.deleteSession().catch(() => undefined);
        }
    }

    private async finalize(session: RegistrationSession): Promise<RegistrationSnapshot> {
        this.recalculate(session);
        if (!session.canFinalize) throw new Error('Every live readiness check must pass before registration can finish');
        const alreadyRegistered = (await this.loadDevices()).some(({ udid }) => udid === session.device.udid);
        if (!alreadyRegistered) {
            const devices = await this.loadDevices();
            devices.push({
                name: session.name,
                udid: session.device.udid,
                coordinateProfile: session.coordinateProfile,
                wdaLocalPort: session.wdaLocalPort,
                mjpegLocalPort: session.mjpegLocalPort,
                ...(session.passcode ? { passcode: session.passcode } : {}),
                pluginData: {
                    'com.git-agni.tiktok': {
                        accounts: session.tiktokAccounts,
                        ...(session.coordinateProfile ? { coordinateProfile: session.coordinateProfile } : {}),
                    },
                },
            });
            await saveRegisteredDevices(devices);
        } else if (session.passcode) {
            await setDevicePasscode(session.device.udid, session.passcode);
        }
        session.checks.wda = check('checking', 'Handing WDA ownership to the persistent fleet service');
        await this.stopSupervisor(session);
        if (!(await this.waitForEndpoint(`http://127.0.0.1:${session.wdaLocalPort}/status`, 30_000))) {
            session.checks.wda = check('blocked', 'The device is saved, but the fleet WDA service is not ready yet; recheck and finish again');
            this.recalculate(session);
            await this.persist(session);
            return publicSnapshot(session);
        }
        session.checks.wda = check('passed', 'Persistent fleet WDA is ready');
        session.finalized = true;
        this.recalculate(session);
        await this.persist(session);
        return publicSnapshot(session);
    }

    private async inspectWda(session: RegistrationSession): Promise<void> {
        const ready = await this.waitForEndpoint(`http://127.0.0.1:${session.wdaLocalPort}/status`, 5_000);
        session.checks.wda = ready ? check('passed', 'WebDriverAgent is reachable') : check('pending', 'Prepare WebDriverAgent for this device');
        if (ready) await this.refreshScreenProfiles(session);
    }

    private async refreshScreenProfiles(session: RegistrationSession): Promise<void> {
        try {
            const remoteControl = new WdaRemoteControl({
                deviceUdid: session.device.udid,
                wdaUrl: `http://127.0.0.1:${session.wdaLocalPort}`,
            });
            const { screenSize } = await remoteControl.getScreenInfo(session.device.udid);
            const matching = session.availableProfiles.filter((profile) => profile.screenSize.width === screenSize.width && profile.screenSize.height === screenSize.height);
            if (!session.coordinateProfile && matching.length === 1) session.coordinateProfile = matching[0]!.name;
            const selected = session.availableProfiles.find(({ name }) => name === session.coordinateProfile);
            if (selected && (selected.screenSize.width !== screenSize.width || selected.screenSize.height !== screenSize.height)) {
                session.checks.touch = check('pending', `Manual override: ${selected.displayName} targets ${selected.screenSize.width} × ${selected.screenSize.height}, while WDA reports ${screenSize.width} × ${screenSize.height}; live touch verification is required`);
            }
        } catch (error) {
            this.log(session, error instanceof Error ? error.message : String(error));
        }
    }

    private async inspectTikTok(session: RegistrationSession): Promise<void> {
        if (session.checks.connection.state !== 'passed') {
            session.checks.tiktok = check('pending', 'Connect the device before checking TikTok');
            return;
        }
        try {
            const require = createRequire(import.meta.url);
            const { services } = require('appium-ios-device') as {
                services: { startInstallationProxyService(udid: string): Promise<{ lookupApplications(options: { bundleIds: string[] }): Promise<Record<string, unknown>>; close(): void }> };
            };
            const client = await services.startInstallationProxyService(session.device.udid);
            try {
                const bundleId = process.env.TIKTOK_BUNDLE_ID ?? 'com.zhiliaoapp.musically';
                const apps = await client.lookupApplications({ bundleIds: [bundleId] });
                session.checks.tiktok = apps[bundleId]
                    ? check('passed', `TikTok (${bundleId}) is installed`)
                    : check('blocked', 'Install TikTok from the App Store, sign in, then recheck');
            } finally {
                client.close();
            }
        } catch (error) {
            session.checks.tiktok = check('blocked', `Unlock and trust the device to inspect installed apps: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async startSupervisor(session: RegistrationSession): Promise<void> {
        await this.stopSupervisor(session);
        const script = path.join(this.packageRoot, 'src/devices/wda/start.ts');
        const child = spawn(process.execPath, [
            '--env-file-if-exists=.env', '--env-file-if-exists=.env.devices', '--import', 'tsx', script,
        ], {
            cwd: this.workspaceRoot,
            env: {
                ...process.env,
                IOS_UDID: session.device.udid,
                WDA_LOCAL_PORT: String(session.wdaLocalPort),
                MJPEG_LOCAL_PORT: String(session.mjpegLocalPort),
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        session.supervisor = child;
        const append = (chunk: Buffer) => {
            for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) this.log(session, line);
        };
        child.stdout?.on('data', append);
        child.stderr?.on('data', append);
        child.once('exit', () => { if (session.supervisor === child) session.supervisor = undefined; });
    }

    private async stopSupervisor(session: RegistrationSession): Promise<void> {
        const child = session.supervisor;
        session.supervisor = undefined;
        if (!child || child.exitCode !== null || child.killed) return;
        child.kill('SIGTERM');
        await Promise.race([
            new Promise<void>((resolve) => child.once('exit', () => resolve())),
            new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
        ]);
        if (child.exitCode === null) child.kill('SIGKILL');
    }

    private async runCommand(session: RegistrationSession, command: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ ok: boolean; output: string }> {
        return new Promise((resolve) => {
            const child = spawn(command, args, { cwd: this.workspaceRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
            let output = '';
            const append = (chunk: Buffer) => {
                const value = chunk.toString();
                output = `${output}${value}`.slice(-100_000);
                for (const line of value.split(/\r?\n/).filter(Boolean)) this.log(session, line);
            };
            child.stdout.on('data', append);
            child.stderr.on('data', append);
            child.once('error', (error) => resolve({ ok: false, output: `${output}\n${error.message}` }));
            child.once('exit', (code) => resolve({ ok: code === 0, output }));
        });
    }

    private async endpointReady(url: string): Promise<boolean> {
        try {
            const response = await this.fetch(url, { signal: AbortSignal.timeout(2_000) });
            return response.ok;
        } catch {
            return false;
        }
    }

    private async waitForEndpoint(url: string, timeoutMs: number): Promise<boolean> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (await this.endpointReady(url)) return true;
            await new Promise((resolve) => setTimeout(resolve, 2_000));
        }
        return false;
    }

    private recalculate(session: RegistrationSession): void {
        session.canFinalize = checkNames.every((name) => session.checks[name].state === 'passed')
            && Boolean(session.name && session.coordinateProfile);
    }

    private log(session: RegistrationSession, value: string): void {
        const line = sanitizedLine(value.trim());
        if (!line) return;
        session.logs.push(line);
        session.logs = session.logs.slice(-100);
    }

    private statePath(id: string): string {
        return path.join(this.stateDirectory, `${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
    }

    private async persist(session: RegistrationSession): Promise<void> {
        await mkdir(this.stateDirectory, { recursive: true });
        const target = this.statePath(session.id);
        const temporary = `${target}.${process.pid}.tmp`;
        await writeFile(temporary, `${JSON.stringify(publicSnapshot(session), null, 2)}\n`, { mode: 0o600 });
        await rename(temporary, target);
    }
}
