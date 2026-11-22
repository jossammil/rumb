# rumb developer guide

This guide explains:

- how rumb works inside, and which program runs what
- the libraries it uses and why
- how to change, rebuild, test and publish each part
- how to debug it

**To study it,** read sections 1 to 4 in order. Section 4 follows real actions
(Find clusters, mapping a joined table, saving a project) through the code.
After that, the other sections work as a reference. Line counts are approximate.

Contents

1. [The big picture](#1-the-big-picture)
2. [Which program runs what](#2-which-program-runs-what)
3. [Repository map](#3-repository-map)
4. [Follow an action through the code](#4-follow-an-action-through-the-code)
5. [The browser code, module by module](#5-the-browser-code-module-by-module)
6. [Data: regions and the catalog](#6-data-regions-and-the-catalog)
7. [The design system and themes](#7-the-design-system-and-themes)
8. [Commands, keys and the palette](#8-commands-keys-and-the-palette)
9. [The service worker and offline use](#9-the-service-worker-and-offline-use)
10. [Storage and file formats](#10-storage-and-file-formats)
11. [Libraries and packages](#11-libraries-and-packages)
12. [Tools and the build cycle](#12-tools-and-the-build-cycle)
13. [How to update things](#13-how-to-update-things)
14. [Tests](#14-tests)
15. [Publishing on GitHub Pages](#15-publishing-on-github-pages)
16. [Debugging](#16-debugging)
17. [Glossary](#17-glossary)

---

## 1. The big picture

rumb is a **static web app**: a folder of HTML, JavaScript, CSS, WebAssembly
and data files. There is no server code. Everything happens in the reader's
browser:

- drawing the map (MapLibre, WebGL)
- spatial SQL (DuckDB compiled to WebAssembly, in a worker)
- cluster statistics (GeoDaLib's wasm and plain JavaScript, in a worker)
- keeping projects (a `.rumb` file the reader saves) and offline copies (a
  service worker's caches)

```
 ┌─────────────────────────────── one browser tab ────────────────────────────────┐
 │                                                                                │
 │  MAIN THREAD (the page)                  WORKER: statistics                    │
 │  dist/app.js  ← src/main.js and          dist/stats-worker.js ← src/stats/     │
 │  ┌──────────────────────────┐            Moran's I, LISA, permutations,       │
 │  │ map      (MapLibre)      │ ─values──► GeoDaLib wasm, jsts contiguity        │
 │  │ panels   (style, Compare,│ ◄─result──                                       │
 │  │           inspector, SQL)│                                                  │
 │  │ palette, status bar      │            WORKER: DuckDB                        │
 │  │ store (the state)        │ ─SQL─────► vendor/duckdb-<v>/ duckdb-eh.wasm     │
 │  └────────────┬─────────────┘ ◄─rows───  + parquet, json, spatial extensions   │
 │               │ fetch                                                          │
 │               ▼                                                                │
 │  SERVICE WORKER  dist/sw.js: answers from its caches when it can (offline)     │
 └───────────────┬────────────────────────────────────────────────────────────────┘
                 │ static files only
                 ▼
     GitHub Pages: index.html, app.js, chunks/, vendor/, data/<region>/ …
```

The page reads the **catalog** for its region (`data/ms/catalog.json`), shows
the reference layer (Mississippi tracts) from a GeoJSON file, and only loads
DuckDB (about 59 MB) or the statistics code when the reader first needs them.

## 2. Which program runs what

| Work | Runs in | Code |
| --- | --- | --- |
| Map drawing, picking, fitting | Main thread, WebGL | `src/map/map.js` (MapLibre) |
| Class breaks, colors, legends | Main thread | `src/map/classify.js`, `src/map/legend.js`, `src/panels/style.js` |
| Moran's I, LISA, permutations, FDR | Statistics worker | `src/stats/stats.js` (+ `@geoda/lisa` wasm) |
| Queen/rook contiguity of imported polygons | Statistics worker | `src/stats/weights.js` (jsts) |
| Compare scores and ranks | Main thread | `src/stats/compare-score.js` |
| SQL, imports, joins, CSV export | DuckDB worker | `src/data/database.js` (DuckDB-Wasm) |
| Project files | Main thread | `src/data/project.js` (zip.js) |
| Offline caching | Service worker | `public/sw.js`, `src/data/offline.js` |
| Building | Node.js | `scripts/build.mjs` (esbuild) |
| Reference data | R and Python, by hand | `scripts/prepare-*.R`, `scripts/prepare-places.py` |

## 3. Repository map

```
rumb (this repository, jossammil/rumb; it was jossammil/bgis)
├── public/                  copied to dist/ as is
│   ├── index.html           the page: all static markup and element ids
│   ├── sw.js                service worker template (the build fills it in)
│   ├── manifest.webmanifest app name and icons
│   ├── rumb.svg, icons/     logo and PNG app icons (scripts/make-icons.mjs)
│   └── data/
│       ├── index.json       which regions exist
│       └── ms/              Mississippi: catalog.json and its files
├── src/
│   ├── main.js              wiring: creates everything, binds commands and events
│   ├── core/                state, commands, keys, settings, the workspace (pure, mostly)
│   ├── catalog/             reading the catalog; number formatting
│   ├── map/                 MapLibre, the style, classes, legend, PNG export
│   ├── data/                DuckDB, project files, CSV and SQL quoting, offline
│   ├── stats/               statistics, contiguity, Compare scoring, the worker
│   ├── panels/              one module per part of the screen
│   ├── ui/                  h(), toasts, icons, palette, themes, help, status bar
│   └── styles/              tokens, base, shell, map, panels, themes (CSS)
├── scripts/                 build, serve, vendor DuckDB, data preparation, benchmarks
├── tests/                   unit tests (node --test) and e2e/e2e.mjs (Playwright)
├── design/                  themes and review screenshots (not published)
└── .github/workflows/       pages.yml (publish), test.yml (unit + browser tests)
```

**Generated files you never edit by hand:** everything in `dist/`;
`.cache/vendor/` (DuckDB, from `scripts/vendor-db.mjs`); `public/icons/*.png`
(from `scripts/make-icons.mjs`); `design/screens/` (from `scripts/screens.mjs`);
the data in `public/data/ms/` except `catalog.json` (from the prepare scripts,
see [REPRODUCIBILITY.md](REPRODUCIBILITY.md)).

## 4. Follow an action through the code

### Find clusters

1. The button `#analyze` (or **R**, or the palette's "Find clusters") calls
   `app.analysis.run()` in `src/panels/analysis.js`.
2. `run()` gets the neighbor graph: for the reference layer, the precomputed
   `neighbors.json` (`ws.neighbors()` in `src/core/workspace.js`); for an
   imported polygon layer, it asks the statistics worker for queen or rook
   contiguity and caches it in `ws.graphs`.
3. It builds `{ values, neighbors, denominators, studyIds }`. The denominator
   field comes from the catalog (`fields.<measure>.universe`), so a zero
   denominator excludes an area instead of reading as 0%.
4. `callStats()` (`src/stats/client.js`) posts the request to the one
   statistics worker, which runs `analyze()` in `src/stats/stats.js`: GeoDaLib
   supplies observed local statistics; permutation inference, global I and FDR
   are plain JavaScript with a seeded Mulberry32 generator.
5. The result goes into the store (`result`, `mode: "cluster"`), and
   `app.draw()` (`src/panels/style.js`) recolors the map and legend, then
   `src/panels/inspector.js` draws the summary and scatterplot.

### Import a CSV, check the join and map it

1. Dropping a file (`src/ui/drop.js`) or **I** calls
   `app.files.importFiles()` (`src/panels/files.js`).
2. `ws.db()` opens DuckDB the first time (`openDatabase()` in
   `src/data/database.js`), registering the reference GeoParquet as the view
   `tracts`; then `importFile()` registers the CSV as a view. Key-like columns
   (GEOID, FIPS, ZIP) are read as text so leading zeros stay.
3. The Data view (`src/panels/workbench.js`) shows the table. **Check join**
   calls `joinReport()` (matched, unmatched, duplicate keys) and `joinSQL()`.
4. **Map joined table** calls `mapSQL()` in the workbench, which streams the
   query through `mapQuery()`; rows keyed by the reference ID get the
   reference display geometry. `app.addLayer()` stores the layer and
   `app.showLayer()` switches to it.

### Save and reopen a project

1. **Save** (Ctrl/⌘ S) runs `saveProject()` in `src/panels/files.js`:
   `packProject()` writes `project.json` (the state and the camera), the
   imported files under `imports/` and the reference files under `base/`.
2. **Open** runs `restoreProject()`: `unpackProject()` checks the archive;
   `ws.stage()` opens the imported tables in a **new** DuckDB first, so a bad
   archive leaves the workspace untouched; only then does `commit()` swap the
   data and `store.replace(normalizeState(...))` the state. `normalizeState()`
   (`src/core/state.js`) upgrades Field Atlas states.

### Change the theme

**T**, the palette or the Appearance dialog call `update()` in
`src/ui/themes.js`, which sets `data-theme` on `<html>` and saves the choice.
Its listener in `main.js` calls `atlas.retheme()` (backdrop paint from CSS
tokens, `src/map/basemap-style.js`) and redraws the data layer, because
"not significant" and "unavailable" colors are theme tokens too.

## 5. The browser code, module by module

"Pure" modules import nothing from the DOM side, so `node --test` can load them.

| Module | Pure? | What it does | Main exports |
| --- | --- | --- | --- |
| `main.js` | no | Creates the store, workspace, map and panels; binds commands, keys and events; exposes `window.rumb` | — |
| `core/store.js` | yes | One state object; `set(patch)` tells listeners which keys changed | `createStore` |
| `core/state.js` | yes | Defaults, per-layer view keys, upgrading saved states | `defaults`, `normalizeState`, `LAYER_VIEW_KEYS` |
| `core/workspace.js` | mostly | Catalog, reference files (cached as Blobs), imports, DuckDB, neighbor graphs, staging a restore | `createWorkspace` |
| `core/features.js` | yes | Feature IDs, polygon test, numeric fields, groups | `featureId`, `numericFields`, `groups` |
| `core/commands.js` | yes | The list of commands | `COMMANDS`, `bindCommands` |
| `core/keys.js` | yes | Shortcut table, typing test, key → command | `SHORTCUTS`, `KEY_OF`, `shortcutFor` |
| `core/settings.js` | yes | Themes list, appearance settings, coordinate formats | `THEMES`, `normalizeSettings`, `formatPosition` |
| `core/storage.js` | yes | `localStorage` under `rumb.` | `load`, `save` |
| `core/about.js` | yes | The about text | `ABOUT` |
| `catalog/catalog.js` | yes | Loads and checks the catalog; field labels; starter SQL | `loadCatalog`, `fieldInfo`, `fieldLabel` |
| `catalog/format.js` | yes | Number formatting | `number`, `plural` |
| `map/map.js` | no | MapLibre map, selection, fit, retheme | `initMap` |
| `map/basemap-style.js` | no | Style JSON from tokens; neutral data colors | `buildStyle`, `mapColors`, `neutralColors` |
| `map/classify.js` | yes | Palettes, cluster and quadrant colors, breaks | `palettes`, `classify`, `classOf`, `ramp` |
| `map/legend.js` | no | One legend renderer (map and Compare) | `renderLegend`, `classItems` |
| `map/export-png.js` | no | PNG with title, legend and credits | `exportMapImage` |
| `data/database.js` | no | DuckDB-Wasm: views, SELECT checks, map and CSV queries, joins | `openDatabase` |
| `data/project.js` | no | `.rumb` ZIP reading and writing | `packProject`, `unpackProject` |
| `data/csv.js`, `data/sql.js` | yes | CSV cells; SQL quoting | `csvText`, `ident`, `sqlString` |
| `data/offline.js` | no | Registers the service worker; Download for offline | `createOffline` |
| `stats/stats.js` | yes | Moran's I, LISA, permutations, FDR | `analyze`, `adjustFdr` |
| `stats/weights.js` | yes | Queen/rook contiguity with jsts | `polygonNeighbors` |
| `stats/compare-score.js` | yes | Compare percentiles, scores, ranks, CSV | `compareAreas`, `comparisonCSV` |
| `stats/worker.js`, `stats/client.js` | worker | The worker and its persistent client | `callStats` |
| `panels/*.js` | no | Layers, style, analysis, inspector, find, Compare, workbench, files | `create…` |
| `ui/dom.js` | no | `$`, `h`, `s`, `fill`, `icon`, `toast`, `on` | — |
| `ui/palette.js` | partly | Ranking (pure) and the palette dialog | `fuzzyScore`, `rankItems`, `createPalette` |
| `ui/themes.js`, `ui/help.js`, `ui/statusbar.js`, `ui/drop.js`, `ui/splitter.js` | no | Appearance, help sheet, readouts, drag-and-drop, the Compare divider | — |

**Conventions.**
- Build DOM with `h(tag, props, ...children)`; never assemble HTML strings.
- `fill(el, ...)` replaces children and skips `false`/`null`, for conditional
  parts.
- Handlers attached with `on()` turn a thrown `Error` into a toast, so code can
  simply `throw new Error("message for the reader")`.
- File and query work goes through `app.perform(button, fn)`, which runs one
  at a time and reports errors.
- Code style: double quotes, semicolons, a comment at the top of each module
  saying what it is for.

## 6. Data: regions and the catalog

`public/data/index.json` lists regions; the page opens `default`. Each region
folder has a `catalog.json`:

- `region`: id, name, bounds, credit line, and the backdrop (files, the extent
  of the regional backdrop, and labels for neighboring states).
- `layers[0]`: the reference layer:
  - `files`: display GeoJSON, GeoParquet, neighbors, sources;
  - `idField`, `labelField`, `groupField` (county);
  - `measures` (offered in the map style);
  - `fields`: label, unit, margin of error, count, universe, source, vintage;
  - `compare`: the reference file, lead fields, notes and links.

Nothing about Mississippi is in `src/`. To **add a state**, make
`public/data/<st>/` with the same files and a catalog, and add it to
`index.json`. `tests/core.test.js` checks the catalog against its files; copy
that test for the new region. National data (all states) is planned as one
folder per state, loaded on demand.

## 7. The design system and themes

- `src/styles/tokens.css` defines every color, font and size as a CSS variable:
  - surfaces `--bg0…3`, text `--text1…3`, lines;
  - `--accent`, `--accent-2`, `--sel`, `--sem-*`;
  - map colors `--map-*`, plot colors `--plot-*`, `--na`, `--cluster-ns`;
  - fonts `--ui-font`, `--display-font`, `--label-font`, `--mono-font`.
- A theme is one block, `:root[data-theme="id"] { … }`. Rules in the other CSS
  files use only variables.
- `src/styles/themes.css` holds each theme's ornament: corner ticks, HUD
  brackets and grid, the Field Kit hazard stripe, Starship bands and elbows.
  All of it switches off with `data-decor="off"`.
- **Data colors** (`map/classify.js`) are the same in every theme; only the
  neutrals (`--na`, `--cluster-ns`) follow it. Terminal Night filters the map
  and data chips red with `--data-filter`; exported PNGs are not filtered.
- Motion is near zero: `--dur-fast` fades, a pulsing status dot, and a global
  `prefers-reduced-motion` switch.

**To add a theme:**
1. Add an entry to `THEMES` in `src/core/settings.js` (id, name, note, swatch,
   theme color).
2. Copy a token block in `tokens.css` and change the values.
3. Optionally add ornament in `themes.css`.
4. Add its id to the theme list in `tests/e2e/e2e.mjs` and `scripts/screens.mjs`.

Fonts come from Fontsource packages; `tokens.css` references the woff2 files
in `node_modules`, and esbuild copies them to `dist/assets/` with a hash. A
font downloads only when a theme uses it.

## 8. Commands, keys and the palette

- `COMMANDS` (`src/core/commands.js`) names every action; `main.js` binds a
  handler for each (`bindCommands`).
- `KEY_OF` and `SHORTCUTS` (`src/core/keys.js`) map keys to commands; the help
  sheet is drawn from `SHORTCUTS`.
- The palette (`src/ui/palette.js`, ranking from Plank) lists the commands,
  then layers, measures and themes, and, for queries of two or more
  characters, matching places.

**To add a command:** add it to `COMMANDS`, bind its handler in `wire()` in
`main.js`, and optionally give it a key in `KEY_OF` and `SHORTCUTS`.
`tests/shell.test.js` fails if a key points at an unknown command or two keys
clash.

## 9. The service worker and offline use

The build fills in `public/sw.js` and writes `dist/offline.json`.

| Cache | Holds | Filled |
| --- | --- | --- |
| `rumb-shell-<version>` | Page, scripts, CSS, fonts, icons | At install; version is a hash of the shell |
| `rumb-data-<data version>` | Region catalog, display geography, backdrop; then any data file | Some at install, the rest on first use |
| `rumb-vendor-v1` | `vendor/duckdb-<v>/`, `vendor/geoda-lisa-<v>/` | On first use |

**Download for offline** (palette or command) fetches every file in
`offline.json` through the worker and asks for persistent storage. Range and
HEAD requests are answered from cached files. A new version installs itself
and the page offers **Reload**. The dev server (`npm run dev`) unregisters the
worker. There is no cross-origin isolation (COOP/COEP); single-threaded DuckDB
does not need it.

## 10. Storage and file formats

- `localStorage`: only `rumb.settings` (theme, text size, decoration,
  scanlines, coordinate format). The inline script in `index.html` applies it
  before first paint.
- **`.rumb` project** (a stored ZIP):
  - `project.json`: `{ format: "rumb", version: 1, state, files }`; the state
    includes query layers (GeoJSON), settings, comparisons, results and the
    camera.
  - `imports/<n>`: the original imported files.
  - `base/`: the reference files, plus the Compare reference when used.
- Field Atlas projects (`format: "field-atlas"`, `.bgis`) open the same way;
  `normalizeState()` renames old layer flags.

## 11. Libraries and packages

Versions are pinned exactly in `package.json`. A new version should be at
least two weeks old.

| Package | Version | Licence | Why |
| --- | --- | --- | --- |
| maplibre-gl | 5.24.1 | BSD-3-Clause | WebGL map, globe and terrain ready for later |
| @duckdb/duckdb-wasm | 1.32.0 | MIT | SQL, spatial joins and Parquet in the browser |
| @geoda/lisa | 0.0.25 | MIT | GeoDaLib local statistics (more are available: Gi*, Geary, bivariate) |
| jsts | 2.12.1 | EDL-1.0 / EPL-1.0 | DE-9IM contiguity for imported polygons |
| @zip.js/zip.js | 2.8.11 | BSD-3-Clause | Project files |
| @fontsource(-variable)/* | 5.3.0 | OFL-1.1 | Theme fonts |
| esbuild | 0.28.2 | MIT | Bundling (dev) |
| playwright | 1.65.1 | Apache-2.0 | Browser tests (dev) |

DuckDB's extensions (parquet, json, spatial for DuckDB 1.4.3) are fetched by
`scripts/vendor-db.mjs` and checked against SHA-256 pins.

**Licence rule:** a shipped library must have a compatible licence. List it in
`shipped` in `scripts/build.mjs`, which writes `dist/THIRD-PARTY.txt`, and in
the README's credits table.

## 12. Tools and the build cycle

```sh
npm run dev          # build once, rebuild src/ and public/ on change, serve /rumb/
npm run build        # production build (minified); prints sizes
npm run build:debug  # readable build with source maps
npm run serve        # serve dist/ like GitHub Pages (RUMB_BASE, RUMB_PORT)
npm run vendor       # stage DuckDB in .cache/vendor/ (the build does this too)
```

`scripts/build.mjs`:
1. stages DuckDB;
2. copies `public/` and the versioned runtimes into `dist/`;
3. bundles `src/main.js` (`app.js`) and `src/stats/worker.js`
   (`stats-worker.js`) as ES modules, with lazy chunks in `chunks/`;
4. writes `bundle-report.txt` and `THIRD-PARTY.txt`;
5. fills in the service worker.

Build constants: `__RUMB_VERSION__`, `__RUMB_DEV__`, `__DUCKDB_FOLDER__`,
`__LISA_WASM__`.

## 13. How to update things

- **DuckDB-Wasm:** bump the version, update the extension version and
  SHA-256 pins in `scripts/vendor-db.mjs` (it refuses a mismatched version),
  run `npm run build` and `npm run e2e`.
- **A data file:** run its prepare script (REPRODUCIBILITY.md), keep
  `catalog.json` in step, run `npm test` (catalog against data, statistics
  against R).
- **The logo:** edit `public/rumb.svg`, then `node scripts/make-icons.mjs`.
- **Review screenshots:** `npm run build`, then
  `node scripts/screens.mjs <stage>`.

## 14. Tests

- `npm test` runs `node --test tests/*.test.js`, in under a second:
  - **statistics:** 872 local Moran values against R/spdep under queen and
    rook; small cases against matrix algebra and exhaustive permutations;
  - **Compare:** all 870 scores, ranks and quadrants against R;
  - **pure modules:** catalog against data, store, classes, CSV, keys,
    settings, palette ranking.
- `npm run e2e` runs `tests/e2e/e2e.mjs` against `dist/`, served under `/rumb/`
  with no special headers. It prints PASS, FAIL or SKIP for each check.
  - Switches: `BROWSER=webkit`, `SHOTS=dir` (screenshots; always on failure),
    `ONLY=clusters,keys`, `HEADED=1`, `RUMB_BASE=/other/` (another subpath).
  - What it checks: the map before any analytics load; queen and rook global
    I; imports, joins and mapped queries; project save and restore (including
    old Field Atlas projects); Compare; themes; the palette; keys; the status
    bar; 320px layouts; offline reload; and that every request stays on the
    site's own origin.
- CI (`.github/workflows/test.yml`) runs both on Chromium and WebKit (WebKit
  allowed to fail for now).

## 15. Publishing on GitHub Pages

`.github/workflows/pages.yml` runs on every push to `main`: `npm ci`,
`npm test`, `npm run build`, then deploys `dist/` to
<https://jossammil.github.io/rumb/>. All paths are relative, so the same build
works under any subpath. The repository was renamed from `bgis` in November
2026; GitHub redirects the old repository URL but not the old Pages address
(`/bgis/` no longer serves).

## 16. Debugging

In the browser console, `window.rumb` has:

- `state` (the store's state) and `app` (every panel and helper);
- `map` (the MapLibre map) and `runCommand("…")`;
- `appearance({ theme: "hud" })`;
- `timings` (`firstMap`, `lastQuery`, `lastAnalysis`, all in ms);
- `openDatabase()` (a separate DuckDB, for benchmarks).

| Problem | Likely cause |
| --- | --- |
| Changes do not show after `npm run build` | The service worker served the old shell: reload twice, or use DevTools › Application › Service workers › Update on reload. `npm run dev` avoids it. |
| "The data catalog is missing …" | `catalog.json` lacks a required key; `validateCatalog()` names it. |
| SQL engine fails to start | `.cache/vendor/` incomplete: run `npm run vendor`; it re-downloads and checks the extensions. |
| Statistics worker failed to load | `dist/stats-worker.js` or `dist/vendor/geoda-lisa-*/` missing: rebuild. |
| e2e: "Run `npm run build` first" | `dist/` is missing. |

## 17. Glossary

- **Reference layer:** the region's built-in polygons (Mississippi tracts),
  with neighbors and field metadata from the catalog.
- **Query layer:** a map layer made from SQL. It is "on the reference" when
  keyed by the reference ID, which gives it the reference geometry and
  weights.
- **Queen / rook:** neighbors share any boundary point / a boundary segment.
- **LISA:** Local Indicators of Spatial Association (local Moran's I).
- **Shell:** the files that make the app run, as opposed to data and the
  large runtimes.
- **Token:** a CSS variable that a theme sets.
