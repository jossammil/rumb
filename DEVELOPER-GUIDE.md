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

The page reads the **catalog** for its region (`data/ms/catalog.json`) and
shows the reference layer (Mississippi tracts) from a GeoJSON file. These load
only when the reader first needs them:

- the **layer library** (`data/ms/layers/library.json`, 33 add-on layers) and
  each library layer's file;
- the roads, which wait for the first map;
- DuckDB (about 59 MB) and the statistics code;
- for a tile layer (the national tract map), the PMTiles reader, its tiles
  and its values, read by range requests (section 6).

The map draws a **stack** of layers, one GeoJSON source each. The **focus
layer** (`state.active`) is the one the style panel, inspector and analysis
act on.

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
| Layer stack, looks, labels, popups | Main thread, WebGL | `src/map/layer-specs.js`, `src/map/map.js`, `src/panels/layers.js`, `src/catalog/popup.js` |
| Projection, distances, filters, point counts | Main thread | `src/geo/*.js`, `src/panels/filter.js` |
| Buffer outlines | Statistics worker | `src/stats/buffer.js` (jsts) |
| Pooled measures over a selection | Main thread | `src/stats/pool.js`, `src/panels/inspector.js` |
| Measuring, my location, go to | Main thread | `src/panels/tools.js`, `src/map/sketch.js` |
| Share links | Main thread | `src/core/share.js`, `src/panels/share.js` (loaded when used) |
| Layer exports, printable report | Main thread; GeoParquet in the DuckDB worker | `src/data/export.js`, `src/panels/exports.js`, `src/report/report.js` (loaded when used) |
| Reference data | R and Python, by hand | `scripts/prepare-*.R`, `scripts/prepare-places.py`, `scripts/layers.json` |

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
│       └── ms/              Mississippi: catalog.json, tracts, backdrop and roads
│           └── layers/      the library: library.json and one GeoJSON per add-on layer
├── src/
│   ├── main.js              wiring: creates everything, binds commands and events
│   ├── core/                state, commands, keys, settings, the workspace (pure, mostly)
│   ├── catalog/             reading the catalog and library; formatting; popups
│   ├── geo/                 projection, measuring, plane geometry, filters, counts (pure)
│   ├── map/                 MapLibre, the style and layer specs, classes, legend, shapes, sketching, PNG export
│   ├── data/                DuckDB, project files, CSV and SQL quoting, offline
│   ├── stats/               statistics, contiguity, Compare scoring, the worker
│   ├── panels/              one module per part of the screen (layers, style, filter, tools, …)
│   ├── report/              the printable report (loaded when used)
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

### Run a spatial analysis

1. The button `#analyze` (or **R**; **H** picks Gi* first) calls
   `app.analysis.run()` in `src/panels/analysis.js`. The **Method** menu
   (`state.method`) lists the entries of `src/stats/methods.js`; a method with
   controls of its own loads them from `src/panels/methods/<id>.js` the first
   time it is chosen.
2. `run()` gets what the weights need. For queen or rook, it uses the
   neighbor graph: the precomputed `neighbors.json` for the reference layer
   (`ws.neighbors()` in `src/core/workspace.js`), a library layer's own, or
   contiguity the worker computes for an imported layer (cached in
   `ws.graphs`). For k nearest, a band or inverse distance (and for a scan),
   it projects each feature's 2020 center of population (`ws.centers()`) or
   its area-weighted centroid to EPSG:3814.
3. It builds `{ values, neighbors | points, weights, denominators, studyIds }`
   plus the method's extras: a second measure (bivariate), the counts behind a
   rate (EB-adjusted, scan) or the scan's window limits. A zero denominator
   excludes an area instead of reading as 0%.
4. `callStats()` (`src/stats/client.js`) posts the request to the one
   statistics worker, which runs the method's `request`: `analyze()` in
   `stats/stats.js` (Local Moran), `hotSpots()` in `stats/hotspots.js`,
   `bivariate()` or `ebMoran()` in `stats/variants.js`, or `scanAreas()` in
   `stats/scan.js`. All share `prepareUniverse()` (eligibility and weights)
   and the seeded generator in `stats/random.js`. A scan posts progress.
5. The result, which names its method, goes into the store (`result`,
   `mode: "cluster"`). `app.draw()` (`src/panels/style.js`) recolors the map
   and legend from the method's classes; `src/panels/inspector.js` draws its
   summary and feature rows; the CSV, PNG note and report read the same entry.

