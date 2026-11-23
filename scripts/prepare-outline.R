#!/usr/bin/env Rscript
# The region's outline, for point-pattern statistics: the study area's size
# (average nearest neighbor), where random points may fall (Ripley's L
# envelopes) and where a density surface is drawn. From the Census Bureau's
# 2024 cartographic boundary file of states (1:500,000), simplified with
# shared arcs. Writes <out>/outline.geojson and prints its checksums. Run at
# the repository root:
#   Rscript scripts/prepare-outline.R [--state MS] [--out DIR] [--cache DIR] [--pin]
# (options in scripts/lib/region.R). R packages: sf, rmapshaper, digest.
suppressPackageStartupMessages(library(sf))
source("scripts/lib/region.R")
ctx <- region_context()
url <- "https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_state_500k.zip"
zip <- cached(ctx, url, national = TRUE)
pin(ctx, "cb_states", url, zip, national = TRUE)
states <- st_read(paste0("/vsizip/", zip), quiet = TRUE)
state <- states[states$STATEFP == ctx$fips, "NAME"]
stopifnot(nrow(state) == 1)
state <- region_lonlat(st_transform(state, "OGC:CRS84"), ctx)
outline <- rmapshaper::ms_simplify(state, keep = 0.08, keep_shapes = TRUE)
out <- file.path(ctx$out, "outline.geojson")
st_write(outline, out, driver = "GeoJSON", delete_dsn = TRUE, quiet = TRUE,
         layer_options = c(rfc7946(ctx), "COORDINATE_PRECISION=5"))
crs <- metric_crs(ctx)
area <- as.numeric(st_area(st_transform(st_read(out, quiet = TRUE), crs)))
message("source sha256 ", digest::digest(zip, algo = "sha256", file = TRUE))
message("outline sha256 ", digest::digest(out, algo = "sha256", file = TRUE), ", ", file.size(out), " bytes, ",
        round(area / 1609.344^2), " sq mi in ", if (is.numeric(crs)) paste0("EPSG:", crs) else crs)
