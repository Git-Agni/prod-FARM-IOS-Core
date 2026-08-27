import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { coordinatesForProfile, validateCoordinateOverrides, type DeviceCoordinateOverrides, type DeviceProfileName } from './coordinates.js';
import type { JsonObject } from '../types.js';

export interface RegisteredDevice {
    name: string;
    udid: string;
    coordinateProfile?: DeviceProfileName;
    wdaLocalPort?: number;
    mjpegLocalPort?: number;
    /** Device unlock passcode. Lives here (devices.json is 0600 and git-ignored), never in an API response. */
    passcode?: string;
    /** Per-device single-tap coordinate overrides (dashboard calibration). */
    coordinates?: DeviceCoordinateOverrides;
    pluginData: Record<string, JsonObject>;
}

export const PASSCODE_PATTERN = /^\d{4,}$/;

/** A device with its passcode removed and a boolean marker in its place — safe to serialize. */
export function redactDevice<T extends { passcode?: string }>(device: T): Omit<T, 'passcode'> & { hasPasscode: boolean } {
    const { passcode, ...rest } = device;
    return { ...rest, hasPasscode: Boolean(passcode) };
}

const defaultRegistryPath = path.resolve(process.env.DEVICES_CONFIG_PATH ?? 'devices.json');

export async function loadRegisteredDevices(registryPath = defaultRegistryPath): Promise<RegisteredDevice[]> {
    let raw: string;
    try {
        raw = await readFile(registryPath, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
    }
    let devices: RegisteredDevice[];
    try {
        devices = JSON.parse(raw) as RegisteredDevice[];
    } catch (error) {
        throw new Error(`${registryPath} contains invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    for (const device of devices) {
        coordinatesForProfile(device.coordinateProfile);
        device.pluginData ??= {};
    }
    return devices;
}

export async function saveRegisteredDevices(devices: RegisteredDevice[], registryPath = defaultRegistryPath): Promise<void> {
    const unique = new Set<string>();
    for (const device of devices) {
        coordinatesForProfile(device.coordinateProfile);
        if (device.passcode !== undefined && !PASSCODE_PATTERN.test(device.passcode)) {
            throw new Error(`Device ${device.udid} passcode must contain at least four digits`);
        }
        if (device.coordinates !== undefined) {
            device.coordinates = validateCoordinateOverrides(device.coordinates, device.coordinateProfile);
            if (Object.keys(device.coordinates).length === 0) delete device.coordinates;
        }
        if (unique.has(device.udid)) throw new Error(`Device ${device.udid} is already registered`);
        unique.add(device.udid);
    }
    await mkdir(path.dirname(registryPath), { recursive: true });
    const temporaryPath = `${registryPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(devices, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, registryPath);
}
