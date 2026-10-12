---
version: alpha
name: Nadeye
description: Nadeye detects AI-generated images on-device and records verdicts on Monad. Built on Monad's brand kit; night theme first, day theme as -day tokens.
colors:
  primary: "#6E54FF"
  on-primary: "#FFFFFF"
  secondary: "#DDD7FE"
  neutral: "#0E091C"
  surface: "#0E091C"
  surface-raised: "#18112E"
  surface-sunken: "#221A3B"
  line: "#3A2F5C"
  line-strong: "#7A6CAE"
  on-surface: "#F3F0FF"
  on-surface-muted: "#A99FCC"
  accent: "#A797FF"
  verdict-ai: "#FF8EE4"
  verdict-real: "#85E6FF"
  verdict-unsure: "#FFAE45"
  ice: "#B9E3F9"
  on-verdict: "#0E091C"
  focus-ring: "#DDD7FE"
  surface-day: "#F8F6FF"
  surface-raised-day: "#FFFFFF"
  surface-sunken-day: "#EEEAFE"
  line-day: "#DDD7FE"
  line-strong-day: "#8A7EC0"
  on-surface-day: "#0E091C"
  on-surface-muted-day: "#5A5277"
  accent-day: "#5B40F2"
  ai-ink-day: "#A3166F"
  real-ink-day: "#00708F"
  unsure-ink-day: "#8F5100"
  focus-ring-day: "#6E54FF"
typography:
  display-xl:
    fontFamily: Hanken Grotesk
    fontSize: 56px
    fontWeight: 700
    lineHeight: 58px
    letterSpacing: -0.02em
  display-lg:
    fontFamily: Hanken Grotesk
    fontSize: 40px
    fontWeight: 700
    lineHeight: 44px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Hanken Grotesk
    fontSize: 20px
    fontWeight: 600
    lineHeight: 26px
  numeral:
    fontFamily: Hanken Grotesk
    fontSize: 28px
    fontWeight: 700
    lineHeight: 32px
    fontFeature: '"tnum" 1'
  body-md:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: 400
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: 400
    lineHeight: 20px
  body-strong:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: 600
    lineHeight: 24px
  label-md:
    fontFamily: Roboto Mono
    fontSize: 11px
    fontWeight: 500
    lineHeight: 16px
    letterSpacing: 0.12em
  button:
    fontFamily: Roboto Mono
    fontSize: 13px
    fontWeight: 500
    lineHeight: 16px
    letterSpacing: 0.02em
  data:
    fontFamily: Roboto Mono
    fontSize: 13px
    fontWeight: 400
    lineHeight: 20px
  badge:
    fontFamily: Roboto Mono
    fontSize: 12px
    fontWeight: 500
    lineHeight: 16px
rounded:
  pixel: 2px
  sm: 8px
  md: 12px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  base: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
  gutter: 16px
  max-width: 1080px
