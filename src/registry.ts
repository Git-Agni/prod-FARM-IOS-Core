import type { PhoneFarmPlugin, TaskDefinition } from './plugin.js';
import type { CreateTaskInput, JsonObject, TaskEnvelope } from './types.js';

export class PluginRegistry {
    private readonly plugins = new Map<string, PhoneFarmPlugin>();
    private readonly tasks = new Map<string, TaskDefinition>();

    constructor(plugins: readonly PhoneFarmPlugin[] = []) {
        for (const plugin of plugins) this.register(plugin);
    }

    register(plugin: PhoneFarmPlugin): void {
        assertIdentifier(plugin.id, 'plugin ID');
        if (this.plugins.has(plugin.id)) throw new Error(`Plugin ${plugin.id} is already registered`);
        for (const task of plugin.tasks) {
            assertIdentifier(task.type, 'task type');
            if (!Number.isInteger(task.version) || task.version < 1) {
                throw new Error(`${plugin.id}/${task.type} must use a positive integer version`);
            }
            const key = taskKey(plugin.id, task.type, task.version);
            if (this.tasks.has(key)) throw new Error(`Task ${key} is already registered`);
            this.tasks.set(key, task);
        }
        this.plugins.set(plugin.id, plugin);
    }

    list(): PhoneFarmPlugin[] {
        return [...this.plugins.values()];
    }

    plugin(id: string): PhoneFarmPlugin {
        const plugin = this.plugins.get(id);
        if (!plugin) throw new Error(`Plugin ${id} is unavailable`);
        return plugin;
    }

    task<TPayload extends JsonObject = JsonObject>(envelope: TaskEnvelope<TPayload>): TaskDefinition<TPayload> {
        const definition = this.tasks.get(taskKey(envelope.pluginId, envelope.taskType, envelope.taskVersion));
        if (!definition) {
            throw new Error(`Task ${envelope.pluginId}/${envelope.taskType}@${envelope.taskVersion} is unavailable`);
        }
        return definition as TaskDefinition<TPayload>;
    }

    validate(input: CreateTaskInput, devicePluginData: JsonObject = {}): CreateTaskInput {
        if (!input.deviceUdid || input.deviceUdid.length > 128) throw new Error('A device UDID is required');
        const runWindow = input.runWindowMinutes ?? 30;
        if (!Number.isInteger(runWindow) || runWindow < 1 || runWindow > 1440) {
            throw new Error('runWindowMinutes must be between 1 and 1440');
        }
        const definition = this.task(input.task);
        const payload = definition.validate(input.task.payload, {
            timingKind: input.timing.kind,
            devicePluginData,
        });
        return { ...input, task: { ...input.task, payload } };
    }
}

function taskKey(pluginId: string, taskType: string, taskVersion: number): string {
    return `${pluginId}/${taskType}@${taskVersion}`;
}

function assertIdentifier(value: string, label: string): void {
    if (!/^[a-z][a-z0-9.-]*$/.test(value)) {
        throw new Error(`${label} must contain lowercase letters, numbers, periods, and hyphens`);
    }
}
