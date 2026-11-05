# YouTube arming fix, October 19, 2026

## Result

- 11 held or failed Shorts armed through the normal worker path (`autopilot-backlog.ts --lane=youtube`, then `lane-slotter.ts`).
- 2 Shorts verified live on @antoniorevenue through the YouTube Data API and marked published with a receipt.
- Worker fix in commit `0e7910d` (`src/publishing/youtube-release.ts`), loaded by restarting `ai.clicktoclose.phone-farm.worker` at 08:35:54 PT.

## Why arming returned 409

VERIFIED (code and data). `POST /items/:id/arm` in WDA mode accepts a YouTube item only when
`results.directYouTubeReview.coverReviewed` is true and its `sourceSha256` matches the file. The hourly
`autopilot-backlog.ts` also requires `relatedVideoId` to match the reviewed long-form video. The Harvey cuts and five
other Shorts had neither, so the API returned "YouTube Shorts are preparation only" and the backlog kept them out with
"Short needs a frame-zero cover review". Capabilities still say `youtube: preparation_only` because that field reports
the old mirroring flow. Reviewed Shorts do arm and post in WDA mode: 42 Phone Farm Shorts are recorded published, and
all 42 titles appear on the channel uploads list.

Fix for these items: `link-shorts-long-form.ts` added the reviewed long-form link, a frame-zero visual check confirmed a
readable headline on each, and `record-shorts-cover-review.ts` saved the review.

## Why armed Shorts ended in needs_review

VERIFIED on the saved failure frames in `.scheduler-data/release-failures/`, replayed through the same OCR:

1. Tags check. OCR reads the capital I in typed chips "AITools" and "AIAgents" as a lowercase l ("AlTools",
   "AlAgents"). Every chip was typed correctly, but the check failed. Replayed on the 8e63fd91, 35b7c005 and
   11216851 frames. The other October 18 and 19 failures (d406f21d, 0c3ab52f) also carry an "AITools" tag; their
   frames were not replayed.
2. Tags row. A title containing the word "Tags" ("Walmart's Price Tags Now Light Up From Your Phone") gave a second
   "Tags" match, so the row search stopped as ambiguous.

Both stops happen before Upload. Every one recorded `shareAttempted: false` and no Share claim, so no duplicate upload
was possible. The backlog retried each one up to three times.

Fix: `nativeTagsMatch` folds I, l, 1 and | together before comparing tags. `metadataRowMatches` accepts a row label
only in the left label column (x 100 to 300 px). The title starts at about 321 px, and mid-line description words sit
further right. Tests: `test/youtube-release.test.ts`. On the real frames, the old check misses AITools and AIAgents.
The new check matches all five tags, still rejects a missing tag, finds no title match for Tags, and still finds
Description, Related video and Visibility.

## Item states after this run

| Item | Short | State | Pacific time / proof |
|---|---|---|---|
| f7f42b6d | harvey-alt-c | armed | Mon Oct 19 14:22 |
| 205ddd40 | harvey-cut2 | armed | Mon Oct 19 17:22 |
| 792511c9 | walmart-shelf (Tags row failure) | armed | Mon Oct 19 20:22 |
| 18336f1f | harvey-cut1 | armed | Mon Oct 19 21:22 |
| 8e63fd91 | gemini4 (tags failure) | armed | Mon Oct 19 22:22 |
| 1249ca3a | flow-ai-sales-manager | armed | Mon Oct 19 23:22 |
| 76876e65 | harvey-cut3 | armed | Tue Oct 20 07:22 |
| adee9f48 | harvey-alt-a | armed | Tue Oct 20 08:22 |
| afb93e10 | claude-fake-tip (3 phone-control stops) | armed, retry counter reset | Tue Oct 20 09:22 |
| 24e95d86 | comfyui | armed | Tue Oct 20 10:22 |
| c70367e8 | ruflo | armed | Tue Oct 20 11:22 |
| 848061c9 | freellmapi | published | https://www.youtube.com/shorts/kl1FDHbl5Zw (public, Oct 6) |
| e6a88eb7 | cc-channel | published | https://www.youtube.com/shorts/ofPWiMItYBs (public, Oct 6) |

Before re-arming, the YouTube Data API uploads list for channel `UCMZWuXp0lsxE2vmuifYMWuA` showed none of the armed
titles. The public RSS feed returned 404 and the API key is IP-restricted to the VPS. The read used the
`Ronaldo YouTube OAuth` item in 1Password (c2c-monorepo vault). Evidence for the two published items:
`docs/evidence/youtube-arming-2026-10-19/verified-external-deliveries.json`, recorded by
`scripts/record-verified-youtube-delivery.ts`.

