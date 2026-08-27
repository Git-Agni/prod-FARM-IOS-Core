import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type {
    DeviceIdentity,
    JsonObject,
    JsonValue,
    StoredAsset,
    TaskExecutionResult,
    TaskRetryPolicy,
} from './types.js';
import type { SchedulerRepository } from './scheduler/repository.js';
import type { RegisteredDevice } from './devices/registry.js';
import type { RemoteControl } from './devices/wda-remote.js';

export interface DeviceAutomation {
    activateApp(bundleId: string): Promise<void>;
    terminateApp(bundleId: string): Promise<void>;
    pause(milliseconds: number, signal?: AbortSignal): Promise<void>;
    screenshot(): Promise<Buffer>;
    tap(x: number, y: number): Promise<void>;
    swipe(startX: number, startY: number, endX: number, endY: number, durationMs: number): Promise<void>;
}

export interface TaskValidationContext {
    timingKind: 'now' | 'once' | 'daily' | 'weekly';
    devicePluginData: JsonObject;
}

export interface TaskExecutionContext {
    executionId: string;
    attempt: number;
    workspaceDirectory: string;
    device: DeviceIdentity;
    devicePluginData: JsonObject;
    automation: DeviceAutomation;
    assets: StoredAsset[];
    signal: AbortSignal;
    log(line: string): Promise<void>;
    runProcess(specification: PluginProcessSpecification): Promise<TaskExecutionResult>;
}

export interface PluginProcessSpecification {
    entrypoint: string;
    args?: string[];
    env?: Record<string, string>;
}

export interface TaskDefinition<TPayload extends JsonObject = JsonObject> {
    type: string;
    version: number;
    displayName: string;
    validate(payload: JsonValue, context: TaskValidationContext): TPayload;
    summarize(payload: TPayload): string;
    estimateDurationMs(payload: TPayload): number;
    retryPolicy(payload: TPayload): TaskRetryPolicy;
    supportsStop(payload: TPayload): boolean;
    execute(context: TaskExecutionContext, payload: TPayload): Promise<TaskExecutionResult>;
}

export interface RegistrationCheckResult {
    status: 'passed' | 'blocked' | 'failed';
    message: string;
}

export interface RegistrationCheck {
    id: string;
    displayName: string;
    run(device: DeviceIdentity, pluginData: JsonObject): Promise<RegistrationCheckResult>;
}

export interface DevicePanel {
    id: string;
    title: string;
    fragmentPath: string;
    scriptPath?: string;
    order?: number;
}

export interface WdaExtension {
    id: string;
    patchFiles: Array<{ path: string; sha256: string }>;
}

export interface PluginRouteContext {
    app: FastifyInstance;
    routePrefix: string;
    scheduler: SchedulerRepository;
    remote: RemoteControl;
    loadDevices(): Promise<RegisteredDevice[]>;
    saveDevices(devices: RegisteredDevice[]): Promise<void>;
    renderActivity(deviceUdid: string, message?: string): Promise<string>;
}

export interface PhoneFarmPlugin {
    id: string;
    version: string;
    displayName: string;
    tasks: readonly TaskDefinition[];
    devicePanels?: readonly DevicePanel[];
    registrationChecks?: readonly RegistrationCheck[];
    wdaExtensions?: readonly WdaExtension[];
    registerRoutes?(context: PluginRouteContext): Promise<void> | void;
}

export interface AuthenticatedUser {
    id: string;
    email?: string;
    roles: string[];
}

export interface AuthProvider {
    id: string;
    registerRoutes(app: FastifyInstance): Promise<void> | void;
    authenticate(request: FastifyRequest, reply: FastifyReply): Promise<AuthenticatedUser | null>;
    isPublicPath(path: string): boolean;
}
