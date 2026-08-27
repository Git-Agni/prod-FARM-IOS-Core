import type { JsonObject, RegisteredDevice } from '@git-agni/phone-farm-core';

export const TIKTOK_PLUGIN_ID = 'com.git-agni.tiktok';

function settings(device: RegisteredDevice | undefined): JsonObject {
    return device?.pluginData[TIKTOK_PLUGIN_ID] ?? {};
}

export function coordinateProfile(device: RegisteredDevice | undefined): string {
    const value = settings(device).coordinateProfile;
    return typeof value === 'string' ? value : 'iphone8';
}

export function registeredAccounts(device: RegisteredDevice | undefined): string[] {
    const value = settings(device).accounts;
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}
