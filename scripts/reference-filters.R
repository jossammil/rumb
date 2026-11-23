#!/usr/bin/env Rscript
# Independent filter results for tests/filter.test.js, computed by GEOS through
# sf on the same display files the app filters, in EPSG:3814 metres (map_pdo's
# method): radius, buffer and polygon filters on points and polygons.
# Run at the repository root: Rscript scripts/reference-filters.R
suppressPackageStartupMessages(library(sf))
sf_use_s2(FALSE)
read <- function(path) {
  x <- st_read(path, quiet = TRUE)
  st_crs(x) <- 4269 # the display files are NAD83-based longitude/latitude
  st_transform(x, 3814)
}
mile <- 1609.344
stations <- read("public/data/ms/layers/fire_stations_2020.geojson")
tracts <- read("public/data/ms/tracts.geojson")
counties <- read("public/data/ms/layers/chr_counties_2025.geojson")
jackson <- st_transform(st_sfc(st_point(c(-90.18, 32.3)), crs = 4269), 3814)
ids <- function(x, hits) sort(as.character(x$id[lengths(hits) > 0]))
ring <- rbind(c(-90.6, 32.1), c(-89.9, 32.0), c(-89.7, 32.5), c(-90.2, 32.8), c(-90.7, 32.5), c(-90.6, 32.1))
area <- st_transform(st_sfc(st_polygon(list(ring)), crs = 4269), 3814)
hinds <- counties[counties$id == "28049", ]
out <- list(
  center = c(-90.18, 32.3), ring = ring[-nrow(ring), ],
  stations25 = ids(stations, st_is_within_distance(stations, jackson, 25 * mile)),
  stations50 = ids(stations, st_is_within_distance(stations, jackson, 50 * mile)),
  tracts10 = ids(tracts, st_is_within_distance(tracts, jackson, 10 * mile)),
  countiesInArea = ids(counties, st_intersects(counties, area)),
  stationsInArea = ids(stations, st_intersects(stations, area)),
  stationsNearHinds = ids(stations, st_is_within_distance(stations, hinds, 5 * mile))
)
jsonlite::write_json(out, "tests/filter-reference.json", auto_unbox = TRUE, digits = NA)
message(sprintf("stations 25 mi %d, 50 mi %d; tracts 10 mi %d; counties in area %d; stations in area %d; near Hinds %d",
                length(out$stations25), length(out$stations50), length(out$tracts10), length(out$countiesInArea),
                length(out$stationsInArea), length(out$stationsNearHinds)))