components:
  page:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    padding: "{spacing.gutter}"
    width: "{spacing.max-width}"
  page-day:
    backgroundColor: "{colors.surface-day}"
    textColor: "{colors.on-surface-day}"
  hero-title:
    textColor: "{colors.on-surface}"
    typography: "{typography.display-xl}"
  section-title:
    textColor: "{colors.on-surface}"
    typography: "{typography.display-lg}"
  panel:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.md}"
    padding: "{spacing.lg}"
  panel-title:
    textColor: "{colors.on-surface}"
    typography: "{typography.headline-md}"
  panel-border:
    backgroundColor: "{colors.line}"
  panel-day:
    backgroundColor: "{colors.surface-raised-day}"
    textColor: "{colors.on-surface-day}"
  panel-border-day:
    backgroundColor: "{colors.line-day}"
  text-muted:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.body-sm}"
  text-muted-day:
    backgroundColor: "{colors.surface-raised-day}"
    textColor: "{colors.on-surface-muted-day}"
  link:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.accent}"
  link-day:
    backgroundColor: "{colors.surface-day}"
    textColor: "{colors.accent-day}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: 12px
    height: 36px
  button-secondary:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.on-surface}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: 12px
    height: 36px
  button-secondary-border:
    backgroundColor: "{colors.line-strong}"
  button-secondary-border-day:
    backgroundColor: "{colors.line-strong-day}"
  focus-ring:
    backgroundColor: "{colors.focus-ring}"
    size: 2px
  focus-ring-day:
    backgroundColor: "{colors.focus-ring-day}"
    size: 2px
  badge-ai:
    backgroundColor: "{colors.verdict-ai}"
    textColor: "{colors.on-verdict}"
    typography: "{typography.badge}"
    rounded: "{rounded.full}"
    padding: 8px
  badge-real:
    backgroundColor: "{colors.verdict-real}"
    textColor: "{colors.on-verdict}"
    typography: "{typography.badge}"
    rounded: "{rounded.full}"
    padding: 8px
  badge-unsure:
    backgroundColor: "{colors.verdict-unsure}"
    textColor: "{colors.on-verdict}"
    typography: "{typography.badge}"
    rounded: "{rounded.full}"
    padding: 8px
  badge-neutral:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.on-surface}"
    typography: "{typography.badge}"
    rounded: "{rounded.full}"
    padding: 8px
  badge-crowd:
    backgroundColor: "{colors.ice}"
    textColor: "{colors.on-verdict}"
    typography: "{typography.badge}"
    padding: 8px
  verdict-text-ai-day:
    backgroundColor: "{colors.surface-raised-day}"
    textColor: "{colors.ai-ink-day}"
  verdict-text-real-day:
    backgroundColor: "{colors.surface-raised-day}"
    textColor: "{colors.real-ink-day}"
  verdict-text-unsure-day:
    backgroundColor: "{colors.surface-raised-day}"
    textColor: "{colors.unsure-ink-day}"
  chip-none:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.label-md}"
    rounded: "{rounded.full}"
  agent-chip:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.accent}"
    typography: "{typography.data}"
    rounded: "{rounded.full}"
  agent-chip-mark:
    backgroundColor: "{colors.primary}"
    rounded: "{rounded.pixel}"
    size: 12px
  hash-tile:
    backgroundColor: "{colors.surface-sunken}"
    rounded: "{rounded.pixel}"
    size: 40px
  hash-tile-day:
    backgroundColor: "{colors.surface-sunken-day}"
  hash-tile-cell:
    backgroundColor: "{colors.primary}"
    rounded: "{rounded.pixel}"
  consensus-meter:
    backgroundColor: "{colors.surface-sunken}"
    rounded: "{rounded.full}"
    height: 8px
  stat:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.on-surface}"
    typography: "{typography.numeral}"
    padding: "{spacing.base}"
  table-header:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.label-md}"
    padding: "{spacing.md}"
  table-cell:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-strong}"
    padding: "{spacing.md}"
  table-address:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.data}"
  note:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: "{spacing.sm}"
  logo-mark:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.secondary}"
    rounded: "{rounded.pixel}"
    size: 32px
  section-gap:
    padding: "{spacing.xl}"
  hero-gap:
    padding: "{spacing.2xl}"
  badge-gap:
    padding: "{spacing.xs}"
---

# Nadeye

## Overview

Nadeye ("nad-eye": naked eye + nads) is a browser extension, a verifier agent and a leaderboard. It detects AI-generated images on the user's own device and records each verdict on Monad as a 64-bit perceptual hash and a confidence score. The tagline is **"See what the naked eye can't."**

The look is Monad's own brand kit applied to forensic work:
- The night theme (deep `neutral` ground, `primary` Monad purple) is the default; the light theme uses the `-day` tokens.
- Monad's secondary accents (pink, cyan, orange) become the three verdict colors.
- Monad's habit of setting buttons and labels in mono runs through every control.
- Nadeye's one shape of its own is the 8×8 pixel grid of a perceptual hash.

