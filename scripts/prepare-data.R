#!/usr/bin/env Rscript
# Run at the repository root. Optional inputs, in order: TIGER ZIP and S1701 ZIP
# downloaded for all Mississippi census tracts from data.census.gov.
# R packages: sf, spdep, arrow, jsonlite, digest, rmapshaper; httr2 for downloads.
suppressPackageStartupMessages(library(sf))
args <- commandArgs(trailingOnly = TRUE)
stopifnot(length(args) %in% c(0L, 2L))
stage <- tempfile("rumb-prepare-")
dir.create(stage)
output <- "public/data"
dir.create(output, recursive = TRUE, showWarnings = FALSE)

tiger_url <- "https://www2.census.gov/geo/tiger/TIGER2024/TRACT/tl_2024_28_tract.zip"
table_url <- "https://data.census.gov/table/ACSST5Y2024.S1701?g=040XX00US28$1400000"
id_filter <- "040XX00US28$1400000"
get_subject_archive <- function(dest) {
  endpoint <- "https://data.census.gov/api/access/table/download"
  response <- httr2::request(endpoint) |>
    httr2::req_body_json(list(request = list(
      id = "ACSST5Y2024.S1701", g = id_filter, download_estimate = FALSE
    ))) |>
    httr2::req_perform() |>
    httr2::resp_body_json()
  job <- response$response$download_id
  stopifnot(is.character(job), length(job) == 1)
  status_url <- paste0(endpoint, "?status&download_id=", job)
  for (attempt in seq_len(60)) {
    status <- httr2::request(status_url) |> httr2::req_perform() |> httr2::resp_body_json()
    if (identical(status$response$status, "complete")) {
      download.file(status$response$url, dest, mode = "wb")
      return(invisible(dest))
    }
    Sys.sleep(2)
  }
  stop("Census table export did not finish. Download the S1701 ZIP from ", table_url)
}
if (length(args)) {
  tiger_zip <- normalizePath(args[[1]], mustWork = TRUE)
  subject_zip <- normalizePath(args[[2]], mustWork = TRUE)
} else {
  tiger_zip <- file.path(stage, "tiger.zip")
  subject_zip <- file.path(stage, "s1701.zip")
  download.file(tiger_url, tiger_zip, mode = "wb")
  get_subject_archive(subject_zip)
}

csv_name <- "ACSST5Y2024.S1701-Data.csv"
unzip(subject_zip, files = csv_name, exdir = stage)
acs_csv <- file.path(stage, csv_name)
acs <- read.csv(acs_csv, colClasses = "character", fileEncoding = "UTF-8-BOM")
# The download contains a second heading row describing each variable.
stopifnot(acs$GEO_ID[1] == "Geography")
acs <- acs[-1, ]
stopifnot(all(grepl("^1400000US28[0-9]{9}$", acs$GEO_ID)))
acs$GEOID <- sub("^1400000US", "", acs$GEO_ID)
shapes <- st_read(paste0("/vsizip/", tiger_zip), quiet = TRUE)
stopifnot(!anyDuplicated(acs$GEOID), !anyDuplicated(shapes$GEOID),
          setequal(acs$GEOID, shapes$GEOID))
shapes <- shapes[order(shapes$GEOID), ]
acs <- acs[match(shapes$GEOID, acs$GEOID), ]
acs_num <- function(field) {
  vals <- acs[[field]]
  vals[vals %in% c("", "-", "**", "***", "*****", "(X)", "N")] <- NA_character_
  out <- as.numeric(vals)
  stopifnot(all(is.na(out) == is.na(vals)), all(out >= 0, na.rm = TRUE))
  out
}
measures <- data.frame(
  GEOID = shapes$GEOID,
  name = shapes$NAMELSAD,
  county = sub("^.*; (.*); Mississippi$", "\\1", acs$NAME),
  poverty_pct = acs_num("S1701_C03_001E"),
  poverty_moe = acs_num("S1701_C03_001M"),
  poverty_count = acs_num("S1701_C02_001E"),
  poverty_universe = acs_num("S1701_C01_001E"),
  child_poverty_pct = acs_num("S1701_C03_002E"),
  child_poverty_moe = acs_num("S1701_C03_002M"),
  child_poverty_count = acs_num("S1701_C02_002E"),
  child_poverty_universe = acs_num("S1701_C01_002E")
)
check_measure <- function(rate, count, universe) {
  stopifnot(all(count <= universe), all(is.na(rate) == (universe == 0)))
  eligible <- universe > 0
  stopifnot(all(abs(rate[eligible] - 100 * count[eligible] / universe[eligible]) < 0.051))
}
with(measures, check_measure(poverty_pct, poverty_count, poverty_universe))
with(measures, check_measure(child_poverty_pct, child_poverty_count, child_poverty_universe))
stopifnot(length(unique(measures$county)) == 82L)

