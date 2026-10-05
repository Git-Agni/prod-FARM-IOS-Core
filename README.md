# Phone Farm iOS

An open-source, standalone application for operating physical iOS devices and running scheduled TikTok workflows. It includes guided device registration, WDA/Appium supervision, live video and remote input, PostgreSQL-backed scheduling, recurring jobs, uploads, execution history, the dashboard/API server, and a built-in TikTok automation plugin.

It runs locally as-is; authentication is optional on a loopback bind. Harden it for a shared or exposed deployment by supplying your own `AuthProvider` (`PHONE_FARM_AUTH_PLUGIN`) and process supervision — no fork required. Tasks are persisted as `pluginId`, `taskType`, `taskVersion`, and a JSON payload, so an old schedule can never silently execute a new contract.

> Live demo and setup walkthrough: **[gethandler.ai/ios-farm](https://gethandler.ai/ios-farm)**
>
> The full engineering writeup, TikTok on 9 real iPhones reverse engineered from the screen up (Apple's test daemon, the two WebDriverAgent patches, pixel-level UI detection, OCR account switching, never posting twice): **[gethandler.ai/tiktok-iphone-farm](https://gethandler.ai/tiktok-iphone-farm)**

## Documentation

- [docs/getting-started.md](docs/getting-started.md) — install, configure, run, register a device
- [docs/architecture.md](docs/architecture.md) — the four processes, data stores, task model, source map
- [docs/plugins.md](docs/plugins.md) — write a plugin: tasks, execution context, versioning, panels, routes
- [docs/coordinates.md](docs/coordinates.md) — tap-layout profiles and how to add one
- [docs/humanizer.md](docs/humanizer.md) — humanizer: random delays, jittered taps, curved swipes, typing
- [PLUGIN_DEVELOPMENT.md](PLUGIN_DEVELOPMENT.md) — plugin trust and compatibility rules
- [SECURITY.md](SECURITY.md) — before exposing the dashboard beyond loopback

## Run the standalone application

Requirements are Node 22+, PostgreSQL, Xcode, a signed real-device WebDriverAgent, and Appium's XCUITest driver.

```sh
npm install
cp .env.example .env
npm run appium:install-driver
npm run db:up
npm run db:migrate
npm run wda:prepare
```

Run these long-lived processes (wrap each in a `launchd` agent or systemd unit for an always-on host):

```sh
npm run appium
npm run wda:service
npm run worker
npm run web
```

TikTok support is enabled by default. Set `PHONE_FARM_PLUGINS` to comma-separated ESM package names to add more task plugins. Set `PHONE_FARM_AUTH_PLUGIN` to an ESM authentication provider before binding `WEB_HOST` outside loopback; startup deliberately fails otherwise.

## Humanizer

`src/tiktok/humanizer.ts` adds human-like randomness to the TikTok automation (enabled by default):

- **Taps** — small Gaussian offset from the target point (≤6px), randomized hold (60–160ms instead of a fixed 100ms), and a short 50ms travel instead of an instant jump.
- **Pauses** — every fixed `driver.pause()` is jittered around its original value (floor 70%, cap 130%).
- **Swipes** — doomscroll swipes follow a quadratic Bezier trajectory with start/end jitter, a randomized control point, and eased per-segment timing (400–550ms total).
- **Caption typing** — the caption is sent in small random chunks (1–6 characters, spaces sent separately) with 40–120ms delays between chunks and occasional 300–800ms pauses.

Defaults live in `defaultConfig()` in `src/tiktok/humanizer.ts`; see [docs/humanizer.md](docs/humanizer.md) for the full list. Set `HUMANIZER=off` to restore the original fixed coordinates, timings, straight swipes, and single-request caption typing exactly.

Step order, retry logic, and the 60s post-upload wait are unchanged (the post-upload wait is never shorter than 60s).

## Plugin contract

`src/plugin.ts` defines the stable interfaces. A plugin can provide versioned tasks, registration checks, device-page panels, namespaced HTTP routes, and declared WDA extensions. Task execution receives the exact device, that plugin's own per-device data, resolved assets, a temporary workspace, cancellation, durable logging, safe device primitives, and an observed subprocess runner.

See `PLUGIN_DEVELOPMENT.md` for compatibility and trust rules.

`src/example-plugin.ts` is a minimal open-app plugin. Production plugins should be separate packages and should never require changes to core routing or scheduler code.

## Repository policy

This repository uses GitHub-hosted CI only. Never connect production devices, Apple signing material, production databases, self-hosted runners, or deployment credentials to workflows triggered by pull requests. See `SECURITY.md`.

```sh
npm run check
```
