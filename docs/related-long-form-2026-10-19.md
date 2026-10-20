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

## Instagram Reels (Oct 20)

Each Instagram post now links the owned Reel that matches its topic, chosen from `src/publishing/instagram-reels.json`.
The choice is deterministic (`chooseRelatedReel` in `src/publishing/instagram-related.ts`). A shared vocabulary topic
counts 1, a generic one (claude code, github, agent...) counts 0.5, at least one must be specific, and below 2 the
post keeps the reviewed default Reel (Claude YouTube). It never links the post itself, the same video (hash or
caption), or a re-cut with the same cover headline.

The picker tiles have no accessibility text. The driver OCRs each visible tile's top 60% (plain, and bright-text masks
at 190 and 110 so red and green words survive) and taps only when one tile matches the stored headline, either as a
fuzzy substring (0.8) or by covering 80% of its words in any order. A second tile within 0.15 stops the run, as does no
match after 12 scrolls. Nothing is tapped in either case. The default Reel keeps its saved-cover image match.

Verified live on Oct 20 (attended, no Share, composer of agency-blend, left through abandon and app reset):

- The picker lists only Reels on the main profile grid: regular Reels and promoted Trial Reels. None of the 50 newest
  Trial Reels appeared in 13 pages. So only catalog Reels with `inPicker: true` can be chosen.
- Six database Reels are identifiable there today: Fable 5.5, Never post without ChatGPT, If Claude keeps, ChatGPT 4
  upgrades, Canva carousels, Plan a website. "Never use Claude Code" is listed but its text sits on a photo; OCR fails.
- Fable 5.5, Never post and ChatGPT 4 upgrades were found and tapped (Edit linked reel opened, then Cancel). Plan a
  website ran the full selection: label saved, readback "Linked reel · Plan a website", preflight passed before Share.
- Instagram keeps 15 characters of the link title ("Plan your website in 6 docs" saved as "Plan your websi"). The
  input check now rejects labels over 15.

Evidence (local, not committed): `docs/evidence/instagram-related-topics-2026-10-20/`.

Scripts: `refresh-instagram-reels.ts` adds newly published Reels (headline from the opening frame, `inPicker` false);
`calibrate-related-reels.ts ITEM_ID URL,URL` repeats the attended check; `link-reels-by-topic.ts --queued [--apply]`
sets each queued post's related Reel.

Open limits: none of the Oct 20 queue (leads, phone, Harvey, agency topics) matches the six picker Reels, so those
posts get the default. Many topic-rich picker Reels ("AI answers your calls 24/7", "Entire AI agency free on GitHub")
predate the database and have no permalink or exact caption on file. Adding them needs a read-only profile scan.

## Same session: YouTube description Back

Two Shorts stopped with "Phone control is missing: Leave description" (Oct 19 20:22 and 21:22 PT). The two Back
taps had fixed short waits while the keyboard was up. The driver now waits up to 4 s for the details screen after
each tap and taps again only while the editor is still open, up to three times. Both stops were before Upload.
