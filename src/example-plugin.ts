import type { PhoneFarmPlugin, TaskDefinition } from './plugin.js';
import type { JsonObject, JsonValue } from './types.js';

interface OpenAppPayload extends JsonObject {
    bundleId: string;
    waitSeconds: number;
}

const openAppTask: TaskDefinition<OpenAppPayload> = {
    type: 'open-app',
    version: 1,
    displayName: 'Open an installed app',
    validate(value: JsonValue): OpenAppPayload {
        if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Payload must be an object');
        const bundleId = value.bundleId;
        const waitSeconds = value.waitSeconds;
        if (typeof bundleId !== 'string' || !/^[A-Za-z0-9.-]{3,255}$/.test(bundleId)) {
            throw new Error('bundleId must be a valid application identifier');
        }
        if (!Number.isInteger(waitSeconds) || typeof waitSeconds !== 'number' || waitSeconds < 1 || waitSeconds > 300) {
            throw new Error('waitSeconds must be an integer between 1 and 300');
        }
        return { bundleId, waitSeconds };
    },
    summarize: (payload) => `Open ${payload.bundleId} for ${payload.waitSeconds} seconds`,
    estimateDurationMs: (payload) => payload.waitSeconds * 1_000,
    retryPolicy: () => ({ retryLimit: 1, retryDelaySeconds: 30, retryBackoff: false }),
    supportsStop: () => true,
    async execute(context, payload) {
        try {
            await context.log(`Opening ${payload.bundleId}`);
            await context.automation.activateApp(payload.bundleId);
            await context.automation.pause(payload.waitSeconds * 1_000, context.signal);
            return { exitCode: 0, stopped: context.signal.aborted };
        } catch (error) {
            if (context.signal.aborted) return { exitCode: null, stopped: true };
            return { exitCode: null, stopped: false, error: error instanceof Error ? error.message : String(error) };
        }
    },
};

export const examplePlugin: PhoneFarmPlugin = {
    id: 'org.phone-farm.example',
    version: '0.1.0',
    displayName: 'Example app launcher',
    tasks: [openAppTask],
};

export default examplePlugin;
