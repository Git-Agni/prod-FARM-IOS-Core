# Getting started

Phone Farm iOS drives physical iPhones from a local dashboard: guided device
registration, a live screen with remote tap/swipe, and a PostgreSQL‑backed
scheduler that runs versioned automation tasks (a TikTok plugin ships built‑in).

## Requirements

| Requirement | Notes |
| --- | --- |
| macOS + Xcode | Real‑device builds and signing. `xcode-select -p` must point at an Xcode install, not the Command Line Tools. |
| Node.js 22+ | `engines.node >= 22`. The app runs TypeScript directly through `tsx`; there is no build step for the server. |
| PostgreSQL 14+ | `docker compose up -d postgres` is provided, or bring your own and set `DATABASE_URL`. |
| A physical iPhone | Developer‑enabled, trusted, connected by USB. iOS 16/17/18 are supported. |
| An Apple Developer team | For signing WebDriverAgent. A free personal team works for one device. |

## 1. Install

```sh
git clone https://github.com/Git-Agni/prod-FARM-IOS-Core.git phone-farm
cd phone-farm
npm install
npm run appium:install-driver     # installs the XCUITest driver into ./.appium2
```

## 2. Configure

```sh
cp .env.example .env
```

Fill in at least:

| Key | What it is |
| --- | --- |
| `IOS_UDID` | Target device UDID — `xcrun xctrace list devices` |
| `IOS_PLATFORM_VERSION` | e.g. `17.5` — must match the device |
| `XCODE_ORG_ID` | Apple Development **Team ID** (Xcode → Settings → Accounts) |
| `WDA_BUNDLE_ID` | A bundle id you control, e.g. `com.yourorg.WebDriverAgentRunner` |
| `DATABASE_URL` | `postgresql://phone_farm:PASSWORD@127.0.0.1:5432/phone_farm` |
| `POSTGRES_PASSWORD` | Needed by `docker compose` if you use the bundled database |

Device passcodes are **not** put in `.env` in plain sight for multi‑device
setups — see [devices & secrets](#devices-and-secrets) below.

## 3. Database

```sh
npm run db:up        # start the bundled Postgres (skip if you run your own)
npm run db:migrate   # apply scheduler + pg-boss schema
```

## 4. Build WebDriverAgent

```sh
npm run wda:prepare
```

This patches the Appium‑bundled `appium-webdriveragent`, then runs
`xcodebuild build-for-testing` signed with your team. It ends with
`** TEST BUILD SUCCEEDED **`.

> **Run this from a graphical login session** (Terminal.app, or a remote
> desktop), not a bare SSH shell. Code signing needs the login keychain
> unlocked; over SSH it fails with `errSecInternalComponent`. If you must run
> it over SSH: `security unlock-keychain ~/Library/Keychains/login.keychain-db`
> and `security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k <pw>
> ~/Library/Keychains/login.keychain-db` first.

## 5. Run the four processes

Each is long‑lived. In development, four terminals; in production, four
`launchd`/systemd units (the private distribution ships `ops/install-launchagents.sh`).

```sh
npm run appium         # Appium 3 + XCUITest on :4725
npm run wda:service    # per-device WebDriverAgent supervisor (Unix socket + :8100+/:9100+)
npm run worker         # scheduler worker — runs due tasks
npm run web            # dashboard + API on :3000
```

Open <http://127.0.0.1:3000>, go to **Register device**, pick the connected
device, and step through the checks. Unlock the phone when WDA first launches.

## 6. Schedule something

From a device page you can run the built‑in TikTok tasks (`doomscroll`,
`post`) now or on a `daily`/`weekly`/`once` schedule. Watch progress in
**Activity**; full logs are under `GET /api/executions/:id`.

## Authentication

On a loopback bind (`WEB_HOST=127.0.0.1`) auth is optional. Before binding to
anything else, set `PHONE_FARM_AUTH_PLUGIN` to an ESM module exporting an
`AuthProvider`; startup **deliberately fails** otherwise (`assertSafeBind`).
The private distribution provides a Supabase provider; you can write your own
against the `AuthProvider` interface in `src/plugin.ts`.

## Devices and secrets

Registered devices live in `devices.json` (git‑ignored):

```json
[
  {
    "name": "Phone A",
    "udid": "00008030-000000000000000E",
    "wdaLocalPort": 8100,
    "mjpegLocalPort": 9100,
    "coordinateProfile": "iphone8",
    "pluginData": { "com.git-agni.tiktok": { "accounts": ["@handle"] } }
  }
]
```

- `coordinateProfile` selects a compiled tap layout — see
  [coordinates.md](coordinates.md).
- `pluginData[<pluginId>]` is per‑device plugin config (never secrets).
- Passcodes are read from the environment: `IOS_PASSCODE_<UDID>` (UDID
  upper‑cased, non‑alphanumerics → `_`), falling back to `IOS_PASSCODE`. Keep
  them in `.env.devices` (git‑ignored), not `.env`.

## Health & troubleshooting

| Symptom | Check |
| --- | --- |
| `wda: error … stale or corrupted` | Re‑run `npm run wda:prepare`; delete `~/Library/Developer/Xcode/DerivedData/WebDriverAgent-*` if it keeps producing an empty `.app`. |
| `wda: unlock-required` | Physically unlock the iPhone once. |
| `Appium is unavailable on port 4725` | `npm run appium` not running, or a stale process on the port. |
| web returns 401 everywhere | An auth provider is configured — sign in, or unset `PHONE_FARM_AUTH_PLUGIN` on loopback. |
| `sh: appium: command not found` in an agent | Invoke via `node node_modules/appium/index.js …` if npm did not link the bin. |

`GET /health` lists the loaded plugins and versions. `wda:service`'s socket
has `/health` with per‑device state.
