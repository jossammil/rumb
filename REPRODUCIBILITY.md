# Reproducing rumb

rumb was called Field Atlas until November 2026; the data, methods and expected results below are unchanged by the rename. Use the committed data to run rumb or repeat an analysis. Rebuild the data from the original sources when auditing a release or updating its inputs. Both paths use the same browser application. GitHub Pages serves static files, MapLibre draws the map, and DuckDB-Wasm runs queries on the visitor’s device.

The baseline below is the first release with **Compare areas**, Field Atlas commit `4cbfc4a9bdfff33b6f831f5ded8b74edbaf2ae44`. Later commits restructure the application and rename it, but reproduce the same data files and statistics; the unit tests check this on every build. Keep the commit ID alongside any exported analysis. The [README](README.md) describes the workspace controls and performance measurements.

## 1. Run the baseline

Use a terminal with Git, Node.js and npm. CI uses Node 24. The clean-checkout verification also passed with Node 26.12.0 and npm 11.20.0. Run these commands in a fresh directory. The detached checkout fixes the application, data and dependency lockfile to the baseline.

```sh
git clone https://github.com/jossammil/rumb.git
cd rumb
npm ci
npm test
npm run build
npm run serve
```

Open `http://127.0.0.1:4180/rumb/` (the same subpath GitHub Pages uses) and leave the server running while testing. Run subsequent commands from the repository root in a second terminal. To edit the application with automatic rebuilds, use `npm run dev` instead.

To run the Field Atlas baseline commit itself, check it out with `git switch --detach 4cbfc4a9bdfff33b6f831f5ded8b74edbaf2ae44`, then use `npm ci`, `npm test`, `npm run build` and `npm run preview -- --port 4180 --strictPort` (that version built with Vite) and open `http://127.0.0.1:4180/`.

The first install and build need network access for npm packages and three DuckDB extensions. The build copies the worker and Wasm runtime from the locked npm package, checks the extension files against their SHA-256 pins, and puts the complete site in `dist/`. A valid extension cache under `.cache/vendor/duckdb-<version>/` is reused on later builds. Serve the whole directory over HTTP. R, Python, database credentials and an external GIS service are unnecessary for this path. [Vendor script](scripts/vendor-db.mjs) · [Dependency lockfile](package-lock.json)

## 2. Repeat two analyses with known results

| Analysis | Procedure | Expected result at the baseline |
| --- | --- | --- |
| Statewide clustering | On **Map**, choose **Population below poverty**, all Mississippi tracts, queen neighbors, 999 permutations, seed 12345 and FDR off. Choose **Find clusters**. Repeat with rook neighbors. | 878 mapped polygons, 872 eligible areas. Global Moran’s I is 0.2767762722 for queen and 0.2845724122 for rook. Compare to the displayed precision. |
| Default comparison | Open **Compare** on Mississippi tracts. Select poverty on X and transportation barriers on Y. Use higher values for both, with 50% weight each. Apply and sort by ascending rank. | 870 ranked, 8 unranked. The medians are 17.9% and 11.6%. Tract `28121020500` ranks first with a score of 100.0, high on both axes. |

For clustering, **Export statistics** records the settings, eligible neighbors, observed statistics, permutation results and exclusions. A county or captured map extent changes the study population. An all-ages result should have 872 eligible tracts even though the comparison ranks 870. The comparison requires both estimates. The ACS child poverty measure has 868 available estimates before pairing with another indicator.

The comparison uses all areas with finite values for every enabled indicator. For each field, the percentile is the number of strictly lower values divided by `n − 1`. Constant fields, including a single eligible observation, receive 0.5. Each field contributes its percentile times its percentage weight. A lower-values direction uses one minus the percentile. The app rounds the sum to one decimal before ranking, and tied scores share a rank. Quadrants use the first two raw values and count equality with a median as high. Panning, selection and sorting preserve the reference population. The eight default exclusions appear under **Unranked only** and in the CSV.

