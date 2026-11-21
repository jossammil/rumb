# Reproducing Field Atlas

Use the committed data to run Field Atlas or repeat an analysis. Rebuild the data from the original sources when auditing a release or updating its inputs. Both paths use the same browser application. GitHub Pages serves static files, MapLibre draws the map, and DuckDB-Wasm runs queries on the visitor’s device.

The baseline below is the first release with **Compare areas**, commit `4cbfc4a9bdfff33b6f831f5ded8b74edbaf2ae44`. Keep the commit ID alongside any exported analysis. The [README](README.md) describes the workspace controls and performance measurements.

## 1. Run the baseline

Use a terminal with Git, Node.js and npm. CI uses Node 24. The clean-checkout verification also passed with Node 26.12.0 and npm 11.20.0. Run these commands in a fresh directory. The detached checkout fixes the application, data and dependency lockfile to the baseline.

```sh
git clone https://github.com/jossammil/bgis.git
cd bgis
git switch --detach 4cbfc4a9bdfff33b6f831f5ded8b74edbaf2ae44
npm ci
npm test
npm run build
npm run preview -- --port 4180 --strictPort
```

Open `http://127.0.0.1:4180/` and leave the preview running while testing. Run subsequent commands from the repository root in a second terminal. To edit the application with live reload, use `npm run vendor` followed by `npm run dev` and open the address Vite prints.

The first install and build need network access for npm packages and three DuckDB extensions. The build copies the worker and Wasm runtime from the locked npm package, checks the extension files against their SHA-256 pins, and puts the complete site in `dist/`. A valid extension cache under `public/vendor/duckdb/` is reused on later builds. Serve the whole directory over HTTP. R, Python, database credentials and an external GIS service are unnecessary for this path. [Vendor script](scripts/vendor-db.mjs) · [Dependency lockfile](package-lock.json)

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
3. Choose **Save project**. Keep the resulting `.bgis` file, CSV and application commit ID together. For a statewide baseline check, open the archive in a fresh tab, confirm the settings and compare the exported rows by tract ID.

A version 1 `.bgis` is a ZIP. `project.json` holds the manifest and workspace state, including layer SQL and applied settings. `imports/` contains the original user-supplied files. `base/` contains the tract display, full GeoParquet, neighbor graph and Census manifest, plus the PLACES snapshot when the built-in tract comparison has been used. Reopening reconstructs the imported tables. Share the archive only with recipients who can receive its underlying data. For disconnected use, serve a previously built `dist/` locally and open the archive there. [Archive implementation](src/project.js)

## 3. Rebuild the data from public sources

Use a separate checkout at the baseline for these steps. Preparation scripts write into `public/data/` and `tests/`. Put raw downloads in a directory outside the checkout and retain them if exact byte reproduction matters.

```sh
input_dir="$(mktemp -d)"
```

Use Python 3 (standard library only) and R. To install the required R packages at their currently available versions, run the command below. For exact baseline reproduction, use the versions in the table.

```sh
Rscript -e 'install.packages(c("sf", "spdep", "arrow", "rmapshaper", "jsonlite", "digest", "httr2"), repos="https://cloud.r-project.org")'
```

A source installation of `sf` needs GDAL, GEOS and PROJ. The repository locks JavaScript dependencies. R and native library versions are recorded here as a reference environment.

| Component | Versions used to verify the baseline |
| --- | --- |
| R and geospatial libraries | R 4.5.0, GDAL 3.8.5, GEOS 3.13.0, PROJ 9.5.1 |
| R data and geometry packages | sf 1.0-21, spdep 1.4-2, arrow 22.0.0.1, rmapshaper 0.6.1 |
| Other R packages | jsonlite 2.0.0, digest 0.6.37, httr2 1.2.1 |

### Census geography, poverty and spatial weights

```sh
Rscript scripts/prepare-data.R
```

The script downloads the 2024 Mississippi TIGER/Line tract ZIP and the 2020–2024 ACS S1701 table for all Mississippi tracts. If using saved downloads, pass the two ZIPs in this order. The table ZIP must contain `ACSST5Y2024.S1701-Data.csv`.

```sh
Rscript scripts/prepare-data.R "$input_dir/tl_2024_28_tract.zip" "$input_dir/S1701.zip"
```

The script joins one ACS record per TIGER GEOID, checks counts against denominators, and constructs queen and rook neighbors from unsimplified shared boundaries. Zero-denominator rates remain missing. It writes the following files. The [Census manifest](public/data/sources.json) gives the download URLs, exact variable IDs, TIGER ZIP hash, extracted ACS CSV hash and product hashes.

| Output under `public/data/` | Use |
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

`public/data/places-2025.json` records the source metadata, national CSV hash, definitions and 870 GEOID-keyed records. `tests/comparison-reference.json` contains independently calculated R scores, ranks and quadrants for the default pair. The extraction checks are specific to this release and geography. A future release needs its own coverage review.

The archived national CSV used for the baseline has SHA-256 `201b7eb5e6df3053115712debd436e76cda1d51058612420a1636249b808709c`. A fresh public export on November 21, 2026 had SHA-256 `d6db01cef81316fb32b9ef97228db1921c2914398c69803b72951c2b9a906481`. All Mississippi estimates, intervals, population counts and definitions matched. Only the recorded national-file hash differed. To check a new export, compare the entire derived JSON with just that one provenance field removed from the comparison. Keep the actual hash in the file.

