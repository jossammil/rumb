#!/usr/bin/env Rscript
# The region's outline, for point-pattern statistics: the study area's size
# (average nearest neighbor), where random points may fall (Ripley's L
# envelopes) and where a density surface is drawn. From the Census Bureau's
# 2024 cartographic boundary file of states (1:500,000), simplified with
# shared arcs. Writes public/data/ms/outline.geojson and prints its
# checksums. Run at the repository root:
#   Rscript scripts/prepare-outline.R [download-cache-folder]
# R packages: sf, rmapshaper, digest.
suppressPackageStartupMessages(library(sf))
args <- commandArgs(trailingOnly = TRUE)
cache <- if (length(args)) args[[1]] else tempdir()
url <- "https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_state_500k.zip"
zip <- file.path(cache, basename(url))
if (!file.exists(zip)) download.file(url, zip, mode = "wb", quiet = TRUE)
states <- st_read(paste0("/vsizip/", zip), quiet = TRUE)
ms <- states[states$STATEFP == "28", "NAME"]
stopifnot(nrow(ms) == 1)
ms <- st_transform(ms, "OGC:CRS84")
outline <- rmapshaper::ms_simplify(ms, keep = 0.08, keep_shapes = TRUE)
out <- "public/data/ms/outline.geojson"
st_write(outline, out, driver = "GeoJSON", delete_dsn = TRUE, quiet = TRUE,
         layer_options = c("RFC7946=YES", "COORDINATE_PRECISION=5"))
area <- as.numeric(st_area(st_transform(st_read(out, quiet = TRUE), 3814)))
message("source sha256 ", digest::digest(zip, algo = "sha256", file = TRUE))
message("outline sha256 ", digest::digest(out, algo = "sha256", file = TRUE), ", ", file.size(out), " bytes, ",
        round(area / 1609.344^2), " sq mi in EPSG:3814")
