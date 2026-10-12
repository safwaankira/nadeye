Nadeye ("nad-eye": naked eye + nads) detects AI-generated images on the user's own device and records each verdict on Monad as a perceptual hash. This system dresses it in Monad's own brand kit: Monad purple, lavender and night, with Monad's cyan, pink and orange accents as the three verdict colors, Monad's mono-for-buttons type habit, and one shape of Nadeye's own, the 8×8 pixel grid.

## Voice

Plain, exact and calm. Nadeye reports evidence; it never accuses.

- Lead with what the person can do or what happened: "Create passkey", "Extension now scans as 0x31F5…61eA".
- Say "AI-generated", "likely real", "unsure". Never "fake", "fraud" or "caught".
- Give numbers as they are: "AI 94%", "3 of 4 scanners flagged it as AI". No rounding up to certainty.
- Privacy is stated, not implied: "The image never leaves your device. Only a 64-bit hash and a score reach Monad."
- Errors say what went wrong and the fix, without apology: "Not enough MON for gas. Send a little MON to your identity address, then try again."
- Sentence case everywhere. Uppercase only through the `label` style.
- Emoji: only 👥 in a badge's community count, which is product copy. No decorative emoji.
- The tagline is "See what the naked eye can't." Say the name "nad-eye" once in any video or talk.

## Color

Two themes: `night` (first, the default, matching monad.xyz) and `day`.

- Page ground is `surface`; panels and tables are `surface-raised`; table headers, stat cells and wells are `surface-sunken`.
- Text is `ink`; secondary text is `muted`; links and interactive text are `accent`. All three hold 5:1 or better on all three surfaces in both themes.
- `brand` (Monad purple, #6E54FF) is a fill: the primary button, the logo mark, selected tabs. Text on it is `on-brand`. Use one `brand` fill per view.
- Verdicts use Monad's secondary palette and nothing else:
  - AI-generated: `verdict-ai` (Monad pink)
  - likely real: `verdict-real` (Monad cyan)
  - unsure, split or degraded: `verdict-unsure` (Monad orange)
  - onchain community counts: `ice`
- Text on any of those fills, on `lavender` and on `ice` is `night`, never white. As text on a surface, use `ai-ink`, `real-ink` or `unsure-ink` instead of the fills.
- Pink, cyan and orange are told apart by hue. Every verdict therefore also carries its word ("AI", "unsure", "Likely real"), so color never carries the meaning alone.
- Hairlines are `line`, which is decorative (below 3:1). Input, button and tile borders are `line-strong`, which holds 3:1 everywhere.
- No gradients. Monad purple is never blended into blue.

## Type

- Headlines in `display` (Hanken Grotesk), standing in for Monad's Britti Sans, which is not freely hosted. If the Britti Sans files are licensed, put them in `fonts/`, add them to `type.fonts`, and lead the `display` stack with "Britti Sans".
- Running text in `body` (Inter), as Monad uses it. Keep measures to 65 characters.
- Buttons, tabs, labels, hashes, addresses and badges in `mono` (Roboto Mono), as Monad's kit uses it for labels, buttons, links and code.
- Styles: `display-xl` for the one hero line; `display-l` for section openers; `heading` for panel titles; `numeral` for big numbers, always with tabular numerals; `body`, `body-s` and `body-strong` for text; `label` for eyebrows and table headers (uppercase, tracked); `button`; `data` for hashes and addresses.

## Shape and space

- Spacing runs on 4px: `space-1` 4 through `space-12` 48. Panels pad `space-6` (`space-4` on phones); page sections sit `space-8` apart; the page gutter is never under `space-4`.
- Radii: `radius-pixel` (2px) for anything built from the pixel grid; `radius-sm` (8px) for buttons, inputs and stat strips; `radius-md` (12px) for panels; `radius-pill` for badges, chips and meters.
- Separate with borders, not shadows. The only shadow is `shadow-badge`, which lifts an in-page badge off a photo.

## The pixel grid

Nadeye's own motif is the 8×8 grid of a 64-bit perceptual hash.

- The logo is that grid spelling an eye: bits `003c66dbdb663c00`.
- Every image in the product shows its real hash as a HashTile.
- Every scanner's identicon is the last 64 bits of its address.
- Draw the grid with `radius-pixel` cells.
- Use the grid only where it stands for something real: the mark, an image, an address. Never as background texture.

## Motion

Almost none. State changes swap instantly. Respect `prefers-reduced-motion`; nothing in the system depends on animation.

## Focus and states

- Keyboard focus is a 2px solid `focus-ring` outline with a 2px offset: `lavender` on night grounds (14:1), `brand` on day grounds (4.5:1).
- Hover on secondary controls turns the border `accent`; the primary brightens slightly.
- Disabled controls drop to 50% opacity and change their label to the step in progress.

## Logos and Monad's marks

- The Nadeye mark (`assets/Logos/nadeye-mark.svg`) is `brand` on a transparent ground.
- The avatar (`nadeye-avatar.svg`) is `lavender` pixels on `night`, for social avatars and the extension icon.
- Keep at least one pixel-cell of clear space around either.
- For "Built on Monad", use Monad's official logo files from monad.xyz/brand-and-media-kit. This system does not include or redraw Monad's marks.

## Iconography

There is no icon font. Meaning is carried by words, the verdict colors and the pixel grid. Glyphs inside components (the chip's square, the note's mono tags) come from CSS, not icon files.

## Using this system

- Load `tokens.css`, then `components/bundle.css`. bundle.css also pulls the three Google Fonts.
- Components are CSS classes prefixed `ny-` (see each component's guide).
- `components/bundle.js` adds `window.Nadeye` with `hashTile(el, hex, tone)`, `verdictOf(score, degraded, threshold)`, `bits(hex)` and the mark's hash `EYE`. It needs no framework.
- Set `data-theme="night"` or `data-theme="day"` on `<html>`. With neither set, the night values apply.
- Text colors are only guaranteed legible on the grounds their usage notes name. Stay inside those pairs.
