import { createRequire } from 'node:module';

import { modelNameForProductType } from './coordinates.js';

const require = createRequire(import.meta.url);
interface IosUtilities {
    getConnectedDevices(): Promise<string[]>;
    getDeviceName(udid: string): Promise<string>;
    getOSVersion(udid: string): Promise<string>;
    getDeviceInfo(udid: string): Promise<{ ProductType?: string; HardwareModel?: string }>;
}
const { utilities } = require('appium-ios-device') as { utilities: IosUtilities };

export interface Device {
    name: string;
    osVersion: string;
    udid: string;
    productType?: string;
    hardwareModel?: string;
    modelName?: string;
}

export async function discoverConnectedDevices(): Promise<Device[]> {
    const udids = await discoverConnectedDeviceUdids();
    return Promise.all(udids.map(async (udid) => {
        const [name, osVersion, info] = await Promise.all([
            utilities.getDeviceName(udid), utilities.getOSVersion(udid), utilities.getDeviceInfo(udid),
        ]);
        const modelName = modelNameForProductType(info.ProductType);
        return {
            name, osVersion, udid,
            ...(info.ProductType ? { productType: info.ProductType } : {}),
            ...(info.HardwareModel ? { hardwareModel: info.HardwareModel } : {}),
            ...(modelName ? { modelName } : {}),
        };
    }));
}

export async function discoverConnectedDeviceUdids(): Promise<string[]> {
    return utilities.getConnectedDevices();
}
