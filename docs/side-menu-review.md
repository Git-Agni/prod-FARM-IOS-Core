# Side menu review (Oct 30, 2026)

We compared the Phone Farm dashboard against our design and dashboard skills, then
replaced the top-right button row with a left side menu.

## What changed

- Every full page now has a left menu, rendered by the server (`src/api/sidebar.ts`)
  so it appears with the page instead of after a script runs.
- Menu items: Devices, Publishing, Story drafts, Tasks, and Register device under
  Setup. Each has an icon and a text label. The current page is marked with
  `aria-current="page"` and a lighter background.
- Publishing shows three counts under its label: posts today, posts that need review
  (any day), and upcoming posts that are held and not armed. The calendar sends these
  numbers to the menu after it renders, so the menu and the calendar tiles always agree.
  Other pages reuse them for up to 10 minutes, then hide them.
- Devices shows a green dot when the iPhone is online. The menu footer says it in words.
- Under 900 px the menu becomes a drawer behind a menu button. Escape or a tap on the
  dimmed page closes it. A closed drawer is out of the tab order.
- Page buttons moved off the old top bar. Refresh now sits in the Devices and Tasks page
  headers. The device page keeps its own action buttons in a slim bar.
- No posting logic, API or data changed. The only new routes serve the menu's CSS and JS.

## Skill rules and gaps

| Source | Rule that applies | What the pages did before | Change |
| --- | --- | --- | --- |
| ui-ux-pro-max (`nav-label-icon`, `nav-state-active`) | Icon plus label per item, a clear active state | Text-only buttons; Devices and Tasks pages had no current marker | Icon and label on every item, `aria-current` and a highlight |
| ui-ux-pro-max, impeccable layout | Same nav, same place, on every page | Four different top bars: Devices, Tasks, Register and Publishing each listed different links | One menu from one file on every page |
| impeccable, ui-ux-pro-max | 44 px targets, visible focus ring, skip link | 34 px buttons, no skip link | 44 px rows, `:focus-visible` ring, "Skip to content" link |
| impeccable responsive, Sidebar.tsx gaps | Mobile drawer starts closed, labelled toggle, `aria-expanded` | Buttons wrapped into two or three rows on a phone | Drawer with labelled toggle; starts closed |
| ui-ux-pro-max (`tab-badge`), dataviz habit of text plus color | Counts used sparingly, never color alone | Counts existed only inside the calendar | Three counts on Publishing, each with words ("19 review", "18 held") |
| design-taste-frontend | One accent, no purple, one icon style | Pink accent on dark pages, black on light pages | Menu uses neutral grays; red and amber only for review and held |
| C2C hub `apps/dashboard` Sidebar.tsx | House reference for nav | n/a | We kept its 240 px width and drawer idea but not its purple, its missing active state or its open-by-default mobile drawer |
| BRANDING_GUIDELINES.md | Dark surfaces, gray text, green for success | Already close | Menu uses the same dark shell colors as the old top bar |

## Still open (not in this change)

- The publishing page shows "Loading..." and zeros for about 15 seconds on first load.
  Design-taste-frontend asks for skeletons sized to the real tiles. That page also loads
  every item before it renders; the fix belongs in `static/publishing/app.js`.
- Banners can contradict each other, for example "Video posting is paused" while
  Instagram and TikTok posted. No skill covers this. The banner text should come from the
  same check that decides whether posts run.
- Theme split: the device pages are dark and the publishing pages are light. The menu
  is dark on both so it reads the same, but the pages themselves still differ.
- The Story drafts pages (`static/publishing/stories/index.html`, `history.html`) are not
  committed in git yet. The menu reaches them because the server adds it to every page,
  but their old top-bar links are hidden by CSS, not removed from the files.
- `dataviz` skill was not found on this Mac, so its rules were not checked.