### Fit a regression

1. With **Regression** chosen, `src/panels/methods/model.js` lists the
   covariates in the measure picker's groups. The measure on the map is the
   outcome.
2. `run()` sends `{ type: "model", modelType, values, covariates, … }`. For
   count models it also sends the measure's numerator and denominator
   (`poolOf`).
3. In the worker, `fitModel()` (`stats/models.js`) keeps the areas with
   every variable and an eligible neighbor, then fits the model:
   - OLS always (`stats/regression.js`), for its diagnostics;
   - the spatial model (`stats/spatial-models.js`) or the count model
     (`stats/glm.js`) on top.
   It classes the standardized residuals.
4. The registry entry `model` (`stats/methods.js`) supplies the summary rows,
   the coefficient, impact and diagnostic tables, and the two charts. The
   inspector renders these generically.
5. **Add predictions and residuals as fields** stores a model spec on the
   stack entry. `app.ensureDerived()` refits it in the worker, so
   `fit_*`, `res_*` and `sres_*` appear under Derived.

### Smooth a rate

1. **Smooth a rate…** opens `src/panels/smooth.js`, which lists the focus
   layer's measures with a numerator and denominator (`poolOf` in
   `stats/pool.js`).
2. It stores a spec on the layer's stack entry:
   `derived: [{ kind: "rate", measure, methods }]`.
3. `app.ensureDerived()` (`main.js`) computes the fields with `rateFields()`
   (`stats/rates.js`), using the queen graph for the spatial methods, and
   caches them by collection. `app.layerById()` adds them, so they appear
   under "Derived" and work everywhere a field does. Restores and share links
   carry the spec and call `ensureDerived()` again.

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

### Add a library layer, filter it and share the map

1. **N** (or **Add layer**) runs `openLibrary()` in `src/panels/layers.js`.
   `ws.library()` reads `layers/library.json` once. Choosing a layer calls
   `app.addLibraryLayer(id)`, which reads its GeoJSON through
   `ws.loadLayer()` (cached as a Blob, so a project can carry it) and makes
   it the focus with `focusLayer()`.
2. `focusLayer()` stashes the outgoing layer's view settings in
   `state.layerViews`, adds the layer to `state.stack` (`src/core/stack.js`)
   and calls `renderAll()`.
3. `app.syncMap()` makes the map match the stack. `atlas.addLayer()` builds
   the layer's MapLibre layers from `layerSpecs()` (`src/map/layer-specs.js`)
   and puts them in their band. Then `style.draw()` colors every shown layer
   from its own view settings.
4. **C** arms a click (`tools.pick()`). The radius filter goes to
   `state.filter`.
5. `filter.keptFor(layer)` (`src/panels/filter.js`) runs `applyFilter()` from
   `src/geo/filter.js` on a projected index of each layer, cached per layer.
   `style.draw()` then dims or hides what it leaves out.
