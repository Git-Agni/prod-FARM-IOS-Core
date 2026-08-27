export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface DeviceIdentity {
    udid: string;
    name: string;
    osVersion?: string;
    productType?: string;
}

export interface RegisteredDevice extends DeviceIdentity {
    wdaLocalPort?: number;
    mjpegLocalPort?: number;
    pluginData: Record<string, JsonObject>;
}

export type ScheduleTiming =
    | { kind: 'now' }
    | { kind: 'once'; runAt: string }
    | { kind: 'daily'; localTime: string; timezone: string }
    | { kind: 'weekly'; localTime: string; timezone: string; weekdays: number[] };

export interface TaskEnvelope<TPayload extends JsonObject = JsonObject> {
    pluginId: string;
    taskType: string;
    taskVersion: number;
    payload: TPayload;
}

export interface CreateTaskInput<TPayload extends JsonObject = JsonObject> {
    deviceUdid: string;
    task: TaskEnvelope<TPayload>;
    timing: ScheduleTiming;
    runWindowMinutes?: number;
}

export interface StoredAsset {
    id: string;
    path: string;
    name: string;
    mimeType: string;
    size: number;
    sha256: string;
}

export interface TaskExecutionResult {
    exitCode: number | null;
    stopped: boolean;
    error?: string;
}

export interface TaskRetryPolicy {
    retryLimit: number;
    retryDelaySeconds: number;
    retryBackoff: boolean;
}
