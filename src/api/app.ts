import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Readable } from 'node:stream';

import { discoverConnectedDevices } from '../devices/discovery.js';
import { loadRegisteredDevices, saveRegisteredDevices, redactDevice, PASSCODE_PATTERN, type RegisteredDevice } from '../devices/registry.js';
import { RegistryWdaRemoteControl } from '../devices/registry-remote.js';
import type {
    DeviceRegistrationManager, RegistrationAction, RegistrationUpdate,
} from '../devices/registration.js';
import { WdaRemoteControl, type RemoteAction } from '../devices/wda-remote.js';
import type { AuthProvider } from '../plugin.js';
import type { PluginRegistry } from '../registry.js';
import type { CreateTaskInput, JsonObject, ScheduleTiming } from '../types.js';
import type { SchedulerRepository } from '../scheduler/repository.js';

export interface CreateAppOptions {
    plugins: PluginRegistry;
    scheduler: SchedulerRepository;
    authProvider?: AuthProvider | null;
    dashboardTheme?: DashboardTheme;
    registrations?: DeviceRegistrationManager;
    logger?: boolean;
}

export interface DashboardTheme {
    rootDirectory: string;
    renderDevice?(template: string, device: RegisteredDevice): string;
}

interface LoadedDashboardTheme {
    indexHtml: string;
    deviceHtml: string;
    tasksHtml: string;
    styles: string;
    deviceScript: string;
    tasksScript: string;
    registerDeviceHtml: string;
    registerDeviceScript: string;
    htmx: string;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function escapeHtml(value: unknown): string {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character] ?? character);
}

