# Posting without Claude

Checked on October 17, 2026. Every step from an armed calendar item to a published post runs as plain launchd jobs, TypeScript and SQL. No Claude session, Claude scheduled task or language model sits in that path. A test guards this: `test/no-model-in-posting-path.test.ts`.

## Check it

```bash
node --env-file-if-exists=.env --import tsx scripts/autopilot-status.ts
```

It is read-only. It prints the launchd agents, the worker heartbeat, WDA and the phone, the lane hours, the next 6 slots per platform with the booked video, posts published in the last 24 hours, and every missed slot. It exits with code 1 when something blocks posting. Add `--json` for machine output.

## Inventory

| Step | Component | Script or model | Runs where |
|---|---|---|---|
| Calendar and claims | Supabase Postgres, `scheduler.*` tables | SQL | Cloud |
| Post at the slot | `ai.clicktoclose.phone-farm.worker` → `src/scheduler/worker.ts`, `src/publishing/release-loop.ts`, `timed-release.ts` | Script | Mac |
| Instagram Trial + linked Facebook, TikTok, YouTube Shorts drivers | `src/publishing/*-release.ts` over WDA | Script | Mac + iPhone |
| Receipt checks | release loop, read-only, up to 3 passes | Script | Mac + iPhone |
| First comments and pins | release loop → `post-comments.ts` | Script | Mac + iPhone |
| Phone control | `wda` (WebDriverAgent service), `appium` | Script | Mac + iPhone |
| Hourly re-arm of missed posts | `backlog` at :05 → `instagram-trial-on`, `one-variant-per-video`, `autopilot-backlog --no-shift` (social, youtube), `lane-slotter`, `upgrade-queued-media` | Script | Mac |
| Posting times | `lane-slotter.ts`, hours in `src/publishing/cadence.ts` or `.scheduler-data/lane-hours.json` | Script | Mac |
| Alerts | `slot-alert` (30 min), `device-alert` (5 min), `monitor` (15 min), `burn-in` (3 h), `summary` (8 PM) | Script, Slack DM | Mac |
| Database backup | `backup` at 3:17 AM | Script | Mac |
| Control page | `web` (`src/api/server.ts`) + `tunnel` (cloudflared) → phonefarm.clicktoclose.ai | Script | Mac, served through Cloudflare |
| Status page | Cloudflare status worker | Script | Cloud |
| Keep awake, mute | `awake` (caffeinate), `audio-mute` | Script | Mac |
| Story plans | `ensureWeekPlans` in `story-lifestyle.ts` | Script, no model | Mac |
| Story draft capture | `wda-stories.ts` | Script | Mac + iPhone |
| Story quality score | `story-score.ts`: Gemma 4 26B, Qwen3-VL fallback, on OpenRouter, plus an on-device text check | **Model (not Claude)** | OpenRouter |
| Story publish | `wda-stories.ts` after approval | Script | Mac + iPhone |
| Making videos | Claude scheduled tasks `reel-clone-cycle`, `kraychete-daily-reel`, `c2c-3d-plushy-heygen-hook` | **Claude** | Claude |

## What still uses a model

- **Video creation.** The three Claude scheduled tasks make videos and arm them. None of them posts. Posting works without them. With no new videos, the calendar simply runs out once the armed queue is used up.
- **Story score.** The vision model only decides whether a captured Story auto-approves. A failed or missing score means the Story waits for review. It never blocks video posting. The worker isolates the Story step, so a Story error cannot skip receipt checks or comments (fixed Oct 17).

## What cannot run in the cloud

Posting cannot be cloud-only. Apple requires a Mac with Xcode and WebDriverAgent connected to the iPhone over USB to drive it. The Mac also needs internet, because the calendar lives in Supabase.

Evidence from Oct 17: the 7 PM and 8 PM PT slots were missed when the laptop lost internet. The worker log shows `getaddrinfo ENOTFOUND aws-1-us-east-1.pooler.supabase.com`. Those posts went to review, and the hourly backlog job re-arms them without help.

Cloud parts today: Supabase (calendar, claims, receipts), the Cloudflare status worker, and the control page through the tunnel.

## Proposal: an always-on station

To remove the laptop, put a Mac mini with the iPhone on USB power at a fixed place with wired internet and a UPS. Run the same launchd agents there (`scripts/launchagents/*.plist`). The laptop is then only needed to make videos. This is a proposal. Nothing has been bought.

## If posting stops

1. Run `scripts/autopilot-status.ts` and read the problem lines.
2. No internet: posting resumes on its own when the network returns. The hourly backlog job moves missed posts to new slots.
3. WDA not ready or phone locked: unlock the phone. `device-alert` retries the WDA runner.
4. Worker heartbeat stale: restart only with `.scheduler-data/diag/restart-when-idle.ts`.
5. Never clear a Share claim or repost an uncertain post. Those stay in review.
