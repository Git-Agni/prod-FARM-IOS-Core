# Extending Phone Farm with plugins

A plugin adds **versioned automation tasks** — and optionally device‑page
panels, registration checks, HTTP routes, and declared WDA patches — without
touching core routing or the scheduler.

Read [`PLUGIN_DEVELOPMENT.md`](../PLUGIN_DEVELOPMENT.md) for the trust and
compatibility rules. This document is the how‑to.

## The contract

Everything is in `src/plugin.ts`. A plugin is a plain object:

```ts
import type { PhoneFarmPlugin } from '@git-agni/phone-farm-core';

const plugin: PhoneFarmPlugin = {
    id: 'com.acme.instagram',   // reverse-DNS, stable forever
    version: '1.0.0',           // package version, informational
    displayName: 'Instagram',
    tasks: [ /* TaskDefinition[] */ ],
    devicePanels: [],           // optional
    registrationChecks: [],     // optional
    wdaExtensions: [],           // optional
    registerRoutes(ctx) {},     // optional
};
export default plugin;
```

It is loaded by setting `PHONE_FARM_PLUGINS` to a comma‑separated list of ESM
package names. `loadPlugins()` imports each and expects a `default` (or
`plugin`) export with an `id` and a `tasks` array.

> **`web` and `worker` must be given the identical plugin set and versions.**
> `web` validates payloads and renders panels; `worker` executes. A mismatch
> means schedules that can be created but not run, or vice versa.

## A task definition

```ts
import type { TaskDefinition } from '@git-agni/phone-farm-core';

interface LikePayload extends Record<string, unknown> {
    count: number;
    account?: string;
}

export const likeTask: TaskDefinition<LikePayload> = {
    type: 'like-feed',
    version: 1,                       // positive integer; frozen once shipped
    displayName: 'Like N posts in the feed',

    // Validate UNTRUSTED json. Throw a clear message on anything unexpected.
    // The returned object is what gets persisted and later handed to execute().
    validate(payload, ctx) {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            throw new Error('Payload must be an object');
        }
        const count = (payload as any).count;
        if (!Number.isInteger(count) || count < 1 || count > 100) {
            throw new Error('count must be 1–100');
        }
        const account = (payload as any).account;
        if (account !== undefined && typeof account !== 'string') {
            throw new Error('account must be a string');
        }
        return account ? { count, account } : { count };
    },

    summarize: (p) => `Like ${p.count} posts`,
    estimateDurationMs: (p) => p.count * 4_000,
    retryPolicy: () => ({ retryLimit: 2, retryDelaySeconds: 60, retryBackoff: true }),
    supportsStop: () => true,

    async execute(context, payload) {
        // Option A: drive the phone inline with the safe primitives.
        await context.log(`Liking ${payload.count} posts`);
        await context.automation.activateApp('com.burbn.instagram');
        for (let i = 0; i < payload.count; i++) {
            if (context.signal.aborted) return { exitCode: null, stopped: true };
            await context.automation.tap(280, 620);
            await context.automation.swipe(200, 600, 200, 200, 400);
            await context.automation.pause(3_000, context.signal);
        }
        return { exitCode: 0, stopped: false };

        // Option B: hand off to a subprocess (webdriverio, OCR, ffmpeg …).
        // return context.runProcess({
        //     entrypoint: fileURLToPath(new URL('./like-feed.ts', import.meta.url)),
        //     env: { LIKE_COUNT: String(payload.count) },
        // });
    },
};
```

### The execution context

`execute(context, payload)` receives (`TaskExecutionContext`):