6. **U** loads `src/panels/share.js`. `shareState()` (`src/core/share.js`)
   picks what may travel. `encodeShare()` deflates it into `#state=…`.
   Opening that link runs `readShare()` and replaces the state.

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
| `catalog/catalog.js` | yes | Loads and checks the catalog and the layer library; field labels; starter SQL | `loadCatalog`, `loadLibrary`, `layerMeta`, `fieldInfo`, `fieldLabel` |
| `catalog/popup.js` | yes | Popup rows from a layer's popup fields, formatted | `popupRows`, `formatValue` |
| `core/stack.js` | yes | The layer stack: add, remove, move, show, normalize | `withLayer`, `moveLayer`, `normalizeStack` |
| `core/share.js` | yes (CompressionStream) | What a share link carries; encode, decode, check | `shareState`, `encodeShare`, `readShare` |
| `geo/project.js` | yes | Transverse Mercator (EPSG:3814) forward and inverse | `transverseMercator`, `regionProjection` |
| `geo/measure.js`, `geo/coords.js` | yes | Lengths and areas in miles; reading typed coordinates | `measurePath`, `parseCoordinate` |
| `geo/spatial.js` | yes | Plane geometry: boxes, point in polygon, distances | `pointDistance`, `geometryDistance` |
| `geo/filter.js`, `geo/counts.js`, `geo/filter-sql.js` | yes | Radius, buffer and polygon filters; point counts; the filter as DuckDB SQL | `applyFilter`, `countPoints`, `filterSQL` |
| `catalog/format.js` | yes | Number formatting | `number`, `plural` |
| `map/map.js` | no | MapLibre map: the stack, Compare, selection, popups, capture for tools, fit, retheme | `initMap` |
| `map/layer-specs.js` | yes | MapLibre layers for one stacked layer, by kind and band | `layerSpecs`, `entryStyle`, `kindOf` |
| `map/basemap-style.js` | no | Style JSON from tokens: backdrop, roads, anchors, overlays | `buildStyle`, `mapColors`, `neutralColors` |
| `map/classify.js` | yes | Palettes (OKLab ramps), category colors, quantile, equal, Jenks, SD and manual breaks | `palettes`, `classify`, `jenks`, `categories`, `ramp` |
| `map/shapes.js` | yes (+ map images) | Point shapes as signed distance fields | `shapeImage`, `addShapeImages` |
| `map/sketch.js` | no | Click-to-draw for measuring and the polygon filter | `createSketch` |
| `map/legend.js` | no | One legend renderer (map and Compare) | `renderLegend`, `classItems` |
| `map/export-png.js` | no | PNG with title, legend and credits | `exportMapImage` |
| `data/database.js` | no | DuckDB-Wasm: views, SELECT checks, map and CSV queries, joins | `openDatabase` |
| `data/project.js` | no | `.rumb` ZIP reading and writing | `packProject`, `unpackProject` |
| `data/csv.js`, `data/sql.js` | yes | CSV cells; SQL quoting | `csvText`, `ident`, `sqlString` |
| `data/export.js` | yes | A layer's features for CSV and GeoJSON export | `exportFeatures`, `featuresCSV` |
| `data/offline.js` | no | Registers the service worker; Download for offline | `createOffline` |
| `stats/stats.js` | yes | Moran's I and LISA on contiguity or distance weights; eligibility, permutations, FDR | `analyze`, `prepareUniverse`, `adjustFdr` |
| `stats/methods.js` | yes | The analysis methods: how each result reads in the legend, inspector, CSV, PNG and report | `METHODS`, `methodOf`, `basisOf` |
| `stats/neighbors.js` | yes | k nearest, distance-band and inverse-distance weights; centroids; summaries | `distanceWeights`, `centroid`, `weightsSpec` |
| `stats/hotspots.js` | yes | Getis–Ord Gi*, General G, Geary's C | `hotSpots`, `giStar`, `generalG`, `gearyC` |
| `stats/variants.js` | yes | Bivariate and EB-adjusted Local Moran | `bivariate`, `ebMoran`, `ebStandardize` |
| `stats/rates.js` | yes | EB, spatial EB and window rates, excess risk, Poisson limits, reliability | `rateFields`, `empiricalBayes`, `acsReliability` |
| `stats/scan.js` | yes | Kulldorff's spatial scan (Poisson) with Monte Carlo replicates | `scanAreas`, `scan`, `llr` |
| `stats/dist.js` | yes | Normal, t, F, chi-square, gamma and Poisson distributions and quantiles | `pnorm`, `qnorm`, `pt`, `pchisq`, `qgamma`, `poissonCI` |
| `stats/random.js` | yes | Seeded uniforms (Mulberry32), shuffles, binomial and multinomial draws | `randomGenerator`, `binomial`, `multinomial` |
| `stats/linalg.js` | yes | Householder QR, (XᵀX)⁻¹, Cholesky, solves, symmetric eigenvalues | `leastSquares`, `qr`, `symmetricEigenvalues` |
| `stats/regression.js` | yes | OLS with GeoDa's diagnostics and the spatial LM tests, from sparse traces | `ols`, `spatialDiagnostics`, `standardize` |
| `stats/spatial-models.js` | yes | ML spatial lag and spatial error models, with impacts | `spatialModel`, `weightEigenvalues`, `brent` |
| `stats/glm.js` | yes | Poisson and negative binomial regression with an offset | `countModel`, `thetaML` |
| `stats/models.js` | yes | A model over a layer's areas: eligibility, residual classes, the worker entry | `fitModel`, `MODEL_TYPES` |
| `stats/access.js` | yes | Nearest facility, facilities within a distance, E2SFCA | `accessMeasures`, `decay` |
| `stats/points.js` | yes | Nearest neighbor, Ripley's L with envelopes, centrography, kernel density | `pointPattern`, `densityGrid`, `centrography` |
| `core/derived.js` | yes | Derived-field and generated-layer specs: rates, models, access, density | `derivedSpec`, `modelSpec`, `accessSpec`, `densitySpec` |
| `ui/chart.js` | partly | Moran scatterplot, point chart, line chart with a band, histogram; nice ticks (pure) | `scatter`, `pointChart`, `lineChart`, `histogram`, `niceTicks` |
| `stats/weights.js` | yes | Queen/rook contiguity with jsts | `polygonNeighbors` |
| `stats/compare-score.js` | yes | Compare percentiles, scores, ranks, CSV | `compareAreas`, `comparisonCSV` |
| `stats/pool.js` | yes | Pooled measures (Σ numerator / Σ denominator) with coverage | `aggregate`, `poolOf`, `neighborsOf` |
| `stats/buffer.js` | worker | Buffer outlines with jsts | `bufferOutline` |
| `stats/worker.js`, `stats/client.js` | worker | The worker and its persistent client | `callStats` |
| `panels/*.js` | no | Layers, style, filter, tools, analysis, inspector, find, Compare, workbench, files, share, exports, smoothing | `create…`, `open…` |
| `panels/methods/*.js` | no | Controls a method adds under the Method menu (loaded when chosen) | `render` |
| `panels/access.js`, `panels/density.js`, `panels/smooth.js` | no | The access, density surface and smoothing dialogs (loaded when used) | `openAccess`, `openDensity`, `openSmooth` |
| `report/report.js` | no | The printable report (loaded when used) | `openReport`, `buildReport` |
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

