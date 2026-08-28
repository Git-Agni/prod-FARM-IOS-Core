import type { JsonObject, RegisteredDevice } from '@git-agni/phone-farm-core';

export const TIKTOK_PLUGIN_ID = 'com.git-agni.tiktok';

function settings(device: RegisteredDevice | undefined): JsonObject {
    return device?.pluginData[TIKTOK_PLUGIN_ID] ?? {};
}

export function coordinateProfile(device: RegisteredDevice | undefined): string {
    // The top-level devices.json field is canonical (what the dashboard and
    // resolveDeviceCoordinates use); the pluginData copy is a legacy fallback.
    if (typeof device?.coordinateProfile === 'string') return device.coordinateProfile;
    const legacy = settings(device).coordinateProfile;
    return typeof legacy === 'string' ? legacy : 'iphone8';
}

export function registeredAccounts(device: RegisteredDevice | undefined): string[] {
    const value = settings(device).accounts;
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}
