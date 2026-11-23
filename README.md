# rumb

A field GIS that runs entirely in your browser: maps, spatial SQL and cluster
statistics, with no server, no install and nothing uploaded. Open it from
[GitHub Pages](https://jossammil.github.io/rumb/), drop in your own files, and
keep working offline. The starter kit is all 878 Mississippi census tracts with
ACS poverty and CDC PLACES measures, plus a library of 33 public layers to stack
over them: facilities, districts, 2020 Census tables and County Health Rankings. rumb is named for the rhumb line, a
navigator's course of constant bearing. It was called Field Atlas (repository
`bgis`) before November 2026. *Frankensteined by MillJS.*

![rumb in the Field Terminal theme: County Health Rankings uninsured rates with fire stations stacked on top and a 25-mile radius filter around Jackson](design/screens/stage-parity/12-filter-radius.jpg)

## What it does

- **Maps.** Choropleths of any numeric field, colors by category, or a single
  color.
  - Classes: quantile, equal interval, natural breaks (Jenks), standard
    deviation or manual breaks, with 3 to 9 classes.
  - Palettes: six sequential ones (Viridis, Magma and Cividis among them) and
    three diverging ones.
  - Click a tract to inspect its estimate, ACS 90% margin of error and
    denominator. Its neighbors are dashed on the map.
  - Find a feature by name, county or ID with **F** or the palette.
  - Export a PNG with its title, legend and credits.
- **Layers.** Stack several layers, reorder, hide and remove them.
  - **Add layer** (**N**) opens the library: 33 public layers for Mississippi.
    These include fire stations, schools, hospitals and pharmacies, districts,
    2020 Census county and school-district tables, and County Health Rankings
    2025. Each loads only when added.
  - Each layer has its own look: color, opacity, size, point shape, outline
    and labels.
  - Clicking a feature of another layer opens a popup from its catalog
    fields.
  - The legend lists every shown layer.
- **Filters.** Keep what lies within a radius of a point (**C**), within a
  distance of the selection (**B**), or inside an area you draw (**D**).
  - Everything else is dimmed or hidden.
  - Counts per layer and the nearest features are listed.
  - Filtering runs in the page, offline, in the state's own projection.
- **Selections, counts and pooled measures.**
  - Shift-click to select several areas.
  - The inspector pools rates over the selection, its neighbors and both.
    It sums counts, then divides, and leaves out suppressed values.
  - **Q** counts the map's points in each area as new fields, with rates
    per 10,000 people where there is a population field.
- **Field tools.**
  - Measure distance and area (**M**).
  - Show your location (**G**).
  - Type a coordinate in the palette to go there.
- **Sharing and exports.**
  - **U** copies a share link that carries the map but no data.
  - **W** exports a layer, filtered or not, as CSV, GeoJSON or GeoParquet.
  - **P** prints a report, or saves it as a PDF.
- **Tract data for analysis.** Beyond ACS poverty, tracts carry 15 ACS
  2020–2024 profile covariates with their margins of error, all 40 CDC
  PLACES 2025 health estimates with 95% intervals, and 2020 Census centers of
  population. They load only when a field needs them.
- **Spatial statistics** (**A**), each checked against R:
  - **Clusters and outliers**: global Moran's I and Local Moran (LISA), also
    **bivariate** (a measure against neighbors' values of another) and
    **EB-adjusted** for rates on small populations.
  - **Hot and cold spots** (**H**): Getis–Ord Gi* binned at 90, 95 and 99%
    confidence, by the normal approximation or permutations, with General G
    and Geary's C.
  - **Rate clusters**: Kulldorff's spatial scan (Poisson), with Monte Carlo
    p-values and secondary clusters, drawn as circles on the map.
  - **Regression**: OLS with GeoDa's diagnostics (VIF, condition number,
    Jarque–Bera, Breusch–Pagan, residual Moran's I, LM-lag and LM-error
    with robust forms); spatial lag and spatial error models by maximum
    likelihood, with impacts; Poisson and negative binomial models of counts
    with a population offset and rate ratios. Residuals map, chart and
    become fields.
  - **Point patterns**: average nearest neighbor, Ripley's L with a random
    envelope, and the mean and median centers, standard distance and
    deviational ellipse.
  - **Neighbors**: queen or rook contiguity, k nearest, a distance band or
    inverse distance, measured between centers of population.
  - The whole state, one county or the current map extent as the study area;
    99 to 9,999 permutations with a fixed seed; optional Benjamini–Hochberg
    adjustment. **Export statistics** writes every result and setting to CSV.