**The layer library** (`layers/library.json`) is written by
`scripts/prepare-layers.R` from the manifest `scripts/layers.json`. Each layer
has:

- `id`, `name`, `group`, `geometry` (point, line, polygon), `file` and, for
  polygons, `neighbors`;
- `count`, `bbox`;
- `labelField`, `typeField`, `placeField`, `populationField`;
- `popupFields`, `measures`;
- `fields`, each with a label, a format (text, number, integer, percent,
  rate, currency, phone, url), a unit and a `pool` rule;
- `style.color`, `credit`, `vintage`, and `source` (URL, terms, input and
  output SHA-256).

Feature IDs are the top-level GeoJSON `id`. The catalog points at the library
(`"library": "layers/library.json"`). `validateLibrary()` checks it, and a unit
test checks it against every file.

**Tile layers.** A catalog's `"tiles": "tiles/tiles.json"` adds tile layers
to the library, marked `tiled`: the national tract map (`us`), and Delaware's
hidden test copy. `scripts/build-tiles.mjs` writes them (section 13). An entry
has `tiles` (a PMTiles file), `sourceLayer`, `minzoom`, `maxzoom`, `idField`,
`values` (a Parquet file), `states` (each state's `start` row and `rows`), and
the usual `measures` and `fields`.

- **Features.** `ws.loadLayer()` makes one feature per row of the values file,
  with no geometry: its id, name and county. `ensureFields()` reads a field,
  and the fields its meaning rests on (MOE, counts, limits, pooling), as
  columns by HTTP range requests (`src/data/parquet.js` `readColumns`). The
  file's size comes from a one-byte range request, not HEAD: GitHub Pages
  gzips, so a HEAD's Content-Length is the compressed size (`npm run serve`
  does the same, so the tests see it). So `colorize()` runs unchanged.
- **Map.** `addLayer(id, kind, style, tiled)` makes a vector source with
  `promoteId`. `setData()` writes `color`, `out` and `unreliable` as
  feature-state, and `select()` writes `selected` and `neighbor`. Clicks read
  the promoted id.
- **The reader.** `src/map/tiles.js` (pmtiles) is a lazy chunk. It takes
  `addProtocol` from the map, so MapLibre stays in `app.js`.
- **Scope.** `src/core/scope.js` makes a tile layer view-only. Analysis and
  Filter are inert under a note (`src/panels/scope.js`), and Find, the
  filters, Compare and the analysis commands refuse with the reason. The
  inspector's **Open <state>** reloads into the tract's state with
  `?at=lon,lat,zoom`, which the app applies once and drops.

**The map's layers.** Each stacked layer gets a source `lyr-<id>` and the
layers `-fill`, `-outline`, `-line`, `-point` or `-shape` and `-label`. They
sit in three bands, each closed by a hidden anchor layer:

