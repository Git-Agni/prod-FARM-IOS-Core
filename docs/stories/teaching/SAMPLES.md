# Story sequence samples, 2026-10-21

Four ways to tell a Story sequence on one brand system: dark #0A0A0A, blue #2780FF, red key-word box, Inter, a reply keyword at the end. Renderer: `scripts/render-teaching-story.ts <spec>.json`. Frames go to `.scheduler-data/story-assets/teaching/<slug>/`. Nothing is queued or posted.

Every sample passed the Story vision scorer (`src/publishing/story-score.ts`, Gemma 4) on 2026-10-21:

| Sample | Score |
|---|---|
| A teach | 9.2 |
| B proof | 9.5 |
| C tool | 9.2 |
| D behind the scenes | 9.6 |

## A. Teach (a-teach-handoff.json, 8 frames, keyword HANDOFF)
- **Model:** Devin Jatho's live Story. One idea, one diagram that changes state across three frames, and a reply for the video.
- **Words:** from the camera script of "How to Build a Sales Team AI Can't Replace" (oT6alCHNwKA), C2C hub `docs/youtube/2026-09-10-long-form-batch-10/teleprompter/ALL-SIX-SCRIPTS.md` section 4.
- **Visuals:**
  - redrawn interfaces: a text thread, a call row and a calendar booking;
  - Antonio's pool photos;
  - the real YouTube thumbnail.
- **Open:** HANDOFF is not yet a `dm_keyword_assets` row.

## B. Proof stack (b-proof-stack.json, 6 frames, keyword RESPOND)
- **Model:** Devin Jatho's RESULTS Highlight. One result per frame, a boxed number and a ringed proof.
- **Proof:** the cards in `assets/` are screenshots from Antonio's public Highlights (`docs/stories/proof-cards.json`).
- **Numbers on the cards:**
  - $114,283 collected via AI SMS;
  - show-up rate 41% (Dec) to 65% (Jan);
  - close rate 24% (Nov 2025) to 30% (Dec 2025);
  - refunds 20.21% to 10.5%.
- **Note:** "Every new lead got a text in seconds, then a setter call" describes the C2C speed-to-lead mechanism from the RESPOND reel caption. It is not a figure from the card.
- **Keyword:** RESPOND is live; a published caption uses it.
- **Gap:** the cards carry no client names or client messages.

## C. Tool breakdown (c-tool-breakdown.json, 6 frames, keyword MIMIC)
- **Source:** the kit reel ReelMimic. Its claims were checked on 2026-10-20 in the C2C hub `artifacts/creative/2026-10-20-kraychete-reelmimic-45s/README.md`: free and MIT, 3,666 stars created 2026-09-28, the breakdown list, up to six agents, and a different agent reviews.
- **Images:** the official repo images and the reel cover.
- **Keyword:** MIMIC is live.

## D. Behind the scenes (d-behind-scenes.json, 6 frames, keyword MIMIC)
- **Model:** Nik Setting's founder-day timestamps.
- **Times, all from the ReelMimic build:**
  - 11:37 PM Monday (2026-10-19): cycle start, from the README;
  - 12:12 AM: the reference reel downloaded (`source-reference.mp4` creation time);
  - 12:13 AM: `script-locked.txt` created;
  - 12:41 AM: v2 render created;
  - 1:02 PM Tuesday (2026-10-20): Phone Farm published receipt, Instagram and Facebook.
- **Script facts:** 156 words and 18 beats, from the README.
