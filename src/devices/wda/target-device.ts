import { discoverConnectedDeviceUdids } from '../discovery.js';
import { loadRegisteredDevices } from '../registry.js';

export interface ResolveTargetOptions {
    /** Defaults to `process.argv`. */
    argv?: readonly string[];
    /** Defaults to `process.env`. */
    env?: NodeJS.ProcessEnv;
    /** Injectable for tests. Defaults to reading `devices.json`. */
    loadRegistered?: () => Promise<Array<{ udid: string; name: string }>>;
    /** Injectable for tests. Defaults to a USB scan. */
    loadConnected?: () => Promise<string[]>;
}

function udidFromArgv(argv: readonly string[]): string | undefined {
    const flag = argv.indexOf('--udid');
    if (flag >= 0) {
        const value = argv[flag + 1];
        if (!value || value.startsWith('-')) throw new Error('--udid needs a device UDID');
        return value;
    }
    const inline = argv.find((entry) => entry.startsWith('--udid='));
    return inline ? inline.slice('--udid='.length) : undefined;
}

/**
 * Which device a WDA CLI command (`wda:prepare`, `wda:start`) should target, in
 * priority order:
 *
 *   1. `--udid <udid>` (or `--udid=<udid>`) on the command line
 *   2. `IOS_UDID` in the environment — kept for back-compat, no longer required
 *   3. the only device in `devices.json`
 *   4. the only iPhone currently connected by USB
 *
 * Anything ambiguous (several registered or connected devices) or empty throws
 * with a message that names the options.
 */
export async function resolveTargetUdid(options: ResolveTargetOptions = {}): Promise<string> {
    const argv = options.argv ?? process.argv;
    const env = options.env ?? process.env;
    const loadRegistered = options.loadRegistered ?? (() => loadRegisteredDevices());
    const loadConnected = options.loadConnected ?? discoverConnectedDeviceUdids;

    const fromArgv = udidFromArgv(argv);
    if (fromArgv) return fromArgv;

    if (env.IOS_UDID) return env.IOS_UDID;

    const registered = await loadRegistered();
    if (registered.length === 1) return registered[0]!.udid;
    if (registered.length > 1) {
        throw new Error(
            `devices.json has ${registered.length} devices — pass --udid <udid>. Registered: `
            + registered.map(({ udid, name }) => `${udid} (${name})`).join(', '),
        );
    }

    const connected = await loadConnected();
    if (connected.length === 1) return connected[0]!;
    if (connected.length > 1) {
        throw new Error(`${connected.length} devices are connected — pass --udid <udid>: ${connected.join(', ')}`);
    }

    throw new Error(
        'No target device. Connect an iPhone, register one in the dashboard, '
        + 'or pass --udid <udid> (xcrun xctrace list devices).',
    );
}

/** Every device to build WDA for: all of `devices.json` with `--all`, otherwise a single resolved target. */
export async function resolveBuildTargets(options: ResolveTargetOptions = {}): Promise<string[]> {
    const argv = options.argv ?? process.argv;
    if (argv.includes('--all')) {
        const loadRegistered = options.loadRegistered ?? (() => loadRegisteredDevices());
        const registered = await loadRegistered();
        if (registered.length === 0) throw new Error('--all was given but devices.json has no devices');
        return registered.map(({ udid }) => udid);
    }
    return [await resolveTargetUdid(options)];
}
