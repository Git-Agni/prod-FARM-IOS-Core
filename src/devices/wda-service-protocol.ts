import path from 'node:path';

import type { DeviceConnectionStatus } from './connection-manager.js';

export interface WdaServiceDevicesResponse {
    devices: DeviceConnectionStatus[];
}

export interface WdaServiceHealthResponse extends WdaServiceDevicesResponse {
    status: 'ok' | 'starting';
}

export interface WdaServiceErrorResponse {
    error: string;
}

export function wdaServiceSocketPath(): string {
    return path.resolve(process.env.WDA_SERVICE_SOCKET ?? '.wda/wda-service.sock');
}
