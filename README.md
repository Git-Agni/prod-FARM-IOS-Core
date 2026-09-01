# Phone Farm iOS

An open-source, standalone application for operating physical iOS devices and running scheduled TikTok workflows. It includes guided device registration, WDA/Appium supervision, live video and remote input, PostgreSQL-backed scheduling, recurring jobs, uploads, execution history, the dashboard/API server, and a built-in TikTok automation plugin.

It runs locally as-is; authentication is optional on a loopback bind. Harden it for a shared or exposed deployment by supplying your own `AuthProvider` (`PHONE_FARM_AUTH_PLUGIN`) and process supervision — no fork required. Tasks are persisted as `pluginId`, `taskType`, `taskVersion`, and a JSON payload, so an old schedule can never silently execute a new contract.

> Live demo and setup walkthrough: **[gethandler.ai/ios-farm](https://gethandler.ai/ios-farm)**

## Documentation

- [docs/getting-started.md](docs/getting-started.md) — install, configure, run, register a device
- [docs/architecture.md](docs/architecture.md) — the four processes, data stores, task model, source map
- [docs/plugins.md](docs/plugins.md) — write a plugin: tasks, execution context, versioning, panels, routes
- [docs/coordinates.md](docs/coordinates.md) — tap-layout profiles and how to add one
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

## Plugin contract

`src/plugin.ts` defines the stable interfaces. A plugin can provide versioned tasks, registration checks, device-page panels, namespaced HTTP routes, and declared WDA extensions. Task execution receives the exact device, that plugin's own per-device data, resolved assets, a temporary workspace, cancellation, durable logging, safe device primitives, and an observed subprocess runner.

See `PLUGIN_DEVELOPMENT.md` for compatibility and trust rules.

`src/example-plugin.ts` is a minimal open-app plugin. Production plugins should be separate packages and should never require changes to core routing or scheduler code.

## Repository policy

This repository uses GitHub-hosted CI only. Never connect production devices, Apple signing material, production databases, self-hosted runners, or deployment credentials to workflows triggered by pull requests. See `SECURITY.md`.

```sh
npm run check
```
