#!/usr/bin/env Rscript
# Independent point counts and pooled measures for tests/pool.test.js:
# fire stations within each tract and each county (GEOS st_within on the
# display files), and pooled County Health Rankings measures for Hinds County,
# its neighbors and both together (map_project's measure_aggregate rules).
# Run at the repository root: Rscript scripts/reference-counts.R
suppressPackageStartupMessages(library(sf))
sf_use_s2(FALSE)
read <- function(path) {
  x <- st_read(path, quiet = TRUE)
  st_crs(x) <- 4269
  st_transform(x, 3814)
}
stations <- read("public/data/ms/layers/fire_stations_2020.geojson")
tracts <- read("public/data/ms/tracts.geojson")
counties <- read("public/data/ms/layers/chr_counties_2025.geojson")
counts <- function(areas) setNames(as.list(lengths(st_contains(areas, stations, sparse = TRUE))), areas$id)
library_json <- jsonlite::read_json("public/data/ms/layers/library.json")
chr <- Filter(function(l) l$id == "chr_counties_2025", library_json$layers)[[1]]
graph <- jsonlite::read_json(paste0("public/data/ms/", chr$neighbors))$queen
selected <- "28049"
neighbors <- setdiff(unlist(graph[[selected]]), selected)
df <- st_drop_geometry(counties)
aggregate <- function(rows, pool) {
  num <- as.numeric(rows[[pool$numerator]])
  den <- if (identical(pool$kind, "ratio")) as.numeric(rows[[pool$denominator]])
  flag <- if (!is.null(pool$flag)) as.numeric(rows[[pool$flag]])
  suppressed <- if (!is.null(flag)) !is.na(flag) & flag == 2 else rep(FALSE, nrow(rows))
  use <- !suppressed & !is.na(num)
  if (!is.null(den)) use <- use & !is.na(den) & den > 0
  value <- if (!any(use)) NA else if (is.null(den)) sum(num[use]) else sum(num[use]) / sum(den[use]) * pool$scale
  list(value = value, used = sum(use), total = nrow(rows), suppressed = sum(suppressed))
}
measures <- c("v085_rawvalue", "v037_rawvalue", "v138_rawvalue", "v024_rawvalue", "v004_rawvalue")
pooled <- lapply(setNames(measures, measures), function(m) {
  pool <- chr$fields[[m]]$pool
  pick <- function(ids) aggregate(df[df$id %in% ids, ], pool)
  list(selected = pick(selected), neighbors = pick(neighbors), total = pick(c(selected, neighbors)))
})
out <- list(tracts = counts(tracts), counties = counts(counties), selected = selected,
            neighbors = I(sort(neighbors)), pooled = pooled)
jsonlite::write_json(out, "tests/counts-reference.json", auto_unbox = TRUE, digits = NA, na = "null")
message("Fire stations counted in ", sum(unlist(out$tracts)), " tract and ", sum(unlist(out$counties)), " county placements")
