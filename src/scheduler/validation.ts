import type { PluginRegistry } from '../registry.js';
import type { CreateTaskInput, JsonObject, TaskEnvelope } from '../types.js';
import { validateTiming } from './recurrence.js';

export const DEFAULT_MIN_SCHEDULE_GAP_MINUTES = 10;
export interface TaskWindow { start: Date; end: Date }

export function estimatedTaskWindow(registry: PluginRegistry, task: TaskEnvelope, start: Date): TaskWindow {
    const duration = Math.max(0, registry.task(task).estimateDurationMs(task.payload));
    return { start, end: new Date(start.getTime() + duration) };
}

export function windowsTooClose(a: TaskWindow, b: TaskWindow, minGapMinutes: number): boolean {
    const gap = minGapMinutes * 60_000;
    return !(a.end.getTime() + gap <= b.start.getTime() || b.end.getTime() + gap <= a.start.getTime());
}

export function validateTaskInput(
    registry: PluginRegistry, input: CreateTaskInput, devicePluginData: JsonObject = {}, now = new Date(),
): CreateTaskInput {
    validateTiming(input.timing, now);
    return registry.validate(input, devicePluginData);
}