- **Rates and reliability.** **Smooth a rate…** adds empirical Bayes,
  spatial empirical Bayes and window rates, excess risk and exact Poisson
  limits as new fields. **Hatch unreliable estimates** stripes ACS estimates
  with a margin over 40% of the estimate and rates on fewer than 20 events.
- **Access and density.** **Access to facilities…** adds the miles to the
  nearest facility, the count within a distance, and an E2SFCA access ratio
  per 10,000 people, from each area's center of population. **Density
  surface…** turns a point layer into a kernel density layer.
- **Compare areas.** Rank polygons on two or three weighted indicators, with
  a linked map, scatterplot and table, and each area's percentiles,
  contributions and uncertainty.
- **Spatial SQL.** DuckDB with its spatial extension, in your browser.
  - Import CSV, Parquet, GeoParquet or GeoJSON by picking or dropping files.
  - Check a join to the tract GEOIDs before mapping it, and count points by
    tract.
  - Map any query that returns geometry or a GEOID, or export it to CSV.
- **Projects.** **Save** writes a `.rumb` file (a ZIP) with your imported
  files, reference data, settings, SQL and results; **Open** restores it.
  Field Atlas `.bgis` projects still open.
- **Offline.** Install it as an app, or choose **Download for offline** in the
  palette. The map, SQL and statistics then work with no network.
- **Themes for the conditions you work in.**
  - **Field Terminal** (amber and phosphor on black) is the default.
  - **Terminal · Night** turns everything, the map included, dim red, to keep
    night vision.
  - **Terminal · Daylight** is high contrast for sunlight.
  - **Tactical HUD**, **Rugged Field Kit** and **Starship**, Plank's console
    theme.
- **Keyboard first.** Ctrl/⌘ K opens a command palette that runs any command,
  switches layers and measures, changes theme and jumps to places. Single
  keys reach every tool, and a status bar shows the cursor position, zoom,
  timings, the SQL engine and the network.

## Use it