| Band | Holds | Position |
| --- | --- | --- |
| `anchor-areas` | fills, outlines and lines | below the roads |
| `anchor-points` | points | above the roads |
| `anchor-labels` | labels | above selections |

Within a band, the stack order decides. Compare draws from its own `cmp`
source while the stack is hidden. The selection draws from `selection`, and
the field tools from `sketch`, `filter` and `locate`. A MapLibre layer id
never changes type: a point layer switches between `-point` (circles) and
`-shape` (symbols).

**State keys.**

| Key | Holds |
| --- | --- |
| `stack` | `[{ id, visible, style, label, counts }]`, bottom to top |
| `active` | the focus layer |
| `filter`, `filterMode` | the spatial filter, and whether the rest is dimmed or hidden |
| `picks` | more selected features |
| `category`, `breaks` | a field to color by; manual class breaks |
| `roads`, `graticule` | the backdrop options |

`normalizeState()` brings older projects up to date. Their single active
layer becomes the stack.

Nothing about Mississippi is in `src/`. **Regions.** Two are committed:
Mississippi (the default, with the MARIS library) and Delaware (the small
fixture the pipeline builds). The other 49 are built in CI by
`scripts/build-regions.mjs` and merged into `dist/data/` and the index
(`RUMB_REGIONS`). `tests/core.test.js` runs `scripts/check-region.mjs` on
every committed region.

- **Which region opens** (`src/core/regions.js`): `?r=<id>`, then the
  region used last on the device (`rumb.region` in localStorage), then
  `index.default`.
- **Changing region reloads the page.** The catalog, projection and
  workspace are fixed when the app starts. The state picker
  (`src/panels/regions.js`, the region tag or **Change state…**), share
  links for another region, and projects from another region all go through
  `app.openRegion()`. A project waits in the `rumb-pending` cache across the
  reload (`?restore=1`).
- **Index entries** carry `id`, `name`, `path`, `tracts` (or `counties`
  for the national region) and `bounds`, so the picker reads nothing else.
- **The national region** (`us`, `scripts/regions.json` `national`) is built
  by the same scripts with `--state US`. Its reference layer is `counties`,
  in EPSG:5070. `--all` and the CI shards leave it out of the states; it
  joins the lightest shard.
- **To add or refresh a state:** `node scripts/build-regions.mjs <id> --pin`,
  review `scripts/sources/<id>.json`, and commit the pins. CI builds it on
  the next deploy.

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
| `rumb-data-<id>-<hash>` | One region's `data/<id>/` files; the hash covers only that region, so rebuilding one state leaves the others cached | The default region's catalog, display geography and backdrop at install; the rest on first use |
| `rumb-data-shared-<hash>` | `data/index.json` and `data/shared/` (the world outline every region uses) | The index at install |
| `rumb-vendor-v1` | `vendor/duckdb-<v>/`, `vendor/geoda-lisa-<v>/` | On first use |
| `rumb-pending` | A project opened in another region, while the app reopens there | By the restore, then emptied |

`offline.json` lists `vendor`, `shared` and `regions: { <id>: [...] }` files,
and `bytes` for the runtimes and shared data (`base`) and for each region.
**Download for offline** (palette or command) fetches the vendor files, the
shared data and the open region's data through the worker and asks for
persistent storage. A region with more than 50 MB of its own data (only the
national region: its tiles) first says how much it downloads and waits for
a yes. A new worker deletes data caches it does not name,
including the single `rumb-data-<hash>` cache of builds before regions.

`RUMB_REGIONS=.cache/data npm run build` adds every state built by
`scripts/build-regions.mjs` to `dist/data/` and to the index, after the
committed regions (Mississippi and Delaware), in name order. With all 51,
`dist` is 589 MB on the published site, with the national region and its
tiles (503 MB before them). Range
requests are answered by slicing the cached file as a Blob, and HEAD requests
by its size. Neither reads the whole file, which matters for the 37 MB of
tiles. A new version installs itself
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
  - `base/layers/`: the files of library layers in the stack, so a project
    opens offline and with the same data.
- Field Atlas projects (`format: "field-atlas"`, `.bgis`) open the same way;
  `normalizeState()` renames old layer flags.
- **Share links** (`#state=…`) are the map's state, deflated and base64url
  encoded, in the part of the address browsers never send. They carry only
  catalog layers and settings, never imported files, SQL or results.
  `readShare()` checks every value against a whitelist.