function page(title: string, body: string, logoutPath?: string): string {
    const logout = logoutPath ? `<a href="${escapeHtml(logoutPath)}" style="float:right;margin-right:0">Log out</a>` : '';
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>
body{font:15px system-ui,sans-serif;margin:0;background:#f6f7f9;color:#17202a}nav{padding:16px 24px;background:#111827;color:white}nav a{color:white;margin-right:18px}main{max-width:1100px;margin:24px auto;padding:0 20px}.card{background:white;border:1px solid #dde2e8;border-radius:10px;padding:18px;margin:14px 0}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px;border-bottom:1px solid #e5e7eb}code{font-size:12px}.muted{color:#64748b}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}button,.button{background:#2563eb;color:white;border:0;border-radius:6px;padding:8px 12px;text-decoration:none;cursor:pointer}input,select,textarea{padding:8px;border:1px solid #cbd5e1;border-radius:6px}</style></head>
<body><nav><a href="/">Devices</a><a href="/tasks">Tasks</a><a href="/docs">API</a>${logout}</nav><main>${body}</main></body></html>`;
}

async function registeredWithStatus() {
    const [registered, connected] = await Promise.all([loadRegisteredDevices(), discoverConnectedDevices()]);
    const online = new Map(connected.map((device) => [device.udid, device]));
    return registered.map((device) => ({ ...redactDevice(device), connected: online.get(device.udid) ?? null }));
}

export async function createApp(options: CreateAppOptions): Promise<FastifyInstance> {
    const app = Fastify({ logger: options.logger ?? false, bodyLimit: 50 * 1024 * 1024 });
    await app.register(formbody);
    await app.register(cookie);
    await app.register(multipart, { limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 20 } });

    // Server-rendered HTML must never be cached — a stale page + fresh assets
    // (or vice versa) breaks the dashboard after a deploy.
    app.addHook('onSend', async (_request, reply) => {
        const type = reply.getHeader('content-type');
        if (typeof type === 'string' && type.includes('text/html') && !reply.hasHeader('cache-control')) {
            reply.header('cache-control', 'no-cache');
        }
    });

    if (options.authProvider) {
        await options.authProvider.registerRoutes(app);
        app.addHook('onRequest', async (request, reply) => {
            const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
            const bearer = request.headers.authorization?.startsWith('Bearer ');
            if (unsafe && !bearer) {
                const origin = request.headers.origin;
                const configured = [process.env.PUBLIC_ORIGIN, ...(process.env.PHONE_FARM_TRUSTED_ORIGINS ?? '').split(',')]
                    .map((value) => value?.trim().replace(/\/+$/, '')).filter(Boolean);
                const forwardedProtocol = String(request.headers['x-forwarded-proto'] ?? 'http').split(',')[0]?.trim();
                const expected = configured.length ? configured : [`${forwardedProtocol}://${request.headers.host}`];
                if (!origin || !expected.includes(origin.replace(/\/+$/, ''))) {
                    return reply.code(403).send({ error: 'Request origin is not trusted' });
                }
            }
            if (options.authProvider?.isPublicPath(request.url.split('?')[0] ?? request.url)) return;
            const user = await options.authProvider?.authenticate(request, reply);
            if (!user && !reply.sent) await reply.code(401).send({ error: 'Authentication required' });
        });
    }

    const remote = new RegistryWdaRemoteControl();
    const logoutPath = options.authProvider?.logoutPath;
    const authNavHtml = logoutPath ? `<a class="app-logout" href="${escapeHtml(logoutPath)}">Log out</a>` : '';
    const renderPage = (title: string, body: string) => page(title, body, logoutPath);

    let themed: LoadedDashboardTheme | null = null;
    if (options.dashboardTheme) {
        const root = options.dashboardTheme.rootDirectory;
        const require = createRequire(import.meta.url);
        const [indexHtml, deviceHtml, tasksHtml, registerDeviceHtml, styles, deviceScript, tasksScript, registerDeviceScript, htmx] = await Promise.all([
            readFile(path.join(root, 'templates/index.html'), 'utf8'),
            readFile(path.join(root, 'templates/device.html'), 'utf8'),
            readFile(path.join(root, 'templates/tasks.html'), 'utf8'),
            readFile(path.join(root, 'templates/register-device.html'), 'utf8'),
            readFile(path.join(root, 'styles.css'), 'utf8'),
            readFile(path.join(root, 'assets/device.js'), 'utf8'),
            readFile(path.join(root, 'assets/tasks.js'), 'utf8'),
            readFile(path.join(root, 'assets/register-device.js'), 'utf8'),
            readFile(require.resolve('htmx.org/dist/htmx.min.js'), 'utf8'),
        ]);
        const withNav = (html: string) => html.replaceAll('__AUTH_NAV__', authNavHtml);
        themed = {
            indexHtml: withNav(indexHtml), deviceHtml: withNav(deviceHtml),
            tasksHtml: withNav(tasksHtml), registerDeviceHtml: withNav(registerDeviceHtml),
            styles, deviceScript, tasksScript, registerDeviceScript, htmx,
        };
    }

    const renderActivity = async (deviceUdid: string, message?: string): Promise<string> => {
        const executions = await options.scheduler.listExecutions(25, deviceUdid);
        const execution = executions.find(({ status }) => status === 'running') ?? executions[0];
        if (!execution) return `<section id="device-activity" class="run-panel"><div class="run-heading"><span class="status idle"><span class="dot"></span>idle</span><span class="run-meta">No automation has run on this device yet.</span></div>${message ? `<p class="run-error">${escapeHtml(message)}</p>` : ''}<pre>Waiting for output…</pre></section>`;
        const detail = await options.scheduler.execution(execution.id);
        const definition = options.plugins.task({
            pluginId: execution.pluginId, taskType: execution.taskType,
            taskVersion: execution.taskVersion, payload: execution.payload,
        });
        const stop = execution.status === 'queued' || (execution.status === 'running' && definition.supportsStop(execution.payload))
            ? `<form hx-post="/api/executions/${execution.id}/stop" hx-target="#device-activity" hx-swap="outerHTML"><button class="button secondary" type="submit">Stop</button></form>` : '';
        return `<section id="device-activity" class="run-panel" hx-get="/api/devices/${encodeURIComponent(deviceUdid)}/fragments/activity" hx-trigger="every 1s" hx-swap="outerHTML"><div class="run-heading"><span class="status ${escapeHtml(execution.status)}"><span class="dot"></span>${escapeHtml(execution.status)}</span><span class="run-meta">${escapeHtml(definition.summarize(execution.payload))} · ${escapeHtml(execution.scheduledFor.toISOString())}</span></div>${message ? `<p class="run-error">${escapeHtml(message)}</p>` : ''}${stop}<pre>${detail?.logs.length ? detail.logs.map(escapeHtml).join('\n') : escapeHtml(execution.error ?? 'Waiting for worker output…')}</pre></section>`;
    };

    app.get('/health', async () => {
        const body: Record<string, unknown> = {
            ok: true,
            plugins: options.plugins.list().map(({ id, version }) => ({ id, version })),
        };
        // Deploy tooling writes a RELEASED file (sha, subject, deployedAt) into the
        // working directory; surface it so "what's live" is answerable over HTTP.
        try {
            body.release = JSON.parse(await readFile(path.resolve(process.env.PHONE_FARM_RELEASE_FILE ?? 'RELEASED'), 'utf8'));
        } catch { /* no release marker — fine */ }
        return body;
    });
    app.get('/api/plugins', async () => options.plugins.list().map((plugin) => ({
        id: plugin.id, version: plugin.version, displayName: plugin.displayName,
        tasks: plugin.tasks.map(({ type, version, displayName }) => ({ type, version, displayName })),
    })));
    app.get('/api/devices', async () => registeredWithStatus());
    app.get('/api/devices/discovered', async () => discoverConnectedDevices());
    app.get('/api/device-registrations/candidates', async (_request, reply) => {
        if (!options.registrations) return reply.code(503).send({ error: 'Device registration is not configured' });
        return { devices: await options.registrations.candidates() };
    });
    app.post<{ Body: { udid?: string } }>('/api/device-registrations', async (request, reply) => {
        if (!options.registrations) return reply.code(503).send({ error: 'Device registration is not configured' });
        if (!request.body.udid?.trim()) return reply.code(400).send({ error: 'Device UDID is required' });
        return reply.code(201).send(await options.registrations.create(request.body.udid.trim()));
    });
    app.get<{ Params: { id: string } }>('/api/device-registrations/:id', async (request, reply) => {
        if (!options.registrations) return reply.code(503).send({ error: 'Device registration is not configured' });
        return await options.registrations.get(request.params.id)
            ?? reply.code(404).send({ error: 'Registration draft not found' });
    });
    app.patch<{ Params: { id: string }; Body: RegistrationUpdate }>('/api/device-registrations/:id', async (request, reply) => {
        if (!options.registrations) return reply.code(503).send({ error: 'Device registration is not configured' });
        return options.registrations.update(request.params.id, request.body);
    });
    app.post<{ Params: { id: string; action: RegistrationAction }; Body: { authorizeTeamRegistration?: boolean } }>(
        '/api/device-registrations/:id/actions/:action', async (request, reply) => {
            if (!options.registrations) return reply.code(503).send({ error: 'Device registration is not configured' });
            if (!['refresh', 'prepare', 'verify', 'finalize'].includes(request.params.action)) {
                return reply.code(404).send({ error: 'Unknown registration action' });
            }
            return options.registrations.run(request.params.id, request.params.action, {
                authorizeTeamRegistration: request.body?.authorizeTeamRegistration === true,
            });
        },
    );
    app.delete<{ Params: { id: string } }>('/api/device-registrations/:id', async (request, reply) => {
        if (!options.registrations) return reply.code(503).send({ error: 'Device registration is not configured' });
        await options.registrations.cancel(request.params.id);
        return reply.code(204).send();
    });
    app.post<{ Body: { name: string; udid: string; wdaLocalPort?: number; mjpegLocalPort?: number; passcode?: string; pluginData?: Record<string, JsonObject> } }>(
        '/api/devices', async (request, reply) => {
            const devices = await loadRegisteredDevices();
            if (!request.body.udid || devices.some(({ udid }) => udid === request.body.udid)) {
                return reply.code(409).send({ error: 'A unique device UDID is required' });
            }
            if (request.body.passcode !== undefined && !PASSCODE_PATTERN.test(request.body.passcode)) {
                return reply.code(400).send({ error: 'Device passcode must contain at least four digits' });
            }
            devices.push({ ...request.body, pluginData: request.body.pluginData ?? {} });
            await saveRegisteredDevices(devices);
            return reply.code(201).send(redactDevice(devices.at(-1)!));
        },
    );
    app.patch<{ Params: { udid: string }; Body: { name?: string; wdaLocalPort?: number; mjpegLocalPort?: number; passcode?: string; pluginData?: Record<string, JsonObject> } }>(
        '/api/devices/:udid', async (request, reply) => {
            if (request.body.passcode !== undefined && request.body.passcode !== '' && !PASSCODE_PATTERN.test(request.body.passcode)) {
                return reply.code(400).send({ error: 'Device passcode must contain at least four digits' });
            }
            const devices = await loadRegisteredDevices();
            const index = devices.findIndex(({ udid }) => udid === request.params.udid);
            if (index < 0) return reply.code(404).send({ error: 'Device not found' });
            const { passcode, ...patch } = request.body;
            devices[index] = { ...devices[index]!, ...patch, udid: request.params.udid };
            // passcode: a value sets it, an empty string clears it, omitting it leaves it untouched
            if (passcode === '') delete devices[index]!.passcode;
            else if (passcode !== undefined) devices[index]!.passcode = passcode;
            await saveRegisteredDevices(devices);
            return redactDevice(devices[index]!);
        },
    );
    app.delete<{ Params: { udid: string } }>('/api/devices/:udid', async (request, reply) => {
        const devices = await loadRegisteredDevices();
        const index = devices.findIndex(({ udid }) => udid === request.params.udid);
        if (index < 0) return reply.code(404).send({ error: 'Device not found' });
        if (await options.scheduler.activeExecution(request.params.udid)) {
            return reply.code(409).send({ error: 'Stop the running automation before removing this device' });
        }
        for (const schedule of await options.scheduler.listSchedules(500, request.params.udid)) {
            if (!['cancelled', 'completed'].includes(schedule.status)) {
                await options.scheduler.setScheduleStatus(schedule.id, 'cancelled');
            }
        }
        devices.splice(index, 1);
        await saveRegisteredDevices(devices);
        return reply.code(204).send();
    });
    app.post<{ Params: { udid: string } }>('/api/devices/:udid/checks', async (request, reply) => {
        const device = (await loadRegisteredDevices()).find(({ udid }) => udid === request.params.udid);
        if (!device) return reply.code(404).send({ error: 'Device not found' });
        const identity = (await discoverConnectedDevices()).find(({ udid }) => udid === device.udid) ?? device;
        const results = [];
        for (const plugin of options.plugins.list()) {
            for (const check of plugin.registrationChecks ?? []) {
                results.push({ pluginId: plugin.id, checkId: check.id, ...(await check.run(identity, device.pluginData[plugin.id] ?? {})) });
            }
        }
        return results;
    });

    app.get<{ Params: { udid: string } }>('/api/devices/:udid/screenshot', async (request, reply) => {
        const device = (await loadRegisteredDevices()).find(({ udid }) => udid === request.params.udid);
        if (!device) return reply.code(404).send({ error: 'Device not found' });
        const remote = new WdaRemoteControl({ deviceUdid: device.udid, wdaUrl: `http://127.0.0.1:${device.wdaLocalPort ?? 8100}` });
        return reply.type('image/png').send(await remote.getScreenshot(device.udid));
    });
    app.post<{ Params: { udid: string }; Body: RemoteAction }>('/api/devices/:udid/actions', async (request, reply) => {
        const device = (await loadRegisteredDevices()).find(({ udid }) => udid === request.params.udid);
        if (!device) return reply.code(404).send({ error: 'Device not found' });
        const remote = new WdaRemoteControl({ deviceUdid: device.udid, wdaUrl: `http://127.0.0.1:${device.wdaLocalPort ?? 8100}` });
        await remote.performAction(device.udid, request.body);
        return reply.code(204).send();
    });
    app.get<{ Params: { udid: string } }>('/api/devices/:udid/remote/info', async (request, reply) => {
        const device = (await discoverConnectedDevices()).find(({ udid }) => udid === request.params.udid);
        if (!device) return reply.code(404).send({ error: 'Device is not connected' });
        return { device, screen: await remote.getScreenInfo(device.udid) };
    });
    app.get<{ Params: { udid: string } }>('/api/devices/:udid/remote/screenshot', async (request, reply) => {
        return reply.header('cache-control', 'no-store').type('image/png').send(await remote.getScreenshot(request.params.udid));
    });
    app.get<{ Params: { udid: string } }>('/api/devices/:udid/remote/stream', async (request, reply) => {
        const upstream = await remote.getMjpegStream(request.params.udid);
        if (!upstream.body) return reply.code(503).send({ error: 'Device stream is unavailable' });
        return reply.header('cache-control', 'no-store, no-cache, must-revalidate')
            .type(upstream.headers.get('content-type') ?? 'multipart/x-mixed-replace; boundary=--BoundaryString')
            .send(Readable.from(upstream.body as AsyncIterable<Uint8Array>));
    });
    app.post<{ Params: { udid: string }; Body: RemoteAction }>('/api/devices/:udid/remote/action', async (request, reply) => {
        if (await options.scheduler.activeExecution(request.params.udid)) {
            return reply.code(409).send({ error: 'Remote input is disabled while automation is running' });
        }
        await remote.performAction(request.params.udid, request.body);
        return { ok: true };
    });
    app.get<{ Params: { udid: string } }>('/api/devices/:udid/connection', async (request, reply) => {
        const registered = (await loadRegisteredDevices()).find(({ udid }) => udid === request.params.udid);
        if (!registered) return reply.code(404).send({ error: 'Device is not registered' });
        const connected = (await discoverConnectedDevices()).some(({ udid }) => udid === registered.udid);
        let wda = false;
        try { wda = (await fetch(`http://127.0.0.1:${registered.wdaLocalPort ?? 8100}/status`)).ok; } catch {}
        return {
            udid: registered.udid, physical: connected ? 'connected' : 'disconnected',
            wda: wda ? 'ready' : connected ? 'connecting' : 'disconnected', appium: 'ready',
            managed: true, message: wda ? 'WDA is ready' : connected ? 'Waiting for WDA' : 'Reconnect the USB cable',
            retryCount: 0, updatedAt: new Date().toISOString(),
        };
    });
    app.post<{ Params: { udid: string } }>('/api/devices/:udid/reconnect', async (request, reply) => {
        if (await options.scheduler.activeExecution(request.params.udid)) {
            return reply.code(409).send({ error: 'Cannot reconnect while automation is running' });
        }
        return reply.code(202).send({ ok: true, message: 'The shared WDA supervisor will reconnect automatically' });
    });

    app.get<{ Querystring: { deviceUdid?: string } }>('/api/schedules', async (request) => ({
        schedules: await options.scheduler.listSchedules(200, request.query.deviceUdid),
    }));
    app.get<{ Querystring: { deviceUdid?: string } }>('/api/executions', async (request) => ({
        executions: await options.scheduler.listExecutions(200, request.query.deviceUdid),
    }));
    app.get<{ Params: { id: string } }>('/api/executions/:id', async (request, reply) => {
        const execution = await options.scheduler.execution(request.params.id);
        return execution ?? reply.code(404).send({ error: 'Execution not found' });
    });
    app.post<{ Body: CreateTaskInput & { assetIds?: string[] } }>('/api/schedules', async (request, reply) => {
        const device = (await loadRegisteredDevices()).find(({ udid }) => udid === request.body.deviceUdid);
        if (!device) return reply.code(404).send({ error: 'Device not found' });
        const schedule = await options.scheduler.createTask(
            request.body, device.pluginData[request.body.task.pluginId] ?? {}, new Date(), request.body.assetIds ?? [],
        );
        return reply.code(201).send(schedule);
    });
    app.patch<{
        Params: { id: string };
        Body: { timing?: ScheduleTiming; runWindowMinutes?: number; recurringPublishConfirmed?: boolean };
    }>('/api/schedules/:id', async (request, reply) => {
        const current = await options.scheduler.schedule(request.params.id);
        if (!current) return reply.code(404).send({ error: 'Schedule not found' });
        const device = (await loadRegisteredDevices()).find(({ udid }) => udid === current.deviceUdid);
        if (!device) return reply.code(404).send({ error: 'Scheduled device is not registered' });
        const payload = request.body.recurringPublishConfirmed === undefined
            ? current.payload
            : { ...current.payload, recurringPublishConfirmed: request.body.recurringPublishConfirmed };
        const schedule = await options.scheduler.updateSchedule(request.params.id, {
            ...(request.body.timing ? { timing: request.body.timing } : {}),
            ...(request.body.runWindowMinutes !== undefined ? { runWindowMinutes: request.body.runWindowMinutes } : {}),
            task: {
                pluginId: current.pluginId, taskType: current.taskType,
                taskVersion: current.taskVersion, payload,
            },
        }, device.pluginData[current.pluginId] ?? {});
        return schedule ?? reply.code(409).send({ error: 'Completed or cancelled schedules cannot be edited' });
    });
    app.post<{ Params: { id: string }; Body: { status: 'active' | 'paused' | 'cancelled' } }>('/api/schedules/:id/status', async (request, reply) => {
        const schedule = await options.scheduler.setScheduleStatus(request.params.id, request.body.status);
        return schedule ?? reply.code(404).send({ error: 'Schedule not found' });
    });
    for (const action of ['pause', 'resume', 'cancel'] as const) {
        app.post<{ Params: { id: string } }>(`/api/schedules/:id/${action}`, async (request, reply) => {
            const status = action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'cancelled';
            const schedule = await options.scheduler.setScheduleStatus(request.params.id, status);
            return schedule ?? reply.code(404).send({ error: 'Schedule not found' });
        });
    }
    app.post<{ Params: { id: string } }>('/api/executions/:id/stop', async (request, reply) => {
        const result = await options.scheduler.requestStop(request.params.id);
        if (result === 'not-found') return reply.code(404).send({ error: 'Execution not found' });
        if (request.headers['hx-request']) {
            const execution = await options.scheduler.execution(request.params.id);
            return reply.type('text/html').send(await renderActivity(execution?.deviceUdid ?? ''));
        }
        return { result };
    });
    app.post<{ Params: { id: string } }>('/api/executions/:id/retry', async (request, reply) => {
        const execution = await options.scheduler.retryExecution(request.params.id);
        return execution ?? reply.code(409).send({ error: 'Execution is not retryable' });
    });

    app.post('/api/assets', async (request, reply) => {
        const dataRoot = path.resolve(process.env.SCHEDULER_DATA_DIR ?? '.scheduler-data');
        const uploadDirectory = path.join(dataRoot, 'uploads');
        await mkdir(uploadDirectory, { recursive: true });
        const created: Array<{ relativePath: string; originalName: string; mimeType: string; size: number; sha256: string }> = [];
        for await (const part of request.files()) {
            const id = crypto.randomUUID();
            const relativePath = path.join('uploads', id);
            const handle = await open(path.join(dataRoot, relativePath), 'wx', 0o600);
            const hash = crypto.createHash('sha256');
            let size = 0;
            try {
                for await (const chunk of part.file) {
                    const buffer = Buffer.from(chunk);
                    size += buffer.length;
                    hash.update(buffer);
                    await handle.write(buffer);
                }
            } finally {
                await handle.close();
            }
            created.push({ relativePath, originalName: part.filename, mimeType: part.mimetype, size, sha256: hash.digest('hex') });
        }
        return reply.code(201).send(await options.scheduler.registerAssets(created));
    });
    app.delete<{ Body: { assetIds: string[] } }>('/api/assets', async (request, reply) => {
        await options.scheduler.deleteAssets(request.body.assetIds ?? []);
        return reply.code(204).send();
    });

    for (const plugin of options.plugins.list()) {
        if (plugin.registerRoutes) await plugin.registerRoutes({
            app, routePrefix: `/plugins/${plugin.id}`, scheduler: options.scheduler, remote,
            loadDevices: loadRegisteredDevices, saveDevices: saveRegisteredDevices, renderActivity,
        });
    }

    if (themed) {
        const theme = themed;
        // Serve the built assets with a content ETag and must-revalidate, so a
        // deploy that changes device.js is picked up on the next request instead
        // of being masked by heuristic browser caching.
        const asset = (contentType: string, body: string) => {
            const etag = `"${crypto.createHash('sha1').update(body).digest('base64url')}"`;
            return async (request: FastifyRequest, reply: FastifyReply) => {
                reply.header('cache-control', 'no-cache').header('etag', etag);
                if (request.headers['if-none-match'] === etag) return reply.code(304).send();
                return reply.type(contentType).send(body);
            };
        };
        app.get('/assets/styles.css', asset('text/css', theme.styles));
        app.get('/assets/device.js', asset('text/javascript', theme.deviceScript));
        app.get('/assets/tasks.js', asset('text/javascript', theme.tasksScript));
        app.get('/assets/register-device.js', asset('text/javascript', theme.registerDeviceScript));
        app.get('/assets/htmx.min.js', asset('text/javascript', theme.htmx));
        app.get('/api/fragments/devices', async (_request, reply) => {
            const devices = await registeredWithStatus();
            const cards = devices.map((device) => {
                const accounts = Object.values(device.pluginData).flatMap((value) => {
                    const candidate = value.accounts;
                    return Array.isArray(candidate) ? candidate.filter((entry) => typeof entry === 'string') : [];
                });
                const preview = device.connected
                    ? `<div class="device-preview-frame"><img class="device-preview" src="/api/devices/${encodeURIComponent(device.udid)}/remote/stream" alt="Live screen from ${escapeHtml(device.name)}" draggable="false" hx-preserve="true"></div>`
                    : '<div class="device-preview-frame unavailable" aria-hidden="true"><div class="device-icon"></div></div>';
                return `<article class="device-card">${preview}<div class="device-copy"><h2>${escapeHtml(device.name)}</h2><p>${device.connected ? `iOS ${escapeHtml(device.connected.osVersion)}` : escapeHtml(device.udid)}</p><span class="connected${device.connected ? '' : ' offline'}"><span></span>${device.connected ? 'Online' : 'Offline'}</span>${accounts.length ? `<p class="accounts">${accounts.map(escapeHtml).join(', ')}</p>` : ''}</div><a class="button secondary" href="/devices/${encodeURIComponent(device.udid)}">Open device <span aria-hidden="true">→</span></a></article>`;
            }).join('');
            return reply.type('text/html').send(`<section id="device-list" class="device-list" hx-get="/api/fragments/devices" hx-trigger="every 5s" hx-swap="outerHTML" aria-live="polite">${cards || '<div class="empty-state"><h2>No devices registered</h2></div>'}</section>`);
        });
        app.get<{ Params: { udid: string } }>('/api/devices/:udid/fragments/summary', async (request, reply) => {
            const device = (await discoverConnectedDevices()).find(({ udid }) => udid === request.params.udid);
            if (!device) return reply.type('text/html').send('<section id="device-summary" class="device-summary error"><div><h2>Device disconnected</h2></div></section>');
            const screen = await remote.getScreenInfo(device.udid);
            return reply.type('text/html').send(`<section id="device-summary" class="device-summary" data-screen-width="${screen.screenSize.width}" data-screen-height="${screen.screenSize.height}"><div><span class="eyebrow">Connected device</span><h1>${escapeHtml(device.name)}</h1><p>iOS ${escapeHtml(device.osVersion)} · ${screen.screenSize.width} × ${screen.screenSize.height} points · ${screen.scale}×</p></div><code>${escapeHtml(device.udid)}</code></section>`);
        });
        app.get<{ Params: { udid: string } }>('/api/devices/:udid/fragments/activity', async (request, reply) => {
            return reply.type('text/html').send(await renderActivity(request.params.udid));
        });
    }

    app.get('/', async (_request, reply) => {
        if (themed) return reply.type('text/html').send(themed.indexHtml);
        const devices = await registeredWithStatus();
        const cards = devices.map((device) => `<div class="card"><h2>${escapeHtml(device.name)}</h2><p class="muted"><code>${escapeHtml(device.udid)}</code></p><p>${device.connected ? `Online · iOS ${escapeHtml(device.connected.osVersion)}` : 'Offline'}</p><a class="button" href="/devices/${encodeURIComponent(device.udid)}">Open device</a></div>`).join('');
        const connected = await discoverConnectedDevices();
        const registeredIds = new Set(devices.map(({ udid }) => udid));
        const candidates = connected.filter(({ udid }) => !registeredIds.has(udid)).map((device) => `<option value="${escapeHtml(device.udid)}" data-name="${escapeHtml(device.name)}">${escapeHtml(device.name)} · ${escapeHtml(device.osVersion)}</option>`).join('');
        const registration = candidates ? `<section class="card"><h2>Register connected device</h2><form id="register-device"><select name="udid">${candidates}</select> <button>Register</button></form><p id="register-result" class="muted"></p><script>document.getElementById('register-device').addEventListener('submit',async function(e){e.preventDefault();var s=e.currentTarget.udid;var o=s.options[s.selectedIndex];var r=await fetch('/api/devices',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({udid:o.value,name:o.dataset.name,pluginData:{}})});document.getElementById('register-result').textContent=r.ok?'Registered. Reloading…':(await r.json()).error;if(r.ok)setTimeout(function(){location.reload()},500)});</script></section>` : '';
        return reply.type('text/html').send(renderPage('Devices', `<h1>Devices</h1>${registration}<div class="grid">${cards || '<p>No devices registered.</p>'}</div>`));
    });
    app.get('/devices/register', async (_request, reply) => {
        if (!themed) return reply.type('text/html').send(renderPage('Register device', '<h1>Register device</h1><p>Use <code>POST /api/device-registrations</code> to start device setup.</p>'));
        return reply.type('text/html').send(themed.registerDeviceHtml);
    });
    app.get<{ Params: { udid: string } }>('/devices/:udid', async (request, reply) => {
        const device = (await loadRegisteredDevices()).find(({ udid }) => udid === request.params.udid);
        if (!device) return reply.code(404).type('text/html').send(renderPage('Not found', '<h1>Device not found</h1>'));
        if (themed) {
            const rendered = options.dashboardTheme?.renderDevice
                ? options.dashboardTheme.renderDevice(themed.deviceHtml, device) : themed.deviceHtml;
            return reply.type('text/html').send(rendered.replaceAll('__DEVICE_UDID__', encodeURIComponent(device.udid)));
        }
        const schedules = await options.scheduler.listSchedules(50, device.udid);
        const executions = await options.scheduler.listExecutions(50, device.udid);
        const panels: string[] = [];
        for (const plugin of options.plugins.list()) {
            for (const panel of [...(plugin.devicePanels ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
                try {
                    panels.push(`<section class="card" data-plugin="${escapeHtml(plugin.id)}"><h2>${escapeHtml(panel.title)}</h2>${await readFile(panel.fragmentPath, 'utf8')}</section>`);
                } catch (error) {
                    panels.push(`<section class="card"><h2>${escapeHtml(panel.title)}</h2><p>Panel unavailable: ${escapeHtml(errorMessage(error))}</p></section>`);
                }
            }
        }
        const scheduleRows = schedules.map((item) => `<tr><td>${escapeHtml(item.pluginId)}/${escapeHtml(item.taskType)}</td><td>${escapeHtml(JSON.stringify(item.timing))}<br><span class="muted">Next: ${escapeHtml(item.nextRunAt?.toISOString() ?? '—')}</span></td><td>${escapeHtml(item.status)}</td><td>${item.status === 'active' ? `<button data-schedule="${item.id}" data-status="paused">Pause</button>` : item.status === 'paused' ? `<button data-schedule="${item.id}" data-status="active">Resume</button>` : ''} ${!['cancelled', 'completed'].includes(item.status) ? `<button data-schedule="${item.id}" data-status="cancelled">Cancel</button>` : ''}</td></tr>`).join('');
        const executionRows = executions.map((item) => `<tr><td>${escapeHtml(item.pluginId)}/${escapeHtml(item.taskType)}</td><td>${escapeHtml(item.status)}<br><span class="muted">${escapeHtml(item.scheduledFor.toISOString())}</span></td><td><a href="/api/executions/${item.id}"><code>${escapeHtml(item.id)}</code></a></td><td>${['queued', 'running'].includes(item.status) ? `<button data-stop="${item.id}">Stop</button>` : ['failed', 'stopped'].includes(item.status) ? `<button data-retry="${item.id}">Retry</button>` : ''}</td></tr>`).join('');
        const udidJs = encodeURIComponent(device.udid);
        const passcodeCard = `<section class="card"><h2>Unlock passcode</h2><p class="muted">${device.passcode ? 'A passcode is set.' : 'No passcode set.'} Stored in devices.json, never shown.</p><form id="pc"><input id="pcv" type="password" inputmode="numeric" placeholder="4+ digits" autocomplete="new-password"> <button class="button secondary">Save</button> <button type="button" id="pcc" class="button secondary">Clear</button> <span id="pcr" class="muted"></span></form></section><script>(function(){var f=document.getElementById('pc'),v=document.getElementById('pcv'),r=document.getElementById('pcr');async function set(p){r.textContent='…';var x=await fetch('/api/devices/${udidJs}',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({passcode:p})});if(x.ok){r.textContent=p?'Saved.':'Cleared.';v.value=''}else{r.textContent=((await x.json().catch(function(){return{}})).error)||'Failed'}}f.addEventListener('submit',function(e){e.preventDefault();if(!/^\\d{4,}$/.test(v.value.trim())){r.textContent='4+ digits';return}set(v.value.trim())});document.getElementById('pcc').addEventListener('click',function(){if(confirm('Clear passcode?'))set('')})})();</script>`;
        const controls = `<script>document.addEventListener('click',async function(e){var b=e.target.closest('button');if(!b)return;var url,body,method='POST';if(b.dataset.schedule){url='/api/schedules/'+b.dataset.schedule+'/status';body={status:b.dataset.status}}else if(b.dataset.stop){url='/api/executions/'+b.dataset.stop+'/stop'}else if(b.dataset.retry){url='/api/executions/'+b.dataset.retry+'/retry'}else if(b.dataset.remove){if(!confirm('Remove this device? Its schedules will be cancelled.'))return;url='/api/devices/'+encodeURIComponent(b.dataset.remove);method='DELETE'}else{return}b.disabled=true;var r=await fetch(url,{method:method,headers:{'content-type':'application/json'},body:body?JSON.stringify(body):'{}'});if(r.ok){location.href=b.dataset.remove?'/':location.href;if(!b.dataset.remove)location.reload()}else{b.disabled=false;alert((await r.json().catch(function(){return{}})).error||'Request failed')}});</script>`;
        return reply.type('text/html').send(renderPage(device.name, `<h1>${escapeHtml(device.name)}</h1><p><code>${escapeHtml(device.udid)}</code></p>${panels.join('')}<section class="card"><h2>Scheduled and recurring jobs</h2><table><tr><th>Task</th><th>Timing</th><th>Status</th><th>Actions</th></tr>${scheduleRows || '<tr><td colspan="4">No schedules.</td></tr>'}</table></section><section class="card"><h2>Execution history</h2><table><tr><th>Task</th><th>Status</th><th>ID/logs</th><th>Actions</th></tr>${executionRows || '<tr><td colspan="4">No executions.</td></tr>'}</table></section>${passcodeCard}<section class="card"><h2>Danger zone</h2><p class="muted">Removing a device cancels its schedules and forgets its configuration. WebDriverAgent stays installed on the phone.</p><button data-remove="${escapeHtml(device.udid)}" class="button secondary">Remove device</button></section>${controls}`));
    });
    app.get('/tasks', async (_request, reply) => reply.type('text/html').send(
        themed?.tasksHtml ?? renderPage('Tasks', '<h1>Tasks</h1><p>The JSON API exposes schedules and execution history. Installed plugins add task forms to each device page.</p>'),
    ));
    app.get('/docs', async (_request, reply) => reply.type('text/html').send(renderPage('API', '<h1>API</h1><p>Use <code>/api/plugins</code>, <code>/api/devices</code>, <code>/api/schedules</code>, and <code>/api/executions</code>. This route follows the configured authentication policy.</p>')));

    app.setErrorHandler((error, request, reply) => {
        request.log.error(error);
        const failure = error as Error & { statusCode?: number };
        void reply.code(failure.statusCode && failure.statusCode >= 400 ? failure.statusCode : 400)
            .send({ error: failure.message });
    });
    return app;
}