# Native, unsimplified shared TIGER coordinates, with planar GEOS predicates.
# Keeping coordinates unchanged preserves exact vertex/edge coincidence.
g <- st_set_crs(st_geometry(shapes), NA)
stopifnot(all(st_is_valid(g)), all(!st_is_empty(g)))
graphs <- list(queen = st_touches(g), rook = st_relate(g, pattern = "F***1****"))
ids <- measures$GEOID
for (i in seq_along(ids)) {
  stopifnot(all(graphs$rook[[i]] %in% graphs$queen[[i]]))
  for (graph in graphs) {
    stopifnot(!i %in% graph[[i]], all(vapply(graph[[i]], function(j) i %in% graph[[j]], logical(1))))
  }
}
by_id <- function(graph) setNames(lapply(graph, function(indices) I(ids[indices])), ids)
write_json <- function(x, filename) {
  jsonlite::write_json(x, file.path(stage, filename), auto_unbox = TRUE, null = "null",
                       na = "null", digits = 15)
}
write_json(lapply(graphs, by_id), "neighbors.json")

# The display asset and analytical source share stable IDs. Only display is simplified.
full <- st_sf(measures, geometry = st_transform(st_geometry(shapes), "OGC:CRS84"))
display <- rmapshaper::ms_simplify(full, keep = 0.02, keep_shapes = TRUE, snap = FALSE)
stopifnot(identical(display$GEOID, ids), all(!st_is_empty(display)))
display$feature_id <- display$GEOID
st_write(display, file.path(stage, "tracts.geojson"), driver = "GeoJSON", quiet = TRUE,
         layer_options = c("ID_FIELD=feature_id", "ID_TYPE=String",
                           "RFC7946=YES", "COORDINATE_PRECISION=5"))

# GeoParquet 1.1 uses OGC:CRS84 when the metadata omits crs. Physical storage is WKB.
wkb <- st_as_binary(st_geometry(full), EWKB = FALSE)
geometry_column <- arrow::as_arrow_array(unclass(wkb), type = arrow::binary())
table <- arrow::Table$create(measures, geometry = geometry_column)
geo <- list(version = "1.1.0", primary_column = "geometry", columns = list(geometry = list(
  encoding = "WKB", geometry_types = I("MultiPolygon"), bbox = unname(as.numeric(st_bbox(full)))
)))
table <- table$ReplaceSchemaMetadata(list(geo = jsonlite::toJSON(geo, auto_unbox = TRUE, digits = 15)))
arrow::write_parquet(table, file.path(stage, "tracts.parquet"), compression = "zstd", chunk_size = 64)

reference <- function(graph) {
  valid <- which(is.finite(measures$poverty_pct))
  connected <- valid[vapply(graph[valid], function(nb) any(nb %in% valid), logical(1))]
  mat <- matrix(0, length(connected), length(connected))
  for (row in seq_along(connected)) {
    neighbors <- match(graph[[connected[row]]], connected, nomatch = 0L)
    mat[row, neighbors] <- 1
  }
  weights <- spdep::mat2listw(mat, row.names = ids[connected], style = "W", zero.policy = FALSE)
  x <- measures$poverty_pct[connected]
  global <- spdep::moran(x, weights, length(x), spdep::Szero(weights))$I
  local <- spdep::localmoran(x, weights, mlvar = FALSE)[, "Ii"]
  list(n = length(x), globalI = unname(global), localI = setNames(as.list(unname(local)), ids[connected]))
}
write_json(lapply(graphs, reference), "reference.json")
sha256 <- function(path) digest::digest(path, algo = "sha256", file = TRUE)
products <- c("neighbors.json", "tracts.geojson", "tracts.parquet", "reference.json")
source_info <- list(
  version = "ms-tracts-acs2024-v1", period = "2020–2024", state = "Mississippi",
  tract_count = length(ids), valid_poverty_rates = sum(is.finite(measures$poverty_pct)),
  valid_child_poverty_rates = sum(is.finite(measures$child_poverty_pct)),
  geography = list(title = "2024 TIGER/Line Mississippi census tracts", url = tiger_url,
                   archive_sha256 = sha256(tiger_zip)),
  measures = list(title = "2020–2024 ACS five-year subject table S1701", url = table_url,
    variables = "https://api.census.gov/data/2024/acs/acs5/subject/groups/S1701.html",
    csv_sha256 = sha256(acs_csv), confidence_level = 0.90,
    all_ages = list(rate = "S1701_C03_001E", moe = "S1701_C03_001M",
                    below = "S1701_C02_001E", universe = "S1701_C01_001E"),
    under_18 = list(rate = "S1701_C03_002E", moe = "S1701_C03_002M",
                    below = "S1701_C02_002E", universe = "S1701_C01_002E")),
  methods = list(weights = "Undirected, first-order, within Mississippi; queen shares at least one boundary point, rook a boundary segment, evaluated with GEOS on original TIGER vertices.",
    display = "Mapshaper shared-arc simplification at 2% retained removable vertices, preserving small features; coordinates rounded to 5 decimal places.",
    statistics = "Reference for poverty_pct: exclude missing estimates and islands, row-standardize weights, spdep::moran and spdep::localmoran(mlvar=FALSE)."),
  packages = lapply(setNames(c("sf", "spdep", "arrow", "rmapshaper"), c("sf", "spdep", "arrow", "rmapshaper")),
                    function(p) as.character(packageVersion(p))),
  assets = setNames(lapply(products, function(p) list(bytes = file.size(file.path(stage, p)),
                                      sha256 = sha256(file.path(stage, p)))), products)
)
write_json(source_info, "sources.json")
stopifnot(all(file.copy(file.path(stage, c(products, "sources.json")), output, overwrite = TRUE)))
message("Wrote ", length(ids), " Mississippi census tracts to ", output)
