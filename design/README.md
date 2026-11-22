# rumb design

rumb should feel like a survival tool: a field terminal you could trust in bad
light, with a cyberdeck's density. Every number is legible, every tool is a key
away, and decoration never competes with the data.

## Principles

- **Data first.** Map colors stay the same in every theme, so a saved image
  means the same thing everywhere. Only the neutrals ("not significant",
  "unavailable") follow the theme, so clusters stand out on dark maps.
- **Themes do a job.**
  - Field Terminal is the default.
  - Night (dim red) keeps night vision.
  - Daylight is high contrast for sun.
  - Tactical HUD, Rugged Field Kit and Starship (from Plank) are the same
    instrument in other housings.
- **Readouts are mono.** Numbers use JetBrains Mono with tabular figures;
  labels are small caps with letter spacing.
- **Keyboard first.**
  - Ctrl/⌘ K finds any command, layer, measure, theme or place.
  - Single keys reach each tool, and the rail and section titles show them.
  - The status bar always says what the app is doing.
- **Near-zero motion.** Fades of about 120 ms and a pulsing status dot. Motion
  stops with the system's reduce-motion setting. No animation library.
- **Ornament is optional.**
  - Corner ticks, HUD brackets and grid, the Field Kit hazard stripe, Starship
    bands and elbows.
  - All of it turns off in Appearance › Theme decoration.
  - Scanlines are off unless chosen.

## Tokens

All colors, fonts and sizes are CSS variables in
[`src/styles/tokens.css`](../src/styles/tokens.css), one block per theme, and
ornament is in [`src/styles/themes.css`](../src/styles/themes.css).
[DEVELOPER-GUIDE.md §7](../DEVELOPER-GUIDE.md#7-the-design-system-and-themes)
explains how to add a theme.

| Theme | Background | Accents | Type |
| --- | --- | --- | --- |
| Field Terminal | `#050505` | amber `#ffb000`, phosphor `#33ff99` | JetBrains Mono |
| Terminal · Night | `#030000` | dim red `#c8342a`; the map is filtered red | JetBrains Mono |
| Terminal · Daylight | paper `#f7f3e8` | dark amber `#a34f00`, green `#00703c` | JetBrains Mono |
| Tactical HUD | slate `#070c16` | cyan `#22e5ff`, magenta `#ff2bd6` | Chakra Petch |
| Rugged Field Kit | charcoal `#171a14` | olive `#4b5320`, safety orange `#ff6a13` | Saira Stencil One headings |
| Starship | `#000000` | orange `#ff9900`, lilac `#cc99cc`, blue `#9999ff` | Antonio caps |

## Screens

`screens/stage-<name>/N-what.jpg` are review screenshots for each stage of
work, made with `node scripts/screens.mjs <name>` after a build. They are not
published.

- `stage-foundation`: the first pass after the rename. The cluster map is shown
  in each theme, then Compare, SQL, the palette and a phone.

## Still to come

- A logo kit in the family's format: `logo/` with `details.json`,
  `usage.txt`, `logo-theme.css`, and auto and dark SVGs. `public/rumb.svg` (a
  compass ring crossed by a rhumb line) is a placeholder.
- A procedural boot screen: a contour field drawn by WebGL2, with an honest
  load log.
- GPU layers (deck.gl) for large point sets.