| Field | Use |
| --- | --- |
| `executionId`, `attempt` | Identity / retry number |
| `device` | `{ udid, name, osVersion?, productType? }` |
| `devicePluginData` | `devices.json` → `pluginData[yourPluginId]` for this device |
| `automation` | `activateApp`, `terminateApp`, `pause(ms, signal)`, `screenshot`, `tap(x,y)`, `swipe(x1,y1,x2,y2,ms)` — points, via WDA |
| `assets` | `StoredAsset[]` — uploaded files for this task, already on disk (`asset.path`) |
| `workspaceDirectory` | Private temp dir, deleted after the run |
| `signal` | `AbortSignal` — fires on stop request or deadline. **Check it and return `{ stopped: true }` promptly.** |
| `log(line)` | Append one line to the durable execution log |
| `runProcess(spec)` | Spawn `node --import tsx <entrypoint>`; stdout/stderr stream into the execution log; killed on abort. Returns `{ exitCode, stopped, error? }` |

`execute` returns `TaskExecutionResult`: `{ exitCode: number | null, stopped:
boolean, error?: string }`. `exitCode === 0 && !error` is success.

## Versioning (the one rule that matters)

`taskType` + `taskVersion` are a frozen contract. Once schedules exist for
`like-feed@1`:

- **Never** change what `like-feed@1` validates or does.
- To evolve it, ship `like-feed@2` as a second `TaskDefinition` in the same
  plugin, keep `@1` installed while old schedules reference it, and migrate
  those schedules explicitly (update `task_version` + transform `payload`).
- `web` and `worker` roll forward together.

## Per‑device configuration

Store non‑secret, device‑specific settings under
`device.pluginData["<your.plugin.id>"]` in `devices.json`. It is delivered to
`validate()` (as `ctx.devicePluginData`) and `execute()` (as
`context.devicePluginData`). Update it with `PATCH /api/devices/:udid` or,
from a plugin route, `ctx.saveDevices()`.

**Secrets** (tokens, passwords) go in the environment / your secret store —
never in `pluginData`, task summaries, logs, or HTML.

## Optional surfaces

### Device panels
```ts
devicePanels: [{
    id: 'instagram-controls',
    title: 'Instagram',
    fragmentPath: fileURLToPath(new URL('./panel.html', import.meta.url)),
    scriptPath: fileURLToPath(new URL('./panel.js', import.meta.url)), // optional
    order: 10,
}]
```
The fragment HTML is injected into the device page inside a `<section
class="card">`, served **inside the authenticated host**. Panel HTML is
trusted code — review it like server code, escape any device/user values, and
don't load remote scripts.

### Registration checks
```ts
registrationChecks: [{
    id: 'ig-logged-in',
    displayName: 'Instagram is signed in',
    async run(device, pluginData) {
        // returns { status: 'passed' | 'blocked' | 'failed', message }
    },
}]
```
Run during the device registration wizard.

### Namespaced routes
```ts
registerRoutes(ctx) {
    // ctx.app, ctx.routePrefix === `/plugins/${plugin.id}`
    // ctx.scheduler, ctx.remote, ctx.loadDevices(), ctx.saveDevices(),
    // ctx.renderActivity(udid, message?)
    ctx.app.post(`${ctx.routePrefix}/enqueue`, async (req, reply) => {
        await ctx.scheduler.createTask(/* CreateTaskInput */, devicePluginData);
        return reply.code(202).type('text/html').send(await ctx.renderActivity(udid));
    });
}
```

### WDA extensions
`wdaExtensions` declares patch files (path + sha256) your plugin needs applied
to WebDriverAgent. This is a declaration for review/audit; the build still runs
through `wda:prepare`.

## Packaging & shipping

1. A normal npm package, `"type": "module"`, `export default` the plugin.
2. `peerDependencies`: `@git-agni/phone-farm-core`.
3. Publish privately (or reference a pinned git commit).
4. Add the package name to `PHONE_FARM_PLUGINS` for **both** the `web` and
   `worker` units; restart both.
5. `GET /health` should now list your `{ id, version }`.

Plugins are **not sandboxed** — a plugin has the full filesystem, network,
process, and device access of the service account. Only install reviewed,
exactly‑pinned packages.

## Trying the reference plugin

`src/example-plugin.ts` is a complete minimal plugin (`open-app@1`). To load it
during development, point `PHONE_FARM_PLUGINS` at the built package path or add
it to `defaultPlugins()` locally.
