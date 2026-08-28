# Architecture — what does what

Phone Farm iOS is four cooperating processes over one PostgreSQL database and a
few local state files. There is no client framework: the dashboard is
server‑rendered HTML with HTMX, and live video is MJPEG, not WebSockets.

```
                         ┌───────────────────────────────┐
  browser  ── HTTP ─────▶│  web  (Fastify + HTMX)  :3000 │
                         │  dashboard, JSON API,         │
                         │  plugin panels & routes       │
                         └───────┬───────────────┬───────┘
                                 │ SQL           │ HTTP (Unix socket)
                                 ▼               ▼
        ┌────────────────────────────┐   ┌──────────────────────────┐
        │ PostgreSQL                 │   │ wda-service              │
        │  scheduler.*  pgboss.*     │   │  1 WebDriverAgent / phone│
        │  drizzle.*                 │   │  forwards :8100+ / :9100+ │
        └───────▲────────────────────┘   └───────────┬──────────────┘
                │ SQL / pg-boss                      │ USB
        ┌───────┴────────────┐              ┌────────▼─────────┐
        │ worker             │── Appium ───▶│ Appium :4725     │──▶ iPhone
        │  runs due tasks    │   (webdriverio in task procs)   │
        └────────────────────┘              └──────────────────┘
```

## The four processes

### `web` — `src/api/server.ts` → `startServer()` → `src/api/app.ts`
Fastify app on `WEB_PORT` (default 3000).

- Server‑rendered dashboard (`/`, `/devices/:udid`, `/tasks`, `/devices/register`).
- JSON API under `/api/*` (devices, registrations, schedules, executions,
  assets, remote control).
- Live device screen: `GET /api/devices/:udid/remote/stream` proxies the
  phone's MJPEG feed (used on the device page; the device **grid** uses
  periodic `…/remote/screenshot` stills instead). The proxy aborts the
  upstream feed when the browser disconnects. `POST …/remote/action` forwards
  tap/swipe to WDA.
- Loads plugins (`PHONE_FARM_PLUGINS`) and the auth provider
  (`PHONE_FARM_AUTH_PLUGIN`); mounts each plugin's **panels** on the device
  page and its **routes** under `/plugins/<pluginId>`.
- `assertSafeBind(host, authProvider)` refuses a non‑loopback bind with no
  auth provider.
- Owns device **registration** (`DeviceRegistrationService`) and creates the
  scheduler runtime used to enqueue work.

### `worker` — `src/scheduler/worker.ts` → `startWorker()`
Headless. Owns task execution.

- One pg-boss worker per **active** registered device, queue
  `ios-device-<hash(udid)>`. A device with `disabled: true` in `devices.json`
  is skipped here and by `wda-service` — the entry stays but nothing supervises
  it.
- Every 5 s, `materializeDue()` turns due schedules into `executions` rows and
  enqueues jobs; every 30 s it picks up newly registered devices.
- For each job: `executeAutomation()` (`src/scheduler/executor.ts`) waits for
  the device + WDA + Appium to be ready, builds a `TaskExecutionContext`, and
  calls the task's `execute()`. Handles attempts, retry policy, stop requests,
  and the run‑window deadline.
- Must load the **same plugin versions** as `web`.

### `wda-service` — `src/devices/wda-service.ts`
Persistent WebDriverAgent supervisor, controlled over a Unix socket
(`.wda/wda-service.sock`).

- Keeps one WDA session alive per registered device, (re)launching
  `xcodebuild test-without-building` as needed and USB‑forwarding WDA
  (`8100`, `8101`, …) and MJPEG (`9100`, `9101`, …).
- `GET /health` on the socket reports per‑device `{ physical, wda, appium,
  message }`. States: `ready`, `unlock-required`, `error`, …
- Single‑supervisor by design; a lock prevents duplicates.

### `appium` — `appium --address 127.0.0.1 --port 4725`
Appium 3 with the XCUITest driver, isolated in `APPIUM_HOME=.appium2`. Task
subprocesses (e.g. `src/tiktok/doomscroll.ts`) connect to it with
`webdriverio`. The dashboard's remote control does **not** go through Appium —
it talks to WDA directly. Binds loopback only.

## Xcode, signing, and device pairing

The farm never talks to a device directly at the USB level for *control* — it
delegates the whole pair/trust/sign/launch chain to Xcode's toolchain:

- **Pairing & trust** are the OS's job. An iPhone must be paired (USB + "Trust
  This Computer") and, on iOS 16+, have **Developer Mode** enabled before any
  of this works. `xcrun xctrace list devices` / `discoverConnectedDevices()`
  (`appium-ios-device`, over `usbmuxd`) is how the app learns a device is
  attached; it does not initiate pairing.
- **The Developer Disk Image** for the device's iOS version is mounted by
  Xcode on first pair. `xcodebuild` needs it present to launch a test bundle.
