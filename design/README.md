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
- `stage-parity`: map parity with map_pdo and map_project. The same screens,
  then:
  - County Health Rankings with fire stations stacked as triangles;
  - a 25-mile radius filter;
  - a pooled two-county selection;
  - natural breaks on a diverging palette;
  - the measure tool;
  - a 320px phone.

## Map conventions from the parity pass

- **Stacking.** Points always draw over areas, and roads sit between them.
  Within each band the stack order decides.
- **Filters.** A filter dims what it leaves out to about a sixth of its
  opacity, so the context stays readable; "hide" removes it.
- **Overlays.** Tool and filter outlines use the accent color, dashed.
  Selections use the theme's selection color, and their neighbors are dashed.
- **Category colors.** Okabe and Ito's eight, safe for common color-vision
  deficiencies; grey means "Other".
- **Diverging palettes.** Keep their neutral middle in the middle at every
  class count.
- **Printing.** The printed report uses plain ink on white whatever the
  theme, so it photocopies.

## Still to come

- A logo kit in the family's format: `logo/` with `details.json`,
  `usage.txt`, `logo-theme.css`, and auto and dark SVGs. `public/rumb.svg` (a
  compass ring crossed by a rhumb line) is a placeholder.
- A procedural boot screen: a contour field drawn by WebGL2, with an honest
  load log.
- GPU layers (deck.gl) for large point sets.
- `stage-stats-a`: spatial statistics, part A. The parity screens, then:
  - a CDC PLACES tract estimate with its 95% interval in the inspector;
  - Gi* hot and cold spots of the uninsured share on 6 nearest neighbors;
  - bivariate clusters (poverty against neighbors' diabetes) and
    EB-adjusted rate clusters;
  - child poverty around Jackson with unreliable ACS estimates hatched;
  - the "Smooth a rate" dialog and an empirical Bayes rate;
  - the spatial scan's most likely cluster of overdose deaths, on a desktop
    and a phone.
- `stage-stats-b`: spatial statistics, part B. The part A screens, then:
  - an OLS regression of PLACES diabetes on four ACS covariates, with its
    residual map, coefficients and diagnostics;
  - the spatial lag model with its impacts;
  - a negative binomial model of overdose deaths by county;
  - E2SFCA access to pharmacies by tract;
  - a point pattern of nursing homes weighted by beds, with its centers
    and ellipse;
  - a kernel density surface of nursing-home beds.