The feeling is calm and exact, like a lab instrument with a bit of Monad's community color. Nadeye reports evidence; it never accuses.

**Voice**
- Sentence case. Uppercase only through the `label-md` style.
- Lead with the action or the result: "Create passkey", "Extension now scans as 0x31F5…61eA".
- Use the words "AI-generated", "likely real" and "unsure". Never "fake", "fraud" or "caught".
- Give numbers exactly: "AI 94%", "3 of 4 scanners flagged it as AI".
- Errors say what went wrong and how to fix it, without apology: "Not enough MON for gas. Send a little MON to your identity address, then try again."
- State privacy plainly: "The image never leaves your device. Only a 64-bit hash and a score reach Monad."
- No emoji in the product. The badge community count is written in words ("3/4 AI").

## Colors

The palette comes from Monad's brand kit (monad.xyz/brand-and-media-kit).

- **Monad Purple (`primary`, #6E54FF):** a fill, never body text.
  - Use it for the primary button, the logo mark, hash-tile pixels and selected tabs.
  - Text on it is `on-primary` (4.8:1).
  - One primary fill per view.
- **Lavender (`secondary`, #DDD7FE):** pixels of the avatar mark, the night focus ring, and day-theme hairlines (`line-day`).
- **Night (`neutral`, #0E091C):** the night page ground, and the text color (`on-verdict`) on every bright fill.
- **Surfaces:**
  - Night: `surface` for the page, `surface-raised` for panels, tables and the popup, `surface-sunken` for table headers, wells and tile grounds.
  - Day: `surface-day`, `surface-raised-day` and `surface-sunken-day`.
- **Text:**
  - Night: `on-surface`, `on-surface-muted`, and `accent` for links.
  - Day: `on-surface-day`, `on-surface-muted-day` and `accent-day`.
  - Every text color holds 5:1 or better on all three surfaces of its theme.
- **Verdicts:** Monad's secondary palette, used only for verdicts.
  - `verdict-ai` (Monad pink) means AI-generated.
  - `verdict-real` (Monad cyan) means likely real.
  - `verdict-unsure` (Monad orange) means unsure, split or degraded.
  - `ice` marks onchain community counts.
  - Text on these fills is always `on-verdict` (night, 9.5:1 or better).
  - In the day theme, verdicts written as text use `ai-ink-day`, `real-ink-day` and `unsure-ink-day`.
- **Lines:**
  - `line` and `line-day` are decorative hairlines, below 3:1.
  - Control borders and the hash-tile frame use `line-strong` / `line-strong-day`, which hold 3:1 or better.
- **Focus:** `focus-ring` (lavender) on night grounds, `focus-ring-day` (Monad purple) on day grounds. Draw it as a 2px solid outline with a 2px offset.

The verdict fills are close in lightness (pink vs orange ≈ 1.1:1, pink vs cyan ≈ 1.4:1), so in grayscale they look alike. Every verdict therefore carries its word *and* a distinct shape: ◆ AI, ● real, ▲ unsure (◐ split), ○ none / not in the registry. Color never carries the meaning alone. Acceptance test: in grayscale, every verdict stays distinguishable.

## Typography

Three families, used the way Monad's kit uses them:

- **Hanken Grotesk** for headlines and big numbers. It stands in for Monad's Britti Sans, which is not freely hosted.
  - If the Britti Sans files are licensed, put "Britti Sans" first in the display stack.
  - Fallbacks: "Helvetica Neue", Arial, sans-serif.
- **Inter** for running text (`body-md`, `body-sm`, `body-strong`). Keep lines near 65 characters.
  - Fallbacks: system-ui, -apple-system, "Segoe UI", sans-serif.
- **Roboto Mono** for every control and every machine value: buttons, tabs, `label-md` captions and table headers (uppercase, 0.12em tracking), `data` for hashes, addresses and transaction ids, and `badge` for verdict badges.
  - Fallbacks: ui-monospace, SFMono-Regular, Menlo, monospace.

How each style is used:
- `display-xl`: the single hero line.
- `display-lg`: section openers.
- `headline-md`: panel and table titles.
- `numeral`: stat tiles and podium points, always with tabular numerals.

Load the three families from Google Fonts (Hanken Grotesk 500/600/700, Inter 400/500/600, Roboto Mono 400/500).

## Layout

- One centered column, `max-width` 1080px.
- Side gutter never below `gutter` (16px).
- The spacing scale steps on 4px: `xs` 4, `sm` 8, `md` 12, `base` 16, `lg` 24, `xl` 32, `2xl` 48.
- Panels pad `lg` (`base` on phones). Page sections sit `xl` apart. The hero has `2xl` above it.
- Stat strips are grids of cells separated by 1px `line` gaps.
- Tables scroll sideways inside their own container on phones; never squeeze their columns.
- Order on the leaderboard: network stats first, then the top-three podium, then the ranked table.

## Elevation & Depth

- Nadeye is flat. Hierarchy comes from the three surface tones (`surface` → `surface-raised` → `surface-sunken`) and 1px `line` borders, not shadows.
- The one exception is the in-page verdict badge. It sits on arbitrary photos and takes a small shadow (0 1px 3px, night at 45%) so it stays legible on any image.
- No gradients, and never blend Monad purple into blue.

## Shapes

Corners:
- `pixel` (2px) for anything built from the pixel grid.
- `sm` (8px) for buttons, inputs and stat strips.
- `md` (12px) for panels.
- `full` for badges, chips and the consensus meter.

**The pixel grid** is Nadeye's motif. A perceptual hash is 64 bits, drawn as an 8×8 grid of `pixel`-rounded cells:
- The logo is that grid spelling an eye, bits `003c66dbdb663c00`. The mark is `primary` on transparent; the avatar is `secondary` pixels on a `neutral` square.
- Every image is shown with its real hash as a hash tile, toned to its verdict color.
- Every scanner's identicon is the last 64 bits of its address.
- Use the grid only where it stands for something real (the mark, an image or an address), never as background texture.
- Render the grid with crisp edges, at sizes in multiples of 8px.

## Components

- **Buttons:**
  - `button-primary`: the one main action per view.
  - `button-secondary`: `surface-raised` with a `line-strong` border; the border turns `accent` on hover.
  - Labels are verbs in mono ("Create passkey", "Use in extension", "Send").
  - While a transaction runs, the button stays focusable with `aria-disabled="true"` (never `disabled`, which drops focus). Its label becomes the step in progress ("Registering your agent…"), mirrored to a polite live region.
- **Verdict badge (in-page):** pinned to the top-left of each analysed image, with two segments:
  - The verdict, toned by color (`badge-ai`, `badge-unsure`, `badge-neutral`) and always written with its shape and word: "◆ AI 94%", "▲ Unsure 58%", "● Real · AI 12%", "○ Not analysed".
  - The community count in words, only when the registry has reports (`badge-crowd`): "3/4 AI" means 3 of 4 scanners flagged AI.
  - Degraded inputs get a dashed night inner outline and the words "· low quality".
  - The badge is a keyboard button (`role="button"`, `tabindex="0"`; Enter or Space toggles blur). Its `aria-label` is the full sentence ("Nadeye verdict: likely AI-generated, AI confidence 94 percent. Community: 3 of 4 scanners flagged it as AI. Press to toggle blur.").
  - It brings its own near-opaque night ground and a lavender edge, so contrast never depends on the photo. Don't animate it over images.
- **Verdict chip:** the registry verdict inside the app, each with its shape: "◆ Likely AI", "● Likely real", "◐ Split", "○ Not in the registry" (`chip-none`). Chips are static; don't style them as buttons.
  - More than half AI votes is AI; exactly half is Split. An AI vote is a scanner's score of 80% or more; a real vote is below 50%. Scores in between are never recorded.
- **Hash tile:** a 40px default, 96px in lookup results, 28–34px on the podium. Pixel cells (`hash-tile-cell`) in the verdict fill or `primary` on a `surface-sunken` ground, framed with `line-strong`. As graphics the cells need 3:1, and `primary` gives 3.4:1 on night and 4.1:1 on day.
- **Consensus meter:** a measurement, so it is a meter, not a progress bar.
  - Markup: `role="meter"`, `aria-valuemin="0"`, `aria-valuemax="100"`, `aria-valuenow` = AI share, `aria-valuetext` ("75% say AI (3 of 4 votes)"), and a visible "Community verdict" label.
  - Visuals: a `full`-rounded 8px bar with `verdict-ai` and `verdict-real` segments (`aria-hidden`) separated by a 2px gap, plus a legend underneath ("◆ 3 AI · ● 1 real").
  - With zero votes, show "No votes yet" instead of the meter.
- **Agent chip:** a scanner's ERC-8004 identity, "#412" in `accent`, with a 12px `primary` pixel. Show it only when an agent is linked.
- **Stat strip:** 2–4 cells; `numeral` values, `label-md` captions in `on-surface-muted`.
- **Scanner table:**
  - Native `<table>` with a caption that states the sort, `scope="col"` headers and a `scope="row"` scanner cell.
  - Sortable columns hold a header button. The active column's `<th>` has `aria-sort`; every other column has none.
  - After sort, search (debounced) or page changes, announce "Sorted by …, descending. Showing 1 to 25 of 40 scanners." in a polite live region.
  - Pagination is `<nav aria-label="Leaderboard pages">`: "Previous page" / "Next page", "Go to page N", `aria-current="page"`, targets 36px or larger.
  - `table-header` rows in `label-md`.
  - Rank numerals in the display face; the top three in `accent`.
  - Handle in `body-strong`, then the short address in `table-address`.
  - Numeric columns right-aligned with tabular numerals.
- **Status note (inline):** one sentence with a mono tag (··· busy, OK, ERR, EXAMPLE), in a persistent live region: `role="status"` for progress and success, `role="alert"` for errors from the person's own action. Sample data is always labelled EXAMPLE.
- **Banner:** a persistent outcome message ("Your ERC-8004 agent is live and linked. View transaction ↗") with a Dismiss button. No auto-dismissing toasts.
- **Dialog:** confirmations use a native `<dialog>` with action-named buttons ("Show key", "Replace wallet"). Focus starts on Cancel, Esc cancels, and focus returns to the trigger. The extension's passkey hand-off on third-party sites keeps the browser's native confirm, because a web page cannot imitate it or click it.
- **Settings:** every control has a label. Settings that apply immediately are switches (`role="switch"`). The threshold slider speaks its value in words.

## Do's and Don'ts

- Do keep the night theme as the default and the day theme as an equal, fully tokenized alternative.
- Do put `on-verdict` (night) text on every verdict, `ice` and `secondary` fill. Never white.
- Do write the verdict word *and* its shape (◆ ● ▲ ◐ ○) in every badge and chip.
- Do give every control a programmatic label, and keep live regions in the page (change their text; don't add and remove the element).
- Do set every button, tab, label, hash and address in Roboto Mono.
- Do show real values only. Label any sample data "EXAMPLE".
- Don't use the verdict colors for anything but verdicts and community counts.
- Don't use more than one `primary` fill per view, or `primary` as text on a night surface (use `accent`).
- Don't add shadows or gradients, except the in-page badge shadow.
- Don't use auto-dismissing toasts or `window.confirm` in the app. Use a Banner or a Dialog.
- Don't use the pixel grid as decoration.
- Don't reproduce or redraw Monad's logo. For "Built on Monad", use the official files from monad.xyz/brand-and-media-kit.
