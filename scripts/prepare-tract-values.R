#!/usr/bin/env Rscript
# The attribute values behind a tract tile layer: every field of the given
# states' tracts, one row per tract, read from the files the state builds
# wrote (the display GeoJSON's ACS S1701 fields and the Parquet tables), so the
# numbers are the states' own. Writes <out>/tracts-values.parquet (GEOID, the
# state's FIPS code, then one double column per field) with one row group per
# state, in state order, so the app can read one state's rows; and
# <out>/tracts-values.json, which lists the row groups and describes each
# field. Run at the repository root by scripts/build-tiles.mjs:
#   Rscript scripts/prepare-tract-values.R --out DIR STATE_DIR [STATE_DIR...]
# R packages: jsonlite, arrow, digest.
args <- commandArgs(trailingOnly = TRUE)
at <- match("--out", args)
stopifnot(!is.na(at), at < length(args))
out <- args[[at + 1]]
dirs <- args[-c(at, at + 1)]
stopifnot(length(dirs) > 0)
dir.create(out, recursive = TRUE, showWarnings = FALSE)

catalog_of <- function(dir) jsonlite::read_json(file.path(dir, "catalog.json"))
# The display fields every state's tracts carry (Mississippi's catalog lists them).
template <- catalog_of("public/data/ms")$layers[[1]]
display_fields <- names(template$fields)

states <- lapply(dirs, function(dir) {
  catalog <- catalog_of(dir)
  ref <- catalog$layers[[1]]
  stopifnot(identical(ref$id, "tracts"))
  display <- jsonlite::read_json(file.path(dir, ref$files$display))
  props <- lapply(display$features, function(f) f$properties)
  ids <- vapply(props, function(p) p$GEOID, character(1))
  number <- function(x) if (is.null(x)) NA_real_ else as.numeric(x)
  columns <- list(GEOID = ids, name = vapply(props, function(p) p$name, character(1)),
                  county = vapply(props, function(p) p$county, character(1)))
  for (f in display_fields) columns[[f]] <- vapply(props, function(p) number(p[[f]]), numeric(1))
  index <- jsonlite::read_json(file.path(dir, ref$tables))
  fields <- template$fields
  measures <- unlist(ref$measures)
  for (t in index$tables) {
    table <- as.data.frame(arrow::read_parquet(file.path(dir, t$parquet)))
    stopifnot(identical(table$GEOID, ids))
    for (name in setdiff(names(table), "GEOID")) columns[[name]] <- table[[name]]
    fields <- c(fields, t$fields)
    measures <- c(measures, unlist(t$measures))
  }
  fips <- substr(ids[1], 1, 2)
  stopifnot(all(substr(ids, 1, 2) == fips))
  list(id = catalog$region$id, name = catalog$region$name, fips = fips,
       columns = columns, fields = fields, measures = measures)
})
states <- states[order(vapply(states, function(s) s$fips, ""))]

# Every state has the S1701 and ACS fields; PLACES lacks some measures in a few
# states (Kentucky, Pennsylvania), whose rows are then missing.
numeric_names <- unique(unlist(lapply(states, function(s) setdiff(names(s$columns), c("GEOID", "name", "county")))))
# The text fields that name and group a tract (labelField, placeField).
fields <- list(name = list(label = "Tract", format = "text"), county = list(label = "County", format = "text"))
for (s in states) for (n in names(s$fields)) if (is.null(fields[[n]])) fields[[n]] <- s$fields[[n]]
measures <- unique(unlist(lapply(states, function(s) s$measures)))
stopifnot(all(measures %in% numeric_names), all(numeric_names %in% names(fields)))

path <- file.path(out, "tracts-values.parquet")
frame <- function(s) {
  n <- length(s$columns$GEOID)
  df <- data.frame(GEOID = s$columns$GEOID, state = rep(s$fips, n), name = s$columns$name,
                   county = s$columns$county, stringsAsFactors = FALSE)
  for (name in numeric_names) df[[name]] <- if (is.null(s$columns[[name]])) rep(NA_real_, n) else as.numeric(s$columns[[name]])
  df
}
# One row group per state: each WriteTable call with chunk_size at least the
# state's rows writes one group.
first <- arrow::Table$create(frame(states[[1]]))
sink <- arrow::FileOutputStream$create(path)
writer <- arrow::ParquetFileWriter$create(first$schema, sink,
  properties = arrow::ParquetWriterProperties$create(names(first), compression = "snappy"))
groups <- list()
for (k in seq_along(states)) {
  table <- if (k == 1) first else arrow::Table$create(frame(states[[k]]), schema = first$schema)
  writer$WriteTable(table, chunk_size = max(1L, table$num_rows))
  groups[[k]] <- list(state = states[[k]]$fips, id = states[[k]]$id, name = states[[k]]$name,
                      rows = table$num_rows)
}
writer$Close()
sink$close()
check <- arrow::ParquetFileReader$create(path)
stopifnot(check$num_row_groups == length(states))

meta <- list(
  version = 1,
  file = basename(path),
  rows = sum(vapply(groups, function(g) g$rows, numeric(1))),
  rowGroups = groups,
  labelField = "name",
  placeField = "county",
  measures = I(measures),
  fields = fields,
  sha256 = digest::digest(path, algo = "sha256", file = TRUE),
  bytes = file.size(path),
  packages = list(arrow = as.character(packageVersion("arrow")))
)
jsonlite::write_json(meta, file.path(out, "tracts-values.json"), auto_unbox = TRUE, digits = NA, null = "null", pretty = TRUE)
message(sprintf("Wrote %d tracts of %d states, %d fields, %.1f MB, to %s",
                meta$rows, length(states), length(numeric_names), file.size(path) / 1048576, path))
