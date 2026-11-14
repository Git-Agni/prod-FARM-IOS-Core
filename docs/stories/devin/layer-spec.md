# Devin Jatho live Story: layer spec

Source: his 8-frame live Story from 2026-10-21, "Social media is dead". The originals are at 480x853 in `../reference/devinjatho/live-2026-10-21/orig/`. Every value below is measured from those files and scaled x2.25 to 1080x1920. The renderer is `scripts/render-devin-story.ts`, and the first copy is `business-hours.json`.

## System
- **Font:** SF Pro, the system font, in `system-ui`.
  - Titles: weight 500 (centered) or 400 (left), with the key phrase at 700.
  - Hook: 700, uppercase. Tracking runs from -0.6 to -3 px depending on size.
- **Palette** (sampled):

| Use | Color |
|---|---|
| Hook red box | #E03842 |
| Red text | ~#F2434D |
| Green ("attract", Reply quote) | #42E083 / #45E58A |
| Mint ("demonstrations of your expertise") | #4BC597 to #5EE8B0 |
| Card icons | orange #F8930D, teal #3DE99B, cyan #1EF5F5 |
| Stamp tape | #D6272C |
| Orbit blue | ~#4FB8E6 |
| Background | #000 to #060606 |

- **Pull line:** 48 px weight 500, right-aligned near y 1550 to 1590, with a 4 px white underline under it and a 👉 emoji.
- **Safe areas:** the top 200 px stays clear (Instagram header). So does everything below y 1800 (reply bar).

## Frame 1: cover (photo plate)
1. A photo plate: a weathered granite tombstone, centered, in a misty cemetery under a teal overcast sky. The stone runs y 607 to 1530 and x 256 to 855.
2. A top vignette, darker teal, from 0 to 35% of the height.
3. Four icons carved into the stone face in a 2x2 grid, each about 170 px. Rows sit at about 20% and 45% of the stone's height.
   - Each carving is a dark translucent fill, an inner shadow at the top left, and a highlight at the bottom right.
4. The headline: 115 px / 139 px, weight 700, uppercase, white, centered, with its top at y 248.
   - The last word sits in the red box: square corners, 18 px side padding, full line height.
   - Soft text shadow: 0 4 24 rgba(0,0,0,.35).
5. A bottom fade from 72% (transparent) to 100% (92% black).
6. A sub line: 62 px / 77 px, weight 500, centered, at y 1638. One bold word, a red phrase, then 👉.

## Frames 2 and 3: person and orbit
- A full-bleed photo of a person looking at a phone or off to the side, graded dark. A left-to-right black gradient covers 65% to 0% of the width.
- **Title:** left x 106, top 295. Regular 80/94, with the key phrase bold on its own line.
  - In frame 3 the key phrase is an uppercase 112 px bold line.
- **Body:** left x 106, top 765, 56/66 regular, last line bold.
- **Orbit:** one or two thin blue ellipses (4 px, glowing) around the head.
  - Frame 2 has round avatar bubbles (about 100 px with a colored ring) on the orbit.
  - Frame 3 has glass chips: a pill with a 2 px white border at 28%, an icon, and 36 px text.

## Frames 4 to 6: the tree
- **Backdrop:** black, with a dim photo of the creator at the bottom, masked to fade in from about 25% of its height. Brightness about 0.17.
- **Title:** centered at y 270, 62/74 weight 500, one colored word.
  - Frame 6 has three lines, with a red underline on the last one.
- **"You" node:** 299x238 at (380, 493). Radius 36, a black gradient, a 2 px border at 10% white. "You" in 40 px. A 146 px circular avatar with a 5 px white ring.
- **Connectors:** dashed curves (4 px, dash 16/12) from the bottom of the node (y 731) to the card tops (y 831).
  - In frame 6 they turn red for the stamped cards.
- **Cards:** 270x443 at x 97, 394 and 691, top 853. A light gray frame (#E7E7E7, radius 22) with a 58 px header carrying a 31 px label. Below it, a photo with a 14 px radius.

| Frame | State | Card contents |
|---|---|---|
| 4 | 1 | A glowing icon on each photo |
| 5 | 2 | A big colored stat (96 px, 700) and a 42 px label |
| 6 | 3 | Two stamped cards; the third fades to 32% |

- **Stamp (frame 6):** red tape rotated -8 degrees, 40 px weight 800 uppercase, rough clipped edges, a drop shadow. The stamped card loses its stat and gets a pink frame.

## Frame 7: showcase
- Title at y 225, 64 px weight 500, with a green underline under the key phrase.
- Line 1 on the left (x 127, y 380), 54 px, with a mint bold second line.
- Each row has a sharp center card (288x481, 3 px light border, deep shadow) between two blurred, dimmed side cards that show other real posts.
- A 2 px #2C2C2C divider at y 1058. Line 2 is centered at y 1115, then the second row.

## Frame 8: CTA
- Title at y 296, 58/82 weight 600, ending in 👇.
- A white YouTube card: x 90, y 574, 900 wide, radius 36, padding 27.
  - The thumbnail (470 tall, radius 16) carries player controls: play, next, time, a red progress bar, and settings icons.
  - Video title: bold 32 px, dark.
- `Reply "KEYWORD"` at y 1318: 116 px weight 700, with the quote in green.
- "and I'll send it to you" at y 1462, 44 px regular.
- The bottom has a dim warm photo.
