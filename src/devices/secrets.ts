import { loadRegisteredDevices, saveRegisteredDevices, PASSCODE_PATTERN } from './registry.js';

/** Legacy env var name for a device's passcode — read as a fallback only. */
export function passcodeEnvironmentKey(udid: string): string {
    return `IOS_PASSCODE_${udid.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

let warnedLegacyEnv = false;

/**
 * A device's unlock passcode, from `devices.json`. `IOS_PASSCODE_<UDID>` and
 * `IOS_PASSCODE` in the environment are still honored as a deprecated fallback
 * (with a one-time warning) so existing `.env` setups keep working.
 */
export async function passcodeForDevice(
    udid: string,
    { allowLegacyFallback = true }: { allowLegacyFallback?: boolean } = {},
): Promise<string | undefined> {
    const device = (await loadRegisteredDevices()).find((entry) => entry.udid === udid);
    if (device?.passcode) return device.passcode;
    if (!allowLegacyFallback) return undefined;

    const legacy = process.env[passcodeEnvironmentKey(udid)] ?? process.env.IOS_PASSCODE;
    if (legacy && !warnedLegacyEnv) {
        warnedLegacyEnv = true;
        console.warn('[secrets] reading a device passcode from the environment is deprecated — '
            + 'move it into devices.json as "passcode" on the device entry.');
    }
    return legacy || undefined;
}

/** Set (or replace) a registered device's passcode in `devices.json`. */
export async function setDevicePasscode(udid: string, passcode: string): Promise<void> {
    if (!PASSCODE_PATTERN.test(passcode)) throw new Error('Device passcode must contain at least four digits');
    const devices = await loadRegisteredDevices();
    const device = devices.find((entry) => entry.udid === udid);
    if (!device) throw new Error(`Device ${udid} is not registered`);
    device.passcode = passcode;
    await saveRegisteredDevices(devices);
}
