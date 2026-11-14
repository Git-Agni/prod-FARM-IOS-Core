# Daily Instagram and Facebook Stories

Owner: Antonio. Daily slots: 09:00 and 17:00 America/Los_Angeles, starting with the October 4 cadence change. Scheduler: the local Phone Farm worker. Codex routine `daily-instagram-and-facebook-stories` is paused. No Claude or Codex routine owns this schedule. The older Reel-to-Story reshare watcher is separate and unchanged.

## Current state

The app worker records the next daily slot in scheduler.story_daily_slots. GET /api/publishing/stories/schedule shows it in the Story studio. Slots wait for a draft; when due without a ready publisher, they become blocked. The worker creates the next slot once, even across restarts. It does not generate copy, select images, build native drafts or publish Stories yet. Native publishing and independent Facebook Story receipts still need a live test.

Actual native draft previews: http://127.0.0.1:3000/publishing/stories#native-proof . These five landscape drafts show the native treatment, but predate the proof-led rule. The updated five-frame plan is at #proof-pilot and in docs/story-proof-led-pilot.json. Its proof frame uses the actual September 30 calendar. It needs five different reviewed images before it can pass the current policy. Build and review its native drafts before release. Do not pass the older landscape-only set as a compliant sequence.

The existing approval rule remains: show Antonio the actual native sequence before publication. His request authorizes setting up the daily job; it does not supply approval for unseen new copy. If he grants standing approval, record the exact scope in this file and both root instruction files. The proposed 09:00 time can be changed when he replies.

## Native publisher build contract (not yet implemented)

1. Read the policy and inspect the latest queue and device state. Check existing sequence receipts for today's Los Angeles date before creating anything. Scheduled video releases take priority. If a release is due within five minutes, defer phone work.
2. Prepare one fresh sequence: real moment, problem, checked proof, lesson, one reply question. Use reviewed gallery or work photos and current proof. Never call an old photo today's photo or invent a result. Save the manifest and exact asset references under docs/stories/YYYY-MM-DD/. Run POST /api/publishing/stories/review and inspect the source assets yourself.
3. Acquire the same PostgreSQL advisory lock used by release-loop.ts for device 00008130-000229EE1AA0001C. Hold the connection through all WDA actions. Use scripts/story-attended.ts for native controls. Never use QuickTime or the Mac camera or microphone.
4. Build native text with readable contrast and open space. Add licensed in-app background music in Music only style, without its visible sticker. Listen to the result. Save actual native previews for review. Browser mockups do not prove native drafts exist.
5. Check approval and intended accounts. Instagram must be @antoniorevenue. The linked Facebook destination must be Antonio Revenue, profile 61584693917444. Map the actual Story sharing controls before selecting Share. If any control or destination is uncertain, stop before sharing.
6. Claim each frame atomically before its single Share. Use scheduler.engagement_actions with claim_key `story:SCHEDULED_TIMESTAMP:antoniorevenue:frame:N` and action `story_sequence`, where N is 1 through 5. Insert with ON CONFLICT DO NOTHING RETURNING claim_key. An existing claim means inspect only, never Share again. Save the manifest SHA-256, sequence ID and frame number in result. The scheduled timestamp stays the same if a draft is rebuilt. A rerun cannot repeat that sequence, while the second daily slot has a separate claim. Keep older day-only claims intact.
7. Share frames in order. Verify the exact image and text in Instagram's live Story viewer, then independently on the Antonio Revenue Facebook Story. Save timestamped screenshots and per-platform receipts to the same claim. Set done only when both destinations match. If one destination is uncertain, mark uncertain_review, stop the sequence and report the gap. Never create a separate Facebook upload as an unapproved fallback.
8. Return the phone Home and release the lock even on failure. Report complete publication, a fresh draft needing approval, failure or required action. Stay quiet when nothing meaningful changed.

## Safe validation

A draft run may read records, import reviewed images, edit native text and save drafts. It must not select Share. A release test needs an approved exact sequence. Verify each frame on both destinations; a closed composer or a Facebook sharing badge alone is not delivery proof.

The local slot scheduler is implemented. The native publisher contract above is not yet implemented or validated. No video release state, existing TikTok limit or Metricool schedule changes as part of a Story run.

## October 1 refinement

The NORA sequence passed an attended five-frame release. Every frame was checked in Instagram and Facebook. The third frame used a native Reel share; the others used native text and Music only audio. Evidence: docs/stories/2026-10-01/nora-preview/publication-receipt.json. This proves the attended path, not the unattended publisher described above.

The app now keeps three future 09:00 Pacific planning slots. Each exposes a preparation time 24 hours earlier. The worker writes a heartbeat only after a successful tick. Web startup may seed future slots but cannot create a healthy worker signal. A heartbeat older than two minutes is stale. Missing heartbeats must appear as a runtime gap in the studio. Missed slots remain blocked and never trigger a catch-up Share.

