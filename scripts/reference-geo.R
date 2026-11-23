#!/usr/bin/env Rscript
# Independent projected coordinates for tests/geo.test.js: a grid of NAD83
# longitude/latitude points over Mississippi and its neighbors, projected to
# EPSG:3814 (Mississippi Transverse Mercator) by PROJ through sf.
# Run at the repository root: Rscript scripts/reference-geo.R
suppressPackageStartupMessages(library(sf))
grid <- expand.grid(lon = seq(-94, -86, by = 0.5), lat = seq(29, 36, by = 0.5))
grid <- rbind(grid, data.frame(lon = c(-90.18, -88.08, -91.66, -98), lat = c(32.3, 30.16, 35.02, 26)))
pts <- st_transform(st_as_sf(grid, coords = c("lon", "lat"), crs = 4269), 3814)
xy <- st_coordinates(pts)
out <- list(
  crs = "EPSG:4269 to EPSG:3814", proj = sf_extSoftVersion()[["PROJ"]],
  points = lapply(seq_len(nrow(grid)), function(i) c(grid$lon[i], grid$lat[i], xy[i, 1], xy[i, 2]))
)
jsonlite::write_json(out, "tests/geo-reference.json", auto_unbox = TRUE, digits = NA)
message("Wrote ", nrow(grid), " points to tests/geo-reference.json")