ACS poverty uses the population for whom poverty status is determined. Its 90% margin of error is in percentage points. The PLACES indicators are modeled adult prevalence estimates with 95% intervals. PLACES models can use county poverty as a predictor, so poverty and a PLACES measure can carry overlapping information. The score uses the published point estimates. [ACS variables](https://api.census.gov/data/2024/acs/acs5/subject/groups/S1701.html) · [CDC methodology](https://www.cdc.gov/places/methodology/index.html)

### Hand off a custom analysis

1. Use **Add data** to import local files. For a tract join, retain the 11-character GEOID as text. Review duplicate, matched and unmatched keys before mapping. To compare other areas, map a polygon layer with at least two numeric fields.
2. Apply the desired indicators, directions and weights, or run the cluster analysis with the desired study area, neighbor rule, seed and permutation count. Export the results CSV for inspection.
3. Choose **Save**. Keep the resulting `.rumb` file, CSV and application commit ID together. For a statewide baseline check, open the archive in a fresh tab, confirm the settings and compare the exported rows by tract ID.

A version 1 `.rumb` project is a ZIP (Field Atlas wrote the same layout as `.bgis`, which rumb still opens). `project.json` holds the manifest and workspace state, including layer SQL and applied settings. `imports/` contains the original user-supplied files. `base/` contains the tract display, full GeoParquet, neighbor graph and Census manifest, plus the PLACES snapshot when the built-in tract comparison has been used. Reopening reconstructs the imported tables. Share the archive only with recipients who can receive its underlying data. For disconnected use, choose **Download for offline** once while online, or serve a previously built `dist/` locally, and open the archive there. [Archive implementation](src/data/project.js)

## 3. Rebuild the data from public sources

Use a separate checkout for these steps. Preparation scripts write into `public/data/ms/` and `tests/` (at the baseline commit itself, `public/data/`). Put raw downloads in a directory outside the checkout and retain them if exact byte reproduction matters.

```sh
input_dir="$(mktemp -d)"
```

Use Python 3 (standard library only) and R. To install the required R packages at their currently available versions, run the command below. For exact baseline reproduction, use the versions in the table.

```sh
Rscript -e 'install.packages(c("sf", "spdep", "arrow", "rmapshaper", "jsonlite", "digest", "httr2", "classInt", "smerc"), repos="https://cloud.r-project.org")'
```

A source installation of `sf` needs GDAL, GEOS and PROJ. The repository locks JavaScript dependencies. R and native library versions are recorded here as a reference environment.

| Component | Versions used to verify the baseline |
| --- | --- |
| R and geospatial libraries | R 4.5.0, GDAL 3.8.5, GEOS 3.13.0, PROJ 9.5.1 |
| R data and geometry packages | sf 1.0-21, spdep 1.4-2, arrow 22.0.0.1, rmapshaper 0.6.1 |
| Other R packages | jsonlite 2.0.0, digest 0.6.37, httr2 1.2.1 |

### Options shared by the data scripts

`prepare-data.R`, `prepare-tables.R`, `prepare-outline.R` and `prepare-basemap.R` build one state at a time and take the same options ([`scripts/lib/region.R`](scripts/lib/region.R)):

| Option | Default | Meaning |
| --- | --- | --- |
| `--state MS` | `MS` | A state's abbreviation, FIPS code or data id, from [`scripts/regions.json`](scripts/regions.json) (the 50 states and DC) |
| `--out DIR` | `public/data/<id>` | Where the region's files are written |
| `--cache DIR` | `$RUMB_SOURCE_CACHE`, else `.cache/sources` | Downloads, national files under `us/` and the state's under its FIPS code; files already there are reused |
| `--pin` | off | Record each download's SHA-256 and counts instead of checking them |

Every download is pinned in `scripts/sources/<id>.json` ([Mississippi's](scripts/sources/ms.json)): its URL, SHA-256 and the counts read from it, such as the number of tracts and counties in the TIGER file. A data.census.gov export is pinned by the SHA-256 of its data CSV, because the ZIP around it changes between exports. Without `--pin`, a script stops when a download no longer matches its pin, so a changed source is reviewed (and re-pinned) before it reaches the app. `prepare-places.py` takes `--state` and `--out` too.

[`scripts/compare-region.R`](scripts/compare-region.R) compares a fresh build with the committed folder by meaning: every JSON value, the GeoParquet columns and geometries, and `reference.json` to 1e-12. Package versions and output checksums are reported, not compared. On November 23, 2026, rebuilding Mississippi into a scratch folder reproduced every committed file byte for byte except `sources.json`, which records spdep 1.4-3 instead of 1.4-2.

```sh
out=$(mktemp -d)
mkdir -p "$out/layers" && cp public/data/ms/layers/chr_counties_2025.geojson "$out/layers/"
Rscript scripts/prepare-data.R --out "$out"
Rscript scripts/prepare-tables.R --out "$out"
Rscript scripts/prepare-outline.R --out "$out"
Rscript scripts/prepare-basemap.R --out "$out"
python3 scripts/prepare-places.py .cache/sources/us/PLACES_tract_GIS_2025.csv --out "$out"
Rscript scripts/compare-region.R public/data/ms "$out"
```

### Census geography, poverty and spatial weights

```sh
Rscript scripts/prepare-data.R
```

The script downloads the state's 2024 TIGER/Line tract ZIP and the 2020–2024 ACS S1701 table for all its tracts (a data.census.gov export, `ACSST5Y2024.S1701.zip` in the cache, which must contain `ACSST5Y2024.S1701-Data.csv`).

The script joins one ACS record per TIGER GEOID, checks counts against denominators, and constructs queen and rook neighbors from unsimplified shared boundaries. Zero-denominator rates remain missing. It writes the following files. The [Census manifest](public/data/ms/sources.json) gives the download URLs, exact variable IDs, TIGER ZIP hash, extracted ACS CSV hash and product hashes.

| Output under `public/data/ms/` | Use |
| --- | --- |
| `tracts.parquet` | Full tract geometry in WKB and ACS attributes for spatial SQL |
| `tracts.geojson` | Simplified map display with the same GEOIDs and measures |
| `neighbors.json` | First-order queen and rook adjacency keyed by GEOID |
| `reference.json` | Independent R/spdep global and local Moran statistics for all-ages poverty |
| `sources.json` | Provenance and checksums for the four products above |

### CDC PLACES and the independent comparison fixture

Download the national **2025 census tract GIS-friendly CSV**. The county file and long-format tract file have different schemas. The script extracts four measures, their confidence limits and the adult population for Mississippi, then checks tract IDs against the Atlas geography. [CDC source table](https://data.cdc.gov/d/yjkw-uj5s) · [Extraction script and measure definitions](scripts/prepare-places.py)

```sh
curl --fail --location 'https://data.cdc.gov/api/views/yjkw-uj5s/rows.csv?accessType=DOWNLOAD' \
  --output "$input_dir/places-2025.csv"
python3 scripts/prepare-places.py "$input_dir/places-2025.csv"
Rscript scripts/reference-comparison.R
```

`public/data/ms/places-2025.json` records the source metadata, national CSV hash, definitions and 870 GEOID-keyed records. `tests/comparison-reference.json` contains independently calculated R scores, ranks and quadrants for the default pair. The extraction checks are specific to this release and geography. A future release needs its own coverage review.

The archived national CSV used for the baseline has SHA-256 `201b7eb5e6df3053115712debd436e76cda1d51058612420a1636249b808709c`. A fresh public export on November 21, 2026 had SHA-256 `d6db01cef81316fb32b9ef97228db1921c2914398c69803b72951c2b9a906481`. All Mississippi estimates, intervals, population counts and definitions matched. Only the recorded national-file hash differed. To check a new export, compare the entire derived JSON with just that one provenance field removed from the comparison. Keep the actual hash in the file.

```sh
python3 - <<'PY'
import json, pathlib, subprocess
path = "public/data/places-2025.json"
baseline = json.loads(subprocess.check_output(["git", "show", "4cbfc4a:" + path]))
rebuilt = json.loads(pathlib.Path(path.replace("data/", "data/ms/")).read_text())
for obj in (baseline, rebuilt):
    print("National CSV SHA-256", obj["source"].pop("sha256"))
assert baseline == rebuilt, "Derived records or metadata changed"
print("All Mississippi records and other metadata match.")
PY
```

### Natural Earth basemap

The basemap script downloads the fixed Natural Earth revision `ca96624a56bd078437bca8184e78163e5039ad19` by default (set `RUMB_NE_REVISION` to use another). All six input files at this revision were checked against the inputs that reproduce the committed backdrop. To keep the downloads, set `RUMB_NE_CACHE` (the older `BGIS_NE_CACHE` also works) to a directory; the script reuses files there, named as shown.

```sh
export RUMB_NE_CACHE="$input_dir/natural-earth"
mkdir -p "$RUMB_NE_CACHE"
ne_revision=ca96624a56bd078437bca8184e78163e5039ad19
for layer in ne_50m_land ne_50m_lakes ne_50m_admin_1_states_provinces_lines \
             ne_10m_rivers_lake_centerlines ne_10m_populated_places_simple ne_110m_land
do
  curl --fail --location \
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/$ne_revision/geojson/$layer.geojson" \
    --output "$RUMB_NE_CACHE/bgis-$layer.geojson" || exit 1
done
Rscript scripts/prepare-basemap.R
```

`context.geojson` contains the regional backdrop clipped to 6° of longitude and 4° of latitude past the state, in whole degrees: 98°W–82°W and 26°N–39°N for Mississippi. Alaska's extent runs past 180°W, so the far side is cropped separately and moved west by 360°. For a new state's catalog, the script also writes `.cache/build/<id>/backdrop.json`: the state's bounds, the extent, and labels for the eight nearest other states with at least 10,000 km² in view (at a point inside their visible part), plus the seas and lakes in [`scripts/waters.json`](scripts/waters.json) whose first listed point lies in view on open water. Mississippi's committed catalog keeps its hand-placed labels. `world-land.geojson` supplies a global outline when the map leaves that region. These are display assets. The tract neighbor graph comes from TIGER geography.

The same script also builds `roads.geojson` from the 2024 TIGER/Line primary and secondary roads for Mississippi (`tl_2024_28_prisecroads.zip`, SHA-256 `421905d94b9429037db33c027fd9637a35d631aa2dd90a00ec4a665054e5b702` on November 22, 2026). It keeps the numbered routes (Interstate, U.S. and state highways), dissolves each class and route into one feature, simplifies it to about 40 m and labels it with a short reference such as `I-55` or `MS 25` (the state's abbreviation prefixes its routes). To rebuild only the roads:

```sh
Rscript scripts/prepare-basemap.R roads
```

### Add-on layers (facilities, districts, County Health Rankings)

The add-on layers a reader can stack over the tracts come from 32 MARIS downloads and the County Health Rankings 2025 analytic file. [`scripts/layers.json`](scripts/layers.json) lists each source URL, the fields kept, their labels and code meanings. [`scripts/prepare-layers.R`](scripts/prepare-layers.R) downloads each source, projects it to longitude and latitude, simplifies polygon display geometry with shared arcs, and writes the files under `public/data/ms/layers/`. It takes the options above, and runs after `prepare-data.R`.

```sh
Rscript scripts/prepare-layers.R
```

**Other states.** MARIS covers Mississippi only, so another state's library holds the layers whose sources cover the nation: County Health Rankings 2025, filtered to the state's counties and placed on the Census Bureau's 2024 cartographic boundary counties (`cb_2024_us_county_500k.zip`, simplified with shared arcs to 40% of its vertices). Tracts nest in counties, so two counties touch at a point or along a segment exactly when some of their tracts do; their queen and rook neighbors come from the state's tract neighbors, which are built on full-resolution TIGER vertices. National files are pinned once, in [`scripts/sources/national.json`](scripts/sources/national.json).

| Output under `public/data/ms/layers/` | Use |
| --- | --- |
| `<layer>.geojson` | Display geometry and the kept fields, one file per layer, keyed by a top-level `id` |
| `<layer>.neighbors.json` | Queen and rook neighbors for polygon layers |
| `library.json` | What the app shows about every layer: fields, formats, pooling rules, styles, credit, source URL, source SHA-256 and output SHA-256 |

**Where each layer comes from.** The map_project workbench these layers were first gathered for kept 12 of them without a recorded source. On November 22, 2026 each of those 12 was found at `https://maris.mississippi.edu/MARISdata/<Category>/<Name>.zip`. All 32 MARIS downloads were byte-identical (`.shp` and `.dbf`) to the copies map_project had used. Their metadata states public use with no access constraints. MARIS asks to be credited as a source provider, and the Census Bureau's TIGER-derived layers ask for acknowledgement. No layer restricts reuse. The third-party ArcGIS copies map_project also used (HIFLD and RxOpen services with unstated terms) are not included.

| Layers traced on November 22, 2026 | MARIS folder |
| --- | --- |
| Casinos 2020, law enforcement sites 2017, places of worship 2020 | `Cultural` |
| Community college districts 1995, public school districts 2015–16, public schools 2024 | `Education` |
| Mental health regions 1998, MSDH rural health facilities 2007, nursing homes 2024, pharmacies 2010, public health departments 2010 | `Health` |
| Highway Patrol districts 2023 | `Boundaries` |

**Cleaning rules.**
- Placeholder text (`NOT AVAILABLE`, `N/A`) and `-999` become missing.
- Coded fields get their published meanings: law enforcement site types from the MARIS metadata, and NCES school types and statuses.
- All-capital names are shown in title case.
- One courthouse record whose location is a placeholder at the largest representable coordinate is dropped. `library.json` records the count.
- Four post-office multipoints keep their first point.
- Point IDs are source row numbers; census polygons use their GEOIDs.

**Neighbors.** Neighbors for these older layers use tolerances instead of exact shared vertices. Queen neighbors are polygons within 0.5 m of each other; rook neighbors share at least 1 m of boundary. 911 PSAP service areas overlap one another, so their queen graph is dense.

**County Health Rankings.** The rows come from the analytic CSV filtered to the 82 Mississippi counties, placed on the 2020 Census county geometry from the MARIS county layer, and joined on the five-digit FIPS code. Fractions become percentages, and provider ratios become rates per 100,000. Each pooled measure keeps its numerator, denominator and flag. The official file downloaded on November 22, 2026 has SHA-256 `5a129b856489fe6646013d7fcf85397dd576f6d67a65f5db72738a1df29643de` and matched map_project's copy. Cite it as: University of Wisconsin Population Health Institute, *County Health Rankings & Roadmaps 2025*.

### Tract tables: ACS profile covariates, CDC PLACES and centers of population

Statistics on tracts need more than poverty. [`scripts/tables.json`](scripts/tables.json) lists 15 ACS 2020–2024 covariates (each a published data-profile percentage with its margin of error, count and universe, or an estimate with its margin), all 40 CDC PLACES 2025 tract measures, and the 2020 Census centers of population for tracts and counties. [`scripts/prepare-tables.R`](scripts/prepare-tables.R) builds them into `public/data/ms/tables/`. The app reads `tables/index.json` after the first map, and a table's values only when one of its fields is mapped or a method needs it.

```sh
Rscript scripts/prepare-tables.R
```

- **ACS profiles.** The api.census.gov endpoint now requires a key, so the script requests the data.census.gov exports of `ACSDP5Y2024.DP02` to `DP05` for all Mississippi tracts, the same way `prepare-data.R` requests S1701. Each variable code is checked against the label it had on November 23, 2026. A changed label stops the build. "No high school diploma" is 100 minus the published "high school graduate or higher" percentage, with that percentage's margin of error; its count is the sum of the two published categories below a diploma. Every percentage is checked against count ÷ universe within 0.05 points.
- **CDC PLACES.** The table uses the national 2025 GIS-friendly tract CSV, the same file (and SHA-256) as `places-2025.json` below. Values are model-based crude prevalence among adults with 95% intervals. 870 of Mississippi's 878 tracts have estimates; the 8 without are listed in `index.json`. CDC publishes none for tracts with almost no adults, so the script stops if a tract with an ACS population of 50 or more has no PLACES row (Mississippi's 8 have at most 30 people). The 2025 release lacks whole measures for some states: Kentucky and Pennsylvania have only the 2022 measures (teeth lost, dental visits, colorectal screening and mammography), and Colorado, Florida, Oregon, South Dakota, Tennessee, Texas, Vermont, Washington and Wyoming have none of the seven social-needs measures. A measure with no estimate anywhere in the state is left out of its table and listed in `index.json` as `measures_not_published`. A single tract without an estimate stays missing. Measures for all adults pool over a selection as a mean weighted by adult population; the six measures for narrower groups (65 and over, women 50–74, ages 18–64, people screened or with high blood pressure) do not pool.
- **Centers of population.** `CenPop2020_Mean_TR28.txt` and `CenPop2020_Mean_CO28.txt` (each state's files carry its FIPS code) give each tract's and county's population-weighted center and 2020 population. Distance-based statistics use them instead of shape centroids when they are loaded.
- **County Health Rankings additions.** `scripts/layers.json` adds v127 (premature age-adjusted mortality) and v161 (suicides). Their published values are age-adjusted, but their numerators and denominators are crude counts and person-years, so pooled or smoothed values are crude rates and the app labels them so. Rebuilding the library on November 23, 2026 reproduced every other layer byte for byte.

`tables/index.json` records each export's data-file SHA-256, the PLACES file hash, the center files' hashes, and each output's size and hash.

### Independent fixtures for the map tools

Six R scripts write the fixtures the unit tests compare against. Each uses
the committed data files, so rerun them only when those files change.

| Script | Writes | What it computes |
| --- | --- | --- |
| `scripts/reference-classify.R` | `tests/classify-reference.json` | classInt Fisher natural breaks (no sampling) and standard-deviation breaks for six fields at 3 to 9 classes |
| `scripts/reference-geo.R` | `tests/geo-reference.json` | 259 NAD83 positions projected to EPSG:3814 by PROJ |
| `scripts/reference-filters.R` | `tests/filter-reference.json` | GEOS radius, buffer and polygon filters on the display files, in EPSG:3814 |
| `scripts/reference-counts.R` | `tests/counts-reference.json` | GEOS point-in-polygon counts per tract and county; pooled County Health Rankings measures by map_project's rules |
| `scripts/reference-stats.R` | `tests/stats-reference.json` | R's distribution functions and quantiles (deep tails included) and `poisson.test` limits; spdep k-nearest, distance-band and inverse-distance weights between tract centers of population projected by PROJ, with Moran's I on each; GEOS centroids; spdep Gi* (`localG`), `globalG.test`, `geary.test`, `localmoran_bv` and `EBImoran.mc`; `EBest` and `EBlocal`; smerc `scan.test` clusters for county overdose deaths and tract poverty |
| `scripts/reference-models.R` | `tests/models-reference.json` | `qr.coef`, `chol2inv`, `chol` and symmetric `eigen` on tract data and weights; `lm` with VIF, condition number and Jarque–Bera by formula, `lmtest::bptest`, spdep `lm.morantest` and `lm.RStests`; spatialreg `lagsarlm`, `errorsarlm` (eigen) and `impacts`; `glm` and `MASS::glm.nb` for overdose deaths with an offset; access (nearest, within, E2SFCA) and point patterns (nearest neighbor, Ripley's L, centrography, quartic density) by formula on sf's distances |

The scripts need the R packages `classInt`, `spdep`, `smerc`, `spatialreg`, `lmtest` and `MASS` besides those above. The statistics fixtures were written with spdep 1.4-3, smerc 1.8.6, spatialreg 1.4-3, lmtest 0.9-40 and MASS 7.3-65 (installed November 23, 2026; `prepare-data.R`'s spdep reference reproduces with them to 4e-16). [METHODS.md](METHODS.md) lists each formula with the R function it is checked against and the tolerance.

### Region outline

Point patterns need the region's area and shape: the average nearest neighbor uses the area, Ripley's L envelopes place random points inside the outline, and density surfaces are clipped to it. [`scripts/prepare-outline.R`](scripts/prepare-outline.R) takes Mississippi from the Census Bureau's 2024 cartographic boundary file of states (`cb_2024_us_state_500k.zip`, SHA-256 `3e81cbb6cf5f60d9b01ef3e730afa14d61ce5f784252a0b33a696135e71447bc` on November 23, 2026). It simplifies the state with shared arcs and writes `public/data/ms/outline.geojson` (5,694 bytes; SHA-256 `12e94462d7443b83db3b164a211d7998ba4ed19f7f8a5f060c94505f014dc508`). In EPSG:3814 the outline covers 47,682 square miles.

```sh
Rscript scripts/prepare-outline.R
```

## 4. Verify the rebuild

Run the baseline checks after regenerating the inputs. The first command lists changed products. With the original inputs and the reference environment, the list was empty. With the fresh CDC export described above, expect only `public/data/ms/places-2025.json` and run its record comparison above.

```sh
git diff --name-only -M 4cbfc4a -- public/data tests/comparison-reference.json
npm test
npm run build
```

The data moved from `public/data/` to `public/data/ms/` after the baseline; `-M` reports those as renames, so an unchanged rebuild lists only the moves and the new `catalog.json` and `index.json`. The unit tests include agreement with R for 872 local Moran statistics under each neighbor rule and for all 870 default comparison results. They also exercise missing data, ties, constant fields, direction reversal, polygon topology, permutations and FDR. If results differ, compare raw hashes, eligibility and GEOIDs before updating the fixtures. Regenerating both a dataset and its expected results can conceal an input change. [Statistics tests](tests/stats.test.js) · [Comparison tests](tests/compare.test.js)

For browser verification, build first. The browser checks start their own server under `/rumb/`, as GitHub Pages does. They use the installed Google Chrome when present, otherwise Playwright's Chromium (`npx playwright install chromium`). Install the matching Playwright WebKit build with `npx playwright install webkit`. On a Linux test host, Playwright may also need browser system dependencies.

```sh
npm run e2e
BROWSER=webkit npm run e2e
```

The checks cover:

- **the map:** both neighbor rules (global I 0.2768 and 0.2846);
- **data:** imports, table joins, exports, SQL and mobile layout;
- **projects:** project restore, including a version 1 Field Atlas archive;
- **Compare:** linked selections, weights, exclusions, imported polygons,
  narrow-screen resizing, and restore with the PLACES request blocked;
- **the shell:** themes, the command palette, keyboard shortcuts and the
  status bar;
- **library layers:** stacking them, with the tract statistics and Compare
  unchanged, and restoring them from a project without refetching;
- **map tools:** looks, labels and popups; the new class methods; measuring,
  location and go-to; the radius, buffer and area filters against the GEOS
  fixture; pooled selections and point counts;
- **sharing and output:** share links opened in a second browser; exports
  read back in; the printed report;
- **offline:** an offline reload.

All of them check that runtime requests stay on the site's own origin. Playwright WebKit supplies engine coverage. Native Safari requires a separate device or browser check.

**Verification on November 21, 2026 (baseline `4cbfc4a`).** A separate checkout reproduced all eight tracked files under `public/data/` and the R comparison fixture byte for byte using the archived inputs. The automated Census download reproduced the same source manifest and product hashes. All eight unit tests at that commit, the production build and both browser suites passed in Chrome and Playwright WebKit. The public CDC export comparison above records the one input-hash difference observed when fetching data again.

## 5. Publish and locate implementation details

For a fork, select **Settings → Pages → Build and deployment → Source → GitHub Actions**. A push to `main` or a manual run of **Publish rumb** installs dependencies, runs unit tests, builds the site and deploys `dist/`. **Test rumb** runs the unit and browser tests on Chromium and WebKit. For a local reproduction, `npm run serve` is sufficient. [Pages workflow](.github/workflows/pages.yml) · [GitHub Pages configuration](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

| When investigating | Start here |
| --- | --- |
| Initial map, layer selection and workspace state | [Application entry](src/main.js), [MapLibre map](src/map/map.js), [region catalog](public/data/ms/catalog.json) |
| Import schemas, coordinate transforms, joins and SQL limits | [DuckDB integration](src/data/database.js), [data and SQL workspace](src/panels/workbench.js) |
| Spatial inference and neighbor rules on imported polygons | [Moran calculations](src/stats/stats.js), [worker](src/stats/worker.js), [polygon topology](src/stats/weights.js) |
| Weighted ranks, quadrant definitions and CSV fields | [Score calculation](src/stats/compare-score.js), [comparison interface](src/panels/compare.js) |
| How the code fits together | [Developer guide](DEVELOPER-GUIDE.md) |
| Repeating the 50 MB / 500 MB point-file benchmark | [Measured example and commands](README.md#measured-example), [R data generator](scripts/benchmark-db.R), [browser measurements](scripts/benchmark-browser.mjs) |

The separate benchmark uses R packages `DBI` and `duckdb` with its spatial extension available to `LOAD spatial`. Its timings depend on hardware, browser and cache state. Use the numerical and data checks above for release acceptance.