At this checkpoint, the Mac worker and WDA LaunchAgents are disabled. They have not been re-enabled. Publication is still disabled for Stories. Keep that state visible; a calendar entry is not a running cron or a release promise.

Next plans: docs/stories/next-sequences.json. October 2 ROADMAP, October 3 SCRAPE, October 4 PROMPT are review targets, not armed publication dates. Confirm the actual source post and keyword route before drafting. Pick exact camera-roll assets and trims, inspect them with vision, then build native drafts for Antonio. No new sequence is approved by approval of NORA.


## Shared phone lock and Story planner, October 2, 2026

Read docs/stories/2026-10-02/phone-queue-and-story-scheduler.md. Every task must use the device advisory lock, including manual app controls. The general executor now owns it; preview and engagement tasks reuse that ownership. Do not run raw WDA controls beside scheduled work. Different phones can work in parallel.

The existing worker LaunchAgent runs in story_planning mode. It maintains daily 09:00 Pacific review targets and heartbeats only. It does not run video releases or native Story publishing. No second schedule owner was added. ROADMAP is saved for review on October 3, not armed. Automatic Story publishing still needs the native driver and per-frame Instagram/Facebook receipts. Do not infer approval from a request to save or schedule a draft.


October 4 cadence update: maintain six future review slots, two each day at 09:00 and 17:00 Pacific. This replaces the single daily slot. Native publication and draft approvals retain their existing guards.

## October 13, 2026: driver merged, builder added

- The WDA Story driver from PR #1 is rebased onto `codex/phone-farm-publishing` (commit `6b0e2c5`). All 245 tests pass in the main checkout.
- `scripts/build-story-sequence.ts SPEC.json [--save]` builds a five-frame plan from the newest posted Reel with a verified Graph receipt. It refuses an older Reel, writes PNGs to `.scheduler-data/story-assets/DATE-SLUG`, copies them with `manifest.json` and `plan.json` to `docs/stories/DATE/SLUG`, runs the policy review and, with `--save`, stores the plan for its slot. It never touches the phone and never approves.
- Video slots now sit at :22 on odd Pacific hours, plus some extra on-the-hour releases. A 09:00 or 17:00 Story has about 22 minutes before the next :22 video. The runner does not start within 15 minutes of an armed video.
- The runner still accepts PNG photo frames only. Native Reel share and B-roll frames are not supported yet.

## October 13, 2026 (night): Stories run as scripts, no model

**Standing approval (Antonio, chat, Oct 13):** script-built five-frame Stories from his own published feed Reels, with text from that Reel's caption or fixed neutral lines. Recorded in `storySchedule.standingApproval`. Any other format still needs his approval of the native drafts.

How it runs (local worker, no Claude):
1. `ensureSpotlightPlans` builds a `reel_spotlight` plan for each 09:00 and 17:00 slot 1 to 30 hours ahead, from the newest unused feed Reel (verified receipt, not Trial). Frames are full-bleed stills of that Reel; text comes from its caption (CTA sentences dropped), a keyword CTA, or fixed lines. A plan that fails review is not saved.
2. `captureNextDraft` captures the five native drafts on the phone (no Share), retrying up to three times; "Phone busy" does not use an attempt.
3. Spotlights are approved under the standing approval; until the WDA flow holds a pilot certificate the job runs as the pilot.
4. At the slot, one claim and one Share per frame. Receipts: Instagram Graph shows exactly one new Story; Facebook is the cross-post proven on the share sheet (`facebook_crosspost`), because the Page `/stories` edge does not list Stories cross-posted from Instagram (the Facebook app showed the Story ring on Oct 13).

iOS 27 driver facts: with a Story live, the tray add badge is `story-tray-add-button`; Select album keeps its sideways scroll, so albums are found by the picker's Search with the exact PF- name; after Share, "Also share to" is closed with Done only.

Oct 13 results: 17:00 pilot posted frame 1 on Instagram and stopped (Facebook receipt rule, since fixed). No-Share rehearsal with a Story live: 5 frames in 547 s. The worker then built, captured and armed the Oct 14 09:00 spotlight by itself.

## Oct 15, 2026: weekly lifestyle sequences

- The worker builds a lifestyle plan for every 8:00 AM and 4:00 PM slot up to 7 days ahead (`src/publishing/story-lifestyle.ts`). No model runs.
- Photos come from `docs/stories/photo-pool.json` (284) and the Dropbox folder `C2C/B-Roll/Stories`. Proof cards come from `docs/stories/proof-cards.json`.
- Frame 5 carries a native link sticker to the Reel. Readback must find exactly one sticker.
- Check the week: `node --env-file-if-exists=.env --import tsx .scheduler-data/diag/week-state.ts`.
- If a capture fails with "Capture all five actual native drafts", compare revisions with `.scheduler-data/diag/rev-check.ts <sequence id>`. Fixed in `1833da0` (undefined keys in the revision hash).
