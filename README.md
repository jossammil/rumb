# Field Atlas

A static browser GIS for tract-level mapping, spatial queries and exploratory cluster analysis. Open [Field Atlas on GitHub Pages](https://jossammil.github.io/bgis/). The starter project covers all 878 Mississippi census tracts. Local imports are read on the visitor’s device.

## Use the workspace

- Choose the all-ages or child poverty measure. Set the color palette, classification and number of classes. Click a tract or use the map search to inspect its estimate, ACS 90% margin of error and denominator.
- Select **Find clusters** to link the map, Moran scatterplot and tract inspector. The statewide study area stays fixed as you pan. Choose a county or the current map extent to analyze an explicit subset. The extent is captured when the test runs.
- Open **Compare** to rank polygon areas on two or three numeric indicators. The Mississippi example starts with equal weights for poverty and adult transportation barriers. Switch the map between weighted scores and raw-value quadrants. Select areas on the map, plot or table to inspect their contributions and uncertainty. CSV includes every area, applied weights, component percentiles, selected IDs and exclusion reasons. A saved project retains each layer’s comparison and the public reference snapshot used by the starter comparison.
- Use **Add data** for CSV, Parquet, GeoJSON or GeoParquet. Inspect the table and check its join to the 11-character tract GEOID. Match counts and duplicate keys are displayed before applying a join. The spatial SQL editor can preview a result, map it or export it to CSV. Each query layer retains its SQL. The guided point-count query uses tract interiors and excludes points lying on a shared boundary.
- Use the map camera button for a PNG with its legend. **Export statistics** downloads a CSV with per-feature outcomes and test settings. **Save project** packages imported files, reference geography, weights, layer styles, SQL, analysis results and the camera in a portable ZIP-based `.bgis` project. Reopen it from **Open project**. The project archive contains the underlying source files, including any local data you added.

## Data and methods

The 2020–2024 ACS five-year S1701 estimates use the population for whom poverty status is determined. Zero-denominator tracts have unavailable rates. The regional display uses simplified boundaries. The canonical GeoParquet and the rook and queen graphs use full-resolution 2024 TIGER/Line tract polygons. Reference geography and analysis weights stop at the Mississippi state boundary. The [Census source manifest](public/data/sources.json) records the variables, original sources, preparation versions and checksums. The backdrop uses public-domain [Natural Earth](https://www.naturalearthdata.com/) geography.

Clustering uses first-order, row-standardized adjacency. Each run excludes missing measurements, zero denominators and areas with no eligible neighbors. The scatterplot locates each eligible area by its standardized measure and the mean of its neighbors’ standardized measures. Observed local Moran statistics use GeoDaLib and sample variance. Global inference shuffles labels. Local inference holds the focal value fixed and samples neighbor values without replacement. The two-sided permutation tests count ties around the appropriate null expectation and use the plus-one correction. The default is 999 permutations with seed 12345, alpha 0.05. Optional Benjamini–Hochberg adjustment applies across tested local areas. The ACS margin of error describes survey sampling uncertainty. The permutation test conditions on the published estimates.

The comparison uses complete cases across all enabled indicators. Each percentile equals the number of lower values divided by the eligible count minus one. Constant fields receive 0.5. A lower-values direction uses one minus the percentile. Positive weights sum to 100. Scores are rounded to one decimal before competition ranking. Raw values at their median fall in the high half of their axis. Eight Mississippi tracts lack a complete default pair and remain visible as unranked. Tract PLACES estimates represent adults and carry 95% confidence intervals. These descriptive rankings use point estimates. [CDC PLACES 2025 tract data](https://data.cdc.gov/d/yjkw-uj5s) · [CDC methodology](https://www.cdc.gov/places/methodology/index.html)

## Run and verify

Use Node.js 24 or later. Run `npm ci`, `npm run vendor`, and `npm run dev`. For the production bundle use `npm run build` followed by `npm run preview`. The vendor step fetches and checksum-verifies matching signed DuckDB extensions. Runtime assets are served from the same origin. GitHub Actions builds and publishes the static bundle on pushes to main.

`npm test` compares the browser implementation with independent R results for all 872 eligible all-ages estimates under both neighbor definitions. It also covers missing values, isolated areas, ties, conditional permutations, FDR and polygon topology. Run `node scripts/check-browser.mjs <preview-url>` for the Chrome end-to-end test or set `BGIS_WEBKIT=1` for Playwright WebKit. For WebKit, install the matching browser with `npx playwright install webkit`.

The comparison tests check 870 scores, ranks and quadrants against an independent R fixture. Rebuild the fixture with `Rscript scripts/reference-comparison.R`. Run `node scripts/check-compare.mjs <preview-url>` for browser coverage of linked selections, polygon imports, CSV, mobile resizing and project compatibility. It also accepts `BGIS_WEBKIT=1`. To rebuild the comparison reference from the national CDC 2025 GIS-friendly tract CSV, use `python3 scripts/prepare-places.py <csv-path>`.

To regenerate the Census assets, run `Rscript scripts/prepare-data.R` with the packages listed in that script. To regenerate the basemap run `Rscript scripts/prepare-basemap.R`. The committed data are sufficient to build and run the app.

## Working with large files

DuckDB runs in a worker and reads selected local files through browser file handles. Map a filtered query or aggregation for large inputs. The SQL table preview shows 100 rows. Map queries accept up to 10,000 features and 32 MiB of serialized custom geometry. The interface requires a smaller result if either limit is reached. Save and open operations need enough browser storage or memory for the project size.

### Measured example

A local production build in headless Chrome on an Apple M2 Max with 64 GB RAM produced these results using synthetic point GeoParquet. Times are one run. File reads count bytes requested from the local point file and exclude reads from the reference tract file.

| Input | Rows | Register | Sum by category, all rows | Spatial join, first 50,000 points |
| --- | ---: | ---: | ---: | ---: |
| 49.99 MB | 924,548 | 0.03 s | 0.18 s, 1.26 MB read | 0.85 s, 1.17 MB read |
| 499.96 MB | 9,245,477 | 0.15 s | 1.63 s, 12.57 MB read | 0.90 s, 1.17 MB read |

The spatial query returned one result per tract and counted 39,670 points inside tracts in both files. The main thread continued to receive animation frames during both queries, with a longest observed interval of 17 ms. The first painted tract map took 2.71 s in the first browser context and 0.75 s in a subsequent fresh context using the same Chrome process. Network speed, storage, geometry complexity and query shape affect these timings.

To repeat, run `Rscript scripts/benchmark-db.R <temporary-directory>`, start the production preview, then run `node scripts/benchmark-browser.mjs <temporary-directory> <preview-url>`.