```sh
python3 - <<'PY'
import json, pathlib, subprocess
path = "public/data/places-2025.json"
baseline = json.loads(subprocess.check_output(["git", "show", "4cbfc4a:" + path]))
rebuilt = json.loads(pathlib.Path(path).read_text())
for obj in (baseline, rebuilt):
    print("National CSV SHA-256", obj["source"].pop("sha256"))
assert baseline == rebuilt, "Derived records or metadata changed"
print("All Mississippi records and other metadata match.")
PY
```

### Natural Earth basemap

The basemap script can download upstream files directly. For the baseline, use the fixed Natural Earth revision below. All six input files at this revision were checked against the inputs that reproduce the committed backdrop. Set `BGIS_NE_CACHE` to the directory containing those files, with the filenames shown.

```sh
export BGIS_NE_CACHE="$input_dir/natural-earth"
mkdir -p "$BGIS_NE_CACHE"
ne_revision=ca96624a56bd078437bca8184e78163e5039ad19
for layer in ne_50m_land ne_50m_lakes ne_50m_admin_1_states_provinces_lines \
             ne_10m_rivers_lake_centerlines ne_10m_populated_places_simple ne_110m_land
do
  curl --fail --location \
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/$ne_revision/geojson/$layer.geojson" \
    --output "$BGIS_NE_CACHE/bgis-$layer.geojson" || exit 1
done
Rscript scripts/prepare-basemap.R
```

`context.geojson` contains the regional backdrop clipped to 98°W–82°W and 26°N–39°N. `world-land.geojson` supplies a global outline when the map leaves that region. These are display assets. The tract neighbor graph comes from TIGER geography.

## 4. Verify the rebuild

Run the baseline checks after regenerating the inputs. The first command lists changed products. With the original inputs and the reference environment, the list was empty. With the fresh CDC export described above, expect only `public/data/places-2025.json` and run its record comparison above.

```sh
git diff --name-only 4cbfc4a -- public/data tests/comparison-reference.json
npm test
npm run build
```

The eight tests include agreement with R for 872 local Moran statistics under each neighbor rule and for all 870 default comparison results. They also exercise missing data, ties, constant fields, direction reversal, polygon topology, permutations and FDR. If results differ, compare raw hashes, eligibility and GEOIDs before updating the fixtures. Regenerating both a dataset and its expected results can conceal an input change. [Statistics tests](tests/stats.test.js) · [Comparison tests](tests/compare.test.js)

For browser verification, start the production preview as in section 1. The Chrome tests launch the installed Google Chrome channel. Install the matching Playwright WebKit build with `npx playwright install webkit`. On a Linux test host, Playwright may also need browser system dependencies. Run the following from a second terminal.

```sh
atlas_url=http://127.0.0.1:4180/
node scripts/check-browser.mjs "$atlas_url"
node scripts/check-compare.mjs "$atlas_url"
BGIS_WEBKIT=1 node scripts/check-browser.mjs "$atlas_url"
BGIS_WEBKIT=1 node scripts/check-compare.mjs "$atlas_url"
```

The first suite checks the map, both neighbor rules, imports, table joins, exports, project restore, SQL and mobile layout. The second checks linked selections, weights, exclusions, imported polygons, narrow-screen resizing, older projects and restore with the PLACES request blocked. Both check same-origin runtime requests. Playwright WebKit supplies engine coverage. Native Safari requires a separate device or browser check.

**Verification on November 21, 2026.** A separate checkout reproduced all eight tracked files under `public/data/` and the R comparison fixture byte for byte using the archived inputs. The automated Census download reproduced the same source manifest and product hashes. All eight unit tests, the production build and both browser suites passed in Chrome and Playwright WebKit. The public CDC export comparison above records the one input-hash difference observed when fetching data again.

## 5. Publish and locate implementation details

For a fork, select **Settings → Pages → Build and deployment → Source → GitHub Actions**. A push to `main` or a manual run of **Publish Field Atlas** installs dependencies, runs unit tests, builds the site and deploys `dist/`. Browser checks run separately. To verify a deployment, substitute its full Pages URL, including the repository subpath and trailing slash, for `atlas_url` above. For a local reproduction, the preview is sufficient. [Pages workflow](.github/workflows/pages.yml) · [GitHub Pages configuration](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

| When investigating | Start here |
| --- | --- |
| Initial map, layer selection and workspace state | [Application entry](src/main.js), [MapLibre map](src/map.js) |
| Import schemas, coordinate transforms, joins and SQL limits | [DuckDB integration](src/database.js), [data and SQL workspace](src/workbench.js) |
| Spatial inference and neighbor rules on imported polygons | [Moran calculations](src/stats.js), [worker](src/stats-worker.js), [polygon topology](src/stats-weights.js) |
| Weighted ranks, quadrant definitions and CSV fields | [Score calculation](src/compare-score.js), [comparison interface](src/compare.js) |
| Repeating the 50 MB / 500 MB point-file benchmark | [Measured example and commands](README.md#measured-example), [R data generator](scripts/benchmark-db.R), [browser measurements](scripts/benchmark-browser.mjs) |

The separate benchmark uses R packages `DBI` and `duckdb` with its spatial extension available to `LOAD spatial`. Its timings depend on hardware, browser and cache state. Use the numerical and data checks above for release acceptance.
