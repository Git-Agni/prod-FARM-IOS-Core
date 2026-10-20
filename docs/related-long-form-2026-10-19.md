# Topic-matched related videos, October 19, 2026

Antonio asked that each post link a related video about the same topic, not always the same one.

## YouTube Shorts (done, commit `d0122a1`)

- Catalog: `src/publishing/youtube-longform.json` lists the 13 public long-form videos on @antoniorevenue. A Short
  can only link a video on its own channel. Each entry lists every title seen (two videos run title tests) and a
  short topic list. Edit the topics to change what links where.
- Choice: `chooseLongForm` in `src/publishing/youtube-longform.ts` counts each topic found in the Short's title (2
  points) and in its description or tags (1 point). The highest score wins. Below 2, the Short keeps the default,
  DWREa1sv_Ho. No model call at posting time.
- Driver: the picker row must match one of the chosen video's titles and the owning channel. The receipt accepts
  any of those titles. The picker scrolls up to 60 times and stops when the list ends.
- New Shorts: `add-missing-shorts.ts` picks the video when it creates the item. `record-shorts-cover-review.ts`
  accepts any catalog video.
- Queue: `link-shorts-long-form.ts --queued --apply` re-linked 32 unclaimed Shorts at 21:43 PT. Armed Shorts kept
  their slots; release and item versions match. The choice is saved in `results.relatedLongForm`.
- VERIFIED live: the 22:22 PT Short d406f21d (logo) linked EJ3jguKfNB8, the oldest long-form in the picker, and
  published at https://youtube.com/shorts/YwfZsG1Eu-8 (Upload claimed once at 22:28:33 PT).

Typical picks: Claude Code tool Shorts link "I Rebuilt Alex Hormozi's $3,000 AI in Claude Code (Free)"; outbound
and lead Shorts link the WarriorBabe outbound video; memory and wiki Shorts link "I Turned My Entire Business Into
One AI Brain"; model news links the Jev video. Industry news with no topic hit keeps the default.

To refresh the catalog after a new long-form upload, add its ID, length, titles and topics to the JSON file.

## Instagram Reels (not built yet)

The Reel picker has no text in its accessibility tree. Today the driver finds one reviewed Reel by comparing its
cover image to a saved screenshot (`src/publishing/instagram-related.ts`). Faces look nearly identical across
covers, so image matching does not scale. Each tile does show a large cover headline, so the planned approach is:

1. Build a Reel catalog from posted Instagram items (caption, permalink, and the cover headline read from the
   source video's opening frame).
2. Pick the Reel by caption topic, the same way as YouTube.
3. In the picker, read tile headlines with the existing OCR and tap the one exact match. Stop on no match or
   two matches.

This needs attended calibration on the phone (no Share) before it runs in the worker.

## Same session: YouTube description Back

Two Shorts stopped with "Phone control is missing: Leave description" (Oct 19 20:22 and 21:22 PT). The two Back
taps had fixed short waits while the keyboard was up. The driver now waits up to 4 s for the details screen after
each tap and taps again only while the editor is still open, up to three times. Both stops were before Upload.