- **Signing.** `src/devices/wda/prepare.ts` runs `xcodebuild build-for-testing`
  with `CODE_SIGN_STYLE=Automatic` and `DEVELOPMENT_TEAM=$XCODE_ORG_ID`. Xcode
  automatic signing creates/refreshes a development provisioning profile that
  lists the connected UDIDs and embeds it in `WebDriverAgentRunner-Runner.app`.
  This is why a new device must be plugged in (and the Apple ID have a free
  slot — the 100-UDID limit) when `wda:prepare` runs. Signing reads a
  certificate from the **login keychain**, which is only unlocked in a
  graphical session — hence the "run from Terminal.app, not SSH" rule.
- **Launch.** `wda-service` runs `xcodebuild test-without-building
  -destination id=<udid>` per active device: it installs the pre-signed
  `WebDriverAgentRunner` and starts it as a UI test. WDA then serves HTTP on
  the device's `:8100` and MJPEG on `:9100`, which `wda-service` USB-forwards
  to the host's `:81xx` / `:91xx`.

The **registration wizard** (`src/devices/registration.ts`) is a UI over this
chain: its `host` / `connection` / `signing` / `developer` / `wda` checks each
probe one link (Xcode selected, device visible over usbmux, a signing identity
present, the DDI mounted, WDA reachable) and surface a specific fix before the
device is written to `devices.json`. `wda:prepare` is the same signing step
without the UI, for scripted or bulk (`--all`) setup.

## Data & state

| Store | Contents |
| --- | --- |
| PostgreSQL `scheduler.*` | `schedules`, `executions`, `execution_attempts`, `execution_logs`, `assets`. Drizzle ORM; migrations in `drizzle/`. |
| PostgreSQL `pgboss.*` | Job queue (one partitioned queue per device). |
| PostgreSQL `drizzle.*` | Applied‑migration ledger. |
| `devices.json` | Registered devices: `udid`, `name`, ports, `coordinateProfile`, per‑device `coordinates` overrides, `passcode`, `disabled`, `pluginData`. Git‑ignored, `0600`. |
| `.env` | Configuration and secrets (DB URL, signing IDs, auth keys). Git‑ignored. Device passcodes live in `devices.json`, not here. |
| `.scheduler-data/assets/` | Uploaded media for `post`‑style tasks, content‑addressed. |
| `.wda/` | wda-service socket and locks. |
| `.appium2/` | Isolated Appium home with the pinned XCUITest driver. |

## The task model

Every schedule and execution row carries a **task envelope**:

```
pluginId : string        e.g. "com.git-agni.tiktok"
taskType : string        e.g. "doomscroll"
taskVersion : integer     e.g. 1
payload : jsonb          validated, version-specific shape
```

`PluginRegistry.task({pluginId, taskType, taskVersion})` resolves the envelope
to a `TaskDefinition`. Because the version is stored, **an old schedule can
never silently run a new contract** — if `taskVersion` 1 is no longer
installed, that schedule fails loudly instead of executing v2 logic.

## Scheduling

`ScheduleTiming` (`src/types.ts`):

| kind | fields |
| --- | --- |
| `now` | — |
| `once` | `runAt` (ISO) |
| `daily` | `localTime` `"HH:MM"`, `timezone` (IANA) |
| `weekly` | `localTime`, `timezone`, `weekdays` (0–6) |

`run_window_minutes` (default 30) is the grace period after the scheduled time;
past it, the execution is abandoned as "window expired". Recurrence is computed
in `src/scheduler/recurrence.ts`; the next occurrence is written to
`schedules.next_run_at`.

## Source map

| Path | Responsibility |
| --- | --- |
| `src/api/` | Fastify app factory, controllers, middleware, HTTP routes |
| `src/scheduler/` | runtime, repository, pg-boss queue, recurrence, worker, executor |
| `src/database/` | Drizzle client, schema, migrate/setup entrypoints |
| `src/devices/` | discovery, registry (`devices.json`), registration flow, WDA remote, wda-service, coordinate profiles, passcode lookup |
| `src/devices/wda/` | `prepare.ts` (patch + build + sign WDA), `start.ts` (single-device WDA supervisor), `target-device.ts` (resolve which device a CLI command targets), diagnostics |
| `src/tiktok/` | TikTok automation entrypoints (`doomscroll.ts`, `post.ts`), OCR, coordinates |
| `src/tiktok-plugin.ts` | The built‑in plugin: task definitions, device panel, routes |
| `src/plugin.ts` | **Stable plugin & auth interfaces** |
| `src/registry.ts` | `PluginRegistry` — task resolution and validation |
| `src/loader.ts` | Dynamic import of `PHONE_FARM_PLUGINS` / `PHONE_FARM_AUTH_PLUGIN` |
| `src/example-plugin.ts` | Minimal reference plugin |
| `static/dashboard/` | HTML templates, browser TS (`tsconfig.web.json` → `static/dashboard/assets/*.js`) |
| `Patches/` | WDA source patches applied by `wda:prepare` |
| `drizzle/` | SQL migrations + journal |