## 11. Libraries and packages

Versions are pinned exactly in `package.json`. A new version should be at
least two weeks old.

| Package | Version | Licence | Why |
| --- | --- | --- | --- |
| maplibre-gl | 6.17.0 | BSD-3-Clause | WebGL2 map, globe and terrain ready for later; its tile worker is built into `app.js` (`scripts/build.mjs`) |
| @duckdb/duckdb-wasm | 1.32.0 | MIT | SQL, spatial joins and Parquet in the browser |
| @geoda/lisa | 0.0.25 | MIT | GeoDaLib observed Local Moran on binary weights (everything else is rumb's own code) |
| jsts | 2.12.1 | EDL-1.0 / EPL-1.0 | DE-9IM contiguity for imported polygons |
| @zip.js/zip.js | 2.8.11 | BSD-3-Clause | Project files |
| hyparquet | 1.32.0 | MIT | Parquet tables and tile-layer values, a lazy chunk |
| pmtiles (with fflate) | 4.5.0 | BSD-3-Clause (MIT) | Vector tiles from one file by range requests, a lazy chunk |
| @mapbox/vector-tile, pbf | 3.0.0, 5.2.0 | BSD-3-Clause | Decoding tiles in `scripts/check-tiles.mjs` (dev) |
| @fontsource(-variable)/* | 5.3.0 | OFL-1.1 | Theme fonts |
| esbuild | 0.28.2 | MIT | Bundling (dev) |
| playwright | 1.65.1 | Apache-2.0 | Browser tests (dev) |

DuckDB's extensions (parquet, json, spatial for DuckDB 1.4.3) are fetched by
`scripts/vendor-db.mjs` and checked against SHA-256 pins.

**Numerics rule:** rumb's statistics are written from the published methods
(papers and textbooks, cited at the top of each module), not ported from R's
or other GPL sources. R, spdep, spatialreg and smerc only produce the
reference values the tests compare against.

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
- **A library layer:**
  1. Add or change its entry in `scripts/layers.json`: its URL, the fields
     to keep with labels and formats, its popup fields and its color.
  2. Run `Rscript scripts/prepare-layers.R` (`--pin` for a new or changed download, then review `scripts/sources/`).
  3. Run `npm test`; the library test checks every file and field.
- **The R fixtures** for class breaks, the projection, filters, and counts and
  pooling: rerun `scripts/reference-classify.R`, `reference-geo.R`,
  `reference-filters.R` and `reference-counts.R` only when their inputs change.
  `scripts/reference-stats.R` writes every statistics fixture (distributions,
  weights, hot spots, variants, rates, scans) into `tests/stats-reference.json`.
  `scripts/reference-models.R` writes the models, access and point-pattern
  fixtures into `tests/models-reference.json`.
- **The tract tables:** edit `scripts/tables.json` (a variable code must keep
  its label), run `Rscript scripts/prepare-tables.R` (add `--pin` if a download changed, and review `scripts/sources/`), then
  `npm test`.
- **A new analysis method:**
  1. Write it as a pure module in `src/stats/` that takes the same inputs as
     `analyze()` and returns `{ method, byId, … }`. Use `prepareUniverse()`
     for eligibility and weights.
  2. Route its `request` in `src/stats/worker.js`.
  3. Add its entry to `METHODS` in `src/stats/methods.js`: classes and
     colors, feature and summary rows, CSV, report line.
  4. If it needs controls, add `src/panels/methods/<id>.js` and list it in
     `PANELS` in `src/panels/analysis.js`; put new state keys in
     `LAYER_VIEW_KEYS` and the share whitelist.
  5. Add an R fixture to `scripts/reference-stats.R`, a unit test and an e2e
     check.
- **The national tract map:** after the states are built, run
  `node scripts/build-tiles.mjs --out .cache/data/us <every state folder>`
  (tippecanoe 2.79.0 on the PATH: `brew install tippecanoe`), then
  `node scripts/check-tiles.mjs .cache/data/us`. Delaware's committed test
  copy is rebuilt with `node scripts/build-tiles.mjs --out public/data/de
  --hidden public/data/de`. REPRODUCIBILITY.md gives the flags and why
  tracts start at zoom 5.
- **The logo:** edit `public/rumb.svg`, then `node scripts/make-icons.mjs`.
- **Review screenshots:** `npm run build`, then
  `node scripts/screens.mjs <stage>`.

## 14. Tests

- `npm test` runs `node --test tests/*.test.js`, in under a second:
  - **statistics:** 872 local Moran values against R/spdep under queen and
    rook; small cases against matrix algebra and exhaustive permutations;
  - **more statistics against R:**
    - distributions and quantiles to 1e-12, deep tails included;
    - k-nearest, band and inverse-distance weights and Moran's I on each
      (spdep);
    - Gi*, General G and Geary's C (spdep);
    - bivariate and EB-adjusted Moran (spdep);
    - EB, spatial EB and window rates (spdep, formulas) and Poisson limits;
    - the spatial scan's clusters (smerc);
    - linear algebra (`qr.coef`, `chol2inv`, `eigen`), OLS and its
      diagnostics (lm, lmtest, spdep), spatial lag and error models and
      impacts (spatialreg), Poisson and negative binomial (glm, MASS);
    - access measures and point patterns, by R formulas on sf's distances;
  - **Compare:** all 870 scores, ranks and quadrants against R;
  - **pure modules:** catalog and library against data, store, stack, layer
    specs, classes, CSV, keys, settings, palette ranking, popups, exports;
  - **against R:**
    - natural breaks and SD classes against classInt (42 cases);
    - EPSG:3814 against PROJ (259 points, under 1 mm);
    - filters and point counts against GEOS on the display files;
    - pooled measures against map_project's rules;
  - **share links:** what travels, round trips, checks and the size limit.
- `npm run e2e` runs `tests/e2e/e2e.mjs` against `dist/`, served under `/rumb/`
  with no special headers. It prints PASS, FAIL or SKIP for each check.
  - Switches: `BROWSER=webkit`, `SHOTS=dir` (screenshots; always on failure),
    `ONLY=clusters,keys`, `HEADED=1`, `RUMB_BASE=/other/` (another subpath),
    `STRICT=1` (a check that skips, or a name in `ONLY` that no check has,
    fails).
  - What it checks:
    - **startup:** the map before any analytics, roads or library layers load;
    - **statistics:** queen and rook global I; distance weights; hot spots;
      bivariate and EB clusters; rate smoothing and hatching; the scan;
      regressions (OLS, lag, error) and count models; access to facilities;
      point patterns and density surfaces;
      the tract tables (lazy, pooled, in SQL, shared);
    - **data:** imports, joins and mapped queries;
    - **projects:** save and restore, including old Field Atlas projects;
    - **map:** layer identity on click; stacking library layers and
      restoring them from a project; looks, labels, categories and popups;
      class methods;
    - **tools:** measuring, my location and go-to; the radius, buffer and
      area filters against GEOS; pooled selections and point counts;
    - **sharing and output:** share links in a second browser; exports
      (CSV, GeoJSON, GeoParquet read back); the printed report as PDF;
    - **shell:** Compare; themes; the palette; keys; the status bar; 320px
      layouts; offline reload;
    - **privacy:** every request stays on the site's own origin;
    - **national:** Delaware's tile layer (`tiles`); and, only when the build
      merged `us` (`RUMB_REGIONS`), the counties (`us-counties`), the tract
      map and Open <state> (`us-tracts`), and its offline download
      (`offline-us`). CI's test workflow builds only the committed regions,
      so it skips the last three; Publish's `national` job runs them.
  - Wait for the condition the next step needs, not for time. For example, a
    model check waits for its note to count the covariates before it runs
    (ticks wait for their table to load), and the tiles check waits until
    every tract is drawn, not just colored.
- CI (`.github/workflows/test.yml`) runs both on Chromium and WebKit, and a
  failure in either fails the run. On Linux, WebKit reports work it refuses
  for a page being left ("Cannot load blob:… due to access control checks",
  "Cache API operation failed: Context is stopped", and "Fetch API cannot
  load <this site's URL> due to access control checks"). The harness leaves out
  only those, within 5 s of a navigation request or once a context is
  closing, and counts them on a `NOTE` line. To reproduce a WebKit-only
  failure, run the suite in `mcr.microsoft.com/playwright:v<version>-noble`
  (add `--cpus=1` to match a slow runner).

## 15. Publishing on GitHub Pages

`.github/workflows/pages.yml` runs on every push to `main`:

| Job | What it does |
| --- | --- |
| `data` (6 shards) | Builds the 49 states that are not committed, and the national counties (`us`, on the lightest shard), with the R pipeline (`renv.lock` pins the R packages), in shards balanced by tract count (`scripts/shards.mjs`), and checks each one. Downloads must match `scripts/sources/`. Downloads and each shard's output are cached, so a deploy without data or script changes rebuilds nothing. |
| `verify` | Rebuilds Mississippi and Delaware and compares them with `public/data/` (`scripts/compare-region.R --geometry 2e-4`). Values, ids, neighbors, tables and the analytical GeoParquet must match exactly; display geometry may differ by Linux's GDAL and GEOS rounding (see REPRODUCIBILITY.md). |
| `tiles` | Builds tippecanoe 2.79.0 from its source tarball (SHA-256 pinned, cached by version), then the national tract tiles and values from the shards' states and the committed Mississippi and Delaware (`scripts/build-tiles.mjs`). Uploads only `us/tiles/`. |
| `build` | `npm ci`, `npm test`, `scripts/check-tiles.mjs` on Delaware's and the national tiles, then `RUMB_REGIONS=.cache/data npm run build` with every shard's states and the tiles, and `scripts/check-size.mjs` (under 900 MB, no file over 100 MB). |
| `national` | Unpacks the Pages artifact `build` made and runs `us-counties`, `us-tracts` and `offline-us` on it in Chromium and WebKit, with `STRICT=1`. A failure in either browser stops the deploy. |
| `deploy` | Publishes `dist/` to <https://jossammil.github.io/rumb/>, only from `main`. Running **Publish rumb** by hand on another branch runs every other job, including `national`, and deploys nothing. |

A run that rebuilds every state (any change under `scripts/`, `renv.lock`
or the pins) takes about 40 minutes when it must download the Census
exports; the first successful one was run 45358371426 on November 24, 2026.
With the downloads cached (they are keyed on the pins), a rebuild takes
about 12 minutes, as the national map's first deploy did (run 45545303865).
A run with no data or script changes reuses every shard's cache and takes a
few minutes.

**When the data jobs fail**, read `gh run view <id> --log-failed` and the
uploaded `data-logs-<n>`, `verify-logs` and `verify-rebuild` artifacts.
Before pushing a change to the pipeline, build one state from an empty
download cache (`RUMB_SOURCE_CACHE=$(mktemp -d) node scripts/build-regions.mjs de --out-root $(mktemp -d)`):
with everything cached, download code never runs. Four of the first five
deploys after phase 3 failed on things only a cold CI run exposes:
- CDC regenerates the PLACES CSV on each download (handled with
  `places.equivalent` in `scripts/tables.json`);
- its 75 MB export outlasted R's 60-second download timeout;
- `prepare-layers.R`'s own `fetch()` shadowed a shared helper;
- Linux rounds display geometry differently from macOS.

Since then:
- **Socrata retired CDC's `rows.csv` download links in October 2026**; they
  now answer with an error, ahead of a sunset on December 21, 2026. PLACES
  downloads from the v3 export (`api/v3/views/<id>/export.csv`), which
  serves the same bytes. Outputs still record the old URL as provenance, so
  Mississippi's files did not change.
- **Wait for CI before merging.** `pages.yml` runs only on `main`, so the
  tiles job first ran after the merge. And three fixes for flaky checks were
  merged before their WebKit result came in.

All paths are relative, so the same build
works under any subpath. The repository was renamed from `bgis` in November
2026; GitHub redirects the old repository URL but not the old Pages address
(`/bgis/` no longer serves).

## 16. Debugging

In the browser console, `window.rumb` has:

- `state` (the store's state) and `app` (every panel and helper, including
  `app.filter`, `app.tools`, `app.layerById(id)` and `app.ws.library()`);
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
- **Library layer:** an add-on layer from `layers/library.json`, loaded when
  added to the map.
- **Stack, focus layer:** the layers on the map, bottom to top; the focus is
  the one the style panel, inspector and analysis act on.
- **Pooled measure:** a rate over several areas computed from summed
  numerators and denominators, not by averaging rates.
- **Query layer:** a map layer made from SQL. It is "on the reference" when
  keyed by the reference ID, which gives it the reference geometry and
  weights.
- **Queen / rook:** neighbors share any boundary point / a boundary segment.
- **LISA:** Local Indicators of Spatial Association (local Moran's I).
- **Shell:** the files that make the app run, as opposed to data and the
  large runtimes.
- **Token:** a CSS variable that a theme sets.