Kept held: ajs (a9235090) and orca (a5c76f88) because their Instagram items are still in review. yt1019 (c1cb8ee9)
is held because its Instagram and TikTok items are armed but not yet posted.

## Open items

- 209d708b (ajs) and 7a988dca (orca) are Instagram/Facebook items, not Shorts. Their Share was claimed and the receipt
  check found no matching Trial Reel. `requeue-verified-unposted.ts` checks claims only after 24 hours, which is
  about 11:02 and 13:02 PT on Oct 19. Their Shorts wait for that result.
- The capabilities `youtube` field still reads `preparation_only` in WDA mode. It should report the reviewed-Short rule.

## Follow-up at 13:06 PT: ajs and orca

VERIFIED posted. `requeue-verified-unposted.ts` (dry run, 13:06 PT) found the caption for both Instagram/Facebook items
and kept them out of the re-queue. A Graph read then confirmed one match each. Both were created after the Share claim,
both have the exact full caption, and both are Trial Reels (`is_shared_to_feed: false`). The receipt check had missed
them because "The Trial reels menu is not safely visible". No re-queue ran and no second Share was tapped.

| Item | Platform | Share claimed (PT) | Posted (PT) | Receipt |
|---|---|---|---|---|
| 209d708b (ajs, HIRING) | Instagram Trial | Sun Oct 18 11:02 | Sun Oct 18 12:03 | https://www.instagram.com/reel/DepR5BpoA27/ |
| 209d708b (ajs) | Facebook | | Sun Oct 18 12:03 | https://www.facebook.com/reel/1792319398377886/ |
| 7a988dca (orca, FLEET) | Instagram Trial | Sun Oct 18 13:02 | Sun Oct 18 13:53 | https://www.instagram.com/reel/Depfon3yFHZ/ |
| 7a988dca (orca) | Facebook | | Sun Oct 18 13:53 | https://www.facebook.com/reel/1767043441199328/ |

Both items moved from `needs_review` to `published` with these receipts in `results.release.receipts` (guarded update,
only rows still in `needs_review`). Evidence: `docs/evidence/youtube-arming-2026-10-19/ig-fb-ajs-orca-receipts.json`.
The TikTok siblings were already published (ec3d7a16, 470ca8f6).

Shorts:

1. `link-shorts-long-form.ts` linked both to the reviewed long-form `DWREa1sv_Ho`.
2. Frame zero checked by eye on both files. ajs: "HIS AI WROTE 69 APPLICATIONS / THEN HE GOT HIRED". orca:
   "5 CODING AGENTS ONE TASK / PICK THE WINNER". Both have logos, a readable headline, a clear face with the mouth
   closed, and nothing clipped. Recorded with `record-shorts-cover-review.ts claude-frame0-oct19`.
3. `autopilot-backlog.ts --lane=youtube --every-hours=2 --no-shift --apply` armed 2. `lane-slotter.ts --apply` moved 17.

Readback, `GET http://127.0.0.1:3000/api/publishing/releases` at 13:08 PT:

| Item | State | Run at (PT) |
|---|---|---|
| a9235090 (ajs Short) | armed | Mon Oct 19 16:22 |
| a5c76f88 (orca Short) | armed | Mon Oct 19 19:22 |
| 209d708b (ajs IG/FB) | published | Sun Oct 18 11:00 slot |
| 7a988dca (orca IG/FB) | published | Sun Oct 18 13:00 slot |

The slotter re-spaced the earlier armed Shorts. YouTube lane now: 16:22 ajs, 17:22 f7f42b6d, 18:22 d406f21d,
19:22 orca, 20:22 76876e65, 21:22 35b7c005, 22:22 205ddd40, 23:22 7a043873, then Tue Oct 20 07:22 d828a49e,
08:22 792511c9, 09:22 18336f1f, 10:22 8e63fd91, 11:22 1249ca3a, 12:22 adee9f48, 13:22 afb93e10, 14:22 24e95d86,
15:22 c70367e8.

Still open: the receipt check misses Trial Reels when the Trial menu is not visible. The Graph check (24 hours later)
caught it. The yt1019 Short still needs a frame-zero review once its IG and TikTok items post.