Open [rumb](https://jossammil.github.io/rumb/). The tract map appears first; the
SQL engine (DuckDB, about 59 MB) and the statistics code load only when you
first use them. Drop data files or a `.rumb` project anywhere on the page.
Press **?** for help, or Ctrl/⌘ K and start typing.

## Keyboard

| Key | Does |
| --- | --- |
| Ctrl/⌘ K or `:` | Command palette: commands, layers, measures, themes, places, coordinates |
| 1 2 3 4 | Map, Compare, Data, SQL |
| L S A | Layers, map style, spatial analysis settings |
| N, J / K | Add a layer from the library; focus the layer below / above |
| R | Run Find clusters |
| F or `/` | Find a feature |
| C, B, D, X | Radius filter, buffer the selection, draw an area, clear the filter |
| Q | Count the map's points in each area |
| M, G | Measure distance and area; show my location |
| 0, +, − | Fit the layer, zoom in, zoom out |
| I, O, Ctrl/⌘ S | Import data, open a project, save the project |
| E, W, P, U | Export a PNG, export layer data, print a report, copy a share link |
| T | Next theme |
| ? | About rumb and the shortcuts |
| Esc | Close a panel or dialog; stop a drawing tool; leave a text box |

Shift-click adds features to the selection. While measuring or drawing,
Enter finishes and Backspace removes the last point.

Single keys work when the cursor is not in a text box.

## Data and methods

The 2020–2024 ACS five-year S1701 estimates use the population for whom poverty status is determined. Zero-denominator tracts have unavailable rates. The regional display uses simplified boundaries. The canonical GeoParquet and the rook and queen graphs use full-resolution 2024 TIGER/Line tract polygons. Reference geography and analysis weights stop at the Mississippi state boundary. The [Census source manifest](public/data/ms/sources.json) records the variables, original sources, preparation versions and checksums. The backdrop uses public-domain [Natural Earth](https://www.naturalearthdata.com/) geography. What each field means, and which files make up the region, is in its [catalog](public/data/ms/catalog.json).

The statistics, their formulas, references and the R checks for each are in [METHODS.md](METHODS.md). In brief: clustering uses row-standardized weights (contiguity, k nearest, a distance band or inverse distance). Each run excludes missing measurements, zero denominators and areas with no eligible neighbors. The scatterplot locates each eligible area by its standardized measure and the mean of its neighbors' standardized measures. Observed local Moran statistics use GeoDaLib and sample variance. Global inference shuffles labels. Local inference holds the focal value fixed and samples neighbor values without replacement. The two-sided permutation tests count ties around the appropriate null expectation and use the plus-one correction. The default is 999 permutations with seed 12345, alpha 0.05. Optional Benjamini–Hochberg adjustment applies across tested local areas. The ACS margin of error describes survey sampling uncertainty. The permutation test conditions on the published estimates.

The comparison uses complete cases across all enabled indicators. Each percentile equals the number of lower values divided by the eligible count minus one. Constant fields receive 0.5. A lower-values direction uses one minus the percentile. Positive weights sum to 100. Scores are rounded to one decimal before competition ranking. Raw values at their median fall in the high half of their axis. Eight Mississippi tracts lack a complete default pair and remain visible as unranked. Tract PLACES estimates represent adults and carry 95% confidence intervals. These descriptive rankings use point estimates. [CDC PLACES 2025 tract data](https://data.cdc.gov/d/yjkw-uj5s) · [CDC methodology](https://www.cdc.gov/places/methodology/index.html)

**Library layers.**
- **Sources.** 32 come from MARIS (Mississippi Automated Resource
  Information System) downloads, every one traced to its public URL.
  County Health Rankings 2025 is filtered to Mississippi's 82 counties. The
  [layer library](public/data/ms/layers/library.json) records each source's
  URL and checksum, use terms and vintage.
- **Vintage.** Some date from 1995 to 2010; each shows its year.
- **Roads.** The numbered routes in the backdrop are 2024 Census TIGER/Line
  roads.

**Distances, filters and counts.**
- Distances, filters, buffers and measurements are straight lines in
  Mississippi Transverse Mercator (EPSG:3814), in miles, as in map_pdo. A
  feature is kept when any part of it lies within the distance.
- Point counts leave out points on a boundary, as ST_Within does.
- Both use the simplified display geometry. A point within a few metres of
  a boundary can land differently from a count on full geometry; the SQL
  view's **Count points by tract** gives the exact one.

**Classes.**
- Natural breaks are Fisher's optimal classes, as in R's classInt.
- Standard-deviation classes are one standard deviation wide, centred on the
  mean.

**Pooled measures.** They sum each area's numerator and denominator and
then divide. Areas the source suppressed, or that lack either count, are
left out and reported as reduced coverage.

To rebuild the data or check a result against R, see the [reproducibility guide](REPRODUCIBILITY.md).

## How it stays fast

- The first map needs about 1.1 MB of JavaScript (MapLibre is most of it) and
  1 MB of display geometry. DuckDB, GeoDaLib, jsts and zip.js are separate
  files loaded on first use; `dist/bundle-report.txt` lists what each file
  holds.
- Statistics run in a worker that stays alive between runs, so the page keeps
  drawing while 9,999 permutations run.
- DuckDB reads local files through browser file handles, so it reads only the
  parts of a large file a query needs.

A production build in headless Chrome on an Apple M2 Max (64 GB RAM) gave these
results with synthetic point GeoParquet. Times are from one run. "Read" counts
bytes requested from the point file, not from the reference tract file.

| Input | Rows | Register | Sum by category, all rows | Spatial join, first 50,000 points |
| --- | ---: | ---: | ---: | ---: |
| 49.99 MB | 924,548 | 0.03 s | 0.18 s, 1.26 MB read | 0.85 s, 1.17 MB read |
| 499.96 MB | 9,245,477 | 0.15 s | 1.63 s, 12.57 MB read | 0.90 s, 1.17 MB read |

The spatial query returned one result per tract and counted 39,670 points inside tracts in both files. During both queries the page kept receiving animation frames; the longest gap was 17 ms. These figures come from the Field Atlas baseline. To repeat them, run `Rscript scripts/benchmark-db.R <temporary-directory>`, then `npm run build`, `npm run serve` and `node scripts/benchmark-browser.mjs <temporary-directory>`.

## Limits

- One region ships today: Mississippi tracts. The catalog and the
  `data/<region>/` layout are ready for more states; adding them is data work.
- Map layers from SQL hold at most 10,000 features and 32 MiB of geometry; the
  SQL preview shows 100 rows. Filter or aggregate large inputs first.
- The scan is purely spatial (no space-time), and there is no geographically
  weighted regression or Bayesian disease mapping. Distances, access
  included, are straight lines in the state's projection, not travel times.
- Spatial lag and error models need symmetric weights (not plain k nearest)
  and at most 2,500 areas, since they use the weights' eigenvalues. Ripley's
  L has no edge correction; the random envelope, drawn inside the same
  outline, carries the same bias.
- CDC PLACES values are model-based; patterns in them partly reflect CDC's
  model, and results on them say so. County Health Rankings suppresses
  death counts under 10, so those counties drop out of smoothing and scans.
- A spatial scan of tracts at windows up to 50% of the population takes
  about 5 seconds; the default is 25%.
- The library's older layers keep their original vintages. Older MARIS
  districts get neighbors from tolerances (0.5 m), not exact shared vertices,
  and 911 service areas overlap.
- Share links carry the map, not data. Imported files, SQL and query layers
  stay on the device; save a project to pass those on. Links stay under
  8,000 characters, shortening a large selection or drawn area if they must.
- A project or share link that uses a newer palette or focuses a library
  layer will not open in builds from before November 2026. Nor will one
  that uses the statistics methods, weights or derived fields added later
  that month.
- Imports are CSV, Parquet, GeoParquet and GeoJSON. Shapefile, GeoPackage and
  KML are not read yet.
- Everything stays on your device. That also means a project file is the only
  way to move work to another browser.
- The service worker needs one online visit before offline use, and the
  browser may clear its cache when storage runs low unless it grants
  persistent storage.

## Development

Use Node.js 24 or later.

```sh
npm ci              # exact dependency versions
npm run dev         # build, rebuild on change, serve at http://127.0.0.1:4180/rumb/
npm test            # unit tests, including statistics checked against R
npm run build       # production build in dist/ (fetches and checks DuckDB's extensions)
npm run serve       # serve dist/ the way GitHub Pages does
npm run e2e         # browser checks; BROWSER=webkit for Safari's engine
```

The [developer guide](DEVELOPER-GUIDE.md) explains how the code fits together
and how to change it. The [reproducibility guide](REPRODUCIBILITY.md) rebuilds
the data and checks results against R. Pushes to `main` publish to GitHub Pages.

## Credits and licences

| Component | Licence | Used for |
| --- | --- | --- |
| [MapLibre GL JS](https://maplibre.org/) | BSD-3-Clause | The map |
| [DuckDB-Wasm](https://github.com/duckdb/duckdb-wasm) and its parquet, json and spatial extensions | MIT | Spatial SQL in the browser |
| [Apache Arrow](https://arrow.apache.org/) and FlatBuffers | Apache-2.0 | DuckDB result tables |
| [GeoDaLib](https://github.com/geodaai/geodalib) (`@geoda/lisa`) | MIT | Local Moran statistics |
| R packages [spdep](https://r-spatial.github.io/spdep/), [smerc](https://cran.r-project.org/package=smerc) and R itself | GPL-2 or later | Reference values for the tests (not shipped; nothing is ported from them) |
| [JSTS](https://github.com/bjornharrtell/jsts) | EDL-1.0 or EPL-1.0 | Polygon contiguity for imported layers |
| [zip.js](https://gildas-lormeau.github.io/zip.js/) | BSD-3-Clause | `.rumb` project files |
| [ColorBrewer](https://colorbrewer2.org/) diverging schemes (Cynthia Brewer, Mark Harrower and The Pennsylvania State University) | Apache-2.0 | Red–blue, pink–green and brown–teal palettes |
| Okabe and Ito's color-blind-safe colors | Free to use | Category colors |
| JetBrains Mono, Antonio, Chakra Petch and Saira Stencil One, via [Fontsource](https://fontsource.org/) | SIL OFL 1.1 | Theme fonts |
| [esbuild](https://esbuild.github.io/), [Playwright](https://playwright.dev/) | MIT, Apache-2.0 | Building and testing (not shipped) |
| U.S. Census Bureau TIGER/Line, ACS and 2020 centers of population; CDC PLACES | Public data | Reference layer, tract tables and roads |
| [MARIS](https://maris.mississippi.edu/) layers | Public use; credit MARIS | Library layers (facilities, districts, Census tables) |
| [County Health Rankings & Roadmaps 2025](https://www.countyhealthrankings.org/) (University of Wisconsin Population Health Institute) | Free with citation | County health measures |
| [Natural Earth](https://www.naturalearthdata.com/) | Public domain | Backdrop |

The build writes each shipped component's version and licence, with the font
licence texts, to `dist/THIRD-PARTY.txt`.
