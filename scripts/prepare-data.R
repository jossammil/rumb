#!/usr/bin/env Rscript
# Builds a state's reference tracts: display GeoJSON, analytical GeoParquet,
# contiguity, the Moran reference and sources.json. Run at the repository root:
#   Rscript scripts/prepare-data.R [--state MS] [--out DIR] [--cache DIR] [--pin]
# (options in scripts/lib/region.R). Inputs: the state's 2024 TIGER/Line tracts
# and the ACS S1701 export for all its tracts from data.census.gov.
# R packages: sf, spdep, arrow, jsonlite, digest, rmapshaper, geojsonsf, httr2.
suppressPackageStartupMessages(library(sf))
source("scripts/lib/region.R")
ctx <- region_context()
stage <- tempfile("rumb-prepare-")
dir.create(stage)
output <- ctx$out

tiger_url <- sprintf("https://www2.census.gov/geo/tiger/TIGER2024/TRACT/tl_2024_%s_tract.zip", ctx$fips)
table_url <- paste0("https://data.census.gov/table/ACSST5Y2024.S1701?g=", tract_filter(ctx))
tiger_zip <- cached(ctx, tiger_url)
subject_zip <- census_export(ctx, "ACSST5Y2024.S1701")

export <- read_export(ctx, subject_zip, "ACSST5Y2024.S1701", stage)
acs <- export$data
acs_csv <- export$csv
shapes <- st_read(paste0("/vsizip/", tiger_zip), quiet = TRUE)
pin(ctx, "tiger_tracts", tiger_url, tiger_zip,
    list(tracts = nrow(shapes), counties = length(unique(shapes$COUNTYFP))))
pin(ctx, "acs_s1701", table_url, acs_csv, list(rows = nrow(acs)))
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
  county = sub(paste0("^.*; (.*); ", ctx$name, "$"), "\\1", acs$NAME),
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
stopifnot(!any(measures$county == acs$NAME), length(unique(measures$county)) == length(unique(shapes$COUNTYFP)))

graphs <- contiguity(st_geometry(shapes))
ids <- measures$GEOID
by_id <- function(graph) setNames(lapply(graph, function(indices) I(ids[indices])), ids)
write_json <- function(x, filename) write_json_file(x, file.path(stage, filename))
write_json(lapply(graphs, by_id), "neighbors.json")

# The display asset and analytical source share stable IDs. Only display is simplified.
full <- region_lonlat(st_sf(measures, geometry = st_transform(st_geometry(shapes), "OGC:CRS84")), ctx)
display <- rmapshaper::ms_simplify(full, keep = 0.02, keep_shapes = TRUE, snap = FALSE)
stopifnot(identical(display$GEOID, ids), all(!st_is_empty(display)))
display$feature_id <- display$GEOID
st_write(display, file.path(stage, "tracts.geojson"), driver = "GeoJSON", quiet = TRUE,
         layer_options = c("ID_FIELD=feature_id", "ID_TYPE=String",
                           "RFC7946=YES", "COORDINATE_PRECISION=5"))

# The analytical copy for spatial SQL. Mississippi keeps full TIGER resolution
# (10.7 MB); other states simplify with shared arcs to a 10 m interval, which
# keeps all states within GitHub Pages' size limit and moves no boundary more
# than about 10 m (Mississippi at 10 m: 151k of 983k vertices, 2.4 MB of WKB).
analytical <- full
if (ctx$fips != "28") {
  # rmapshaper runs commands on GeoJSON text (an sf input returns nothing).
  text <- geojsonsf::sf_geojson(full["GEOID"], digits = 15)
  analytical <- geojsonsf::geojson_sf(rmapshaper::apply_mapshaper_commands(text, "-simplify interval=10 keep-shapes"))
  stopifnot(identical(analytical$GEOID, ids), all(!st_is_empty(analytical)))
  analytical <- st_sf(measures, geometry = st_cast(st_geometry(analytical), "MULTIPOLYGON"))
}
# GeoParquet 1.1 uses OGC:CRS84 when the metadata omits crs. Physical storage is WKB.
wkb <- st_as_binary(st_geometry(analytical), EWKB = FALSE)
geometry_column <- arrow::as_arrow_array(unclass(wkb), type = arrow::binary())
table <- arrow::Table$create(measures, geometry = geometry_column)
geo <- list(version = "1.1.0", primary_column = "geometry", columns = list(geometry = list(
  encoding = "WKB", geometry_types = I("MultiPolygon"), bbox = unname(as.numeric(st_bbox(analytical)))
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
products <- c("neighbors.json", "tracts.geojson", "tracts.parquet", "reference.json")
source_info <- list(
  version = paste0(ctx$id, "-tracts-acs2024-v1"), period = "2020–2024", state = ctx$name,
  tract_count = length(ids), valid_poverty_rates = sum(is.finite(measures$poverty_pct)),
  valid_child_poverty_rates = sum(is.finite(measures$child_poverty_pct)),
  geography = list(title = paste("2024 TIGER/Line", ctx$name, "census tracts"), url = tiger_url,
                   archive_sha256 = sha256(tiger_zip)),
  measures = list(title = "2020–2024 ACS five-year subject table S1701", url = table_url,
    variables = "https://api.census.gov/data/2024/acs/acs5/subject/groups/S1701.html",
    csv_sha256 = sha256(acs_csv), confidence_level = 0.90,
    all_ages = list(rate = "S1701_C03_001E", moe = "S1701_C03_001M",
                    below = "S1701_C02_001E", universe = "S1701_C01_001E"),
    under_18 = list(rate = "S1701_C03_002E", moe = "S1701_C03_002M",
                    below = "S1701_C02_002E", universe = "S1701_C01_002E")),
  methods = list(weights = paste0("Undirected, first-order, within ", ctx$name, "; queen shares at least one boundary point, rook a boundary segment, evaluated with GEOS on original TIGER vertices."),
    display = "Mapshaper shared-arc simplification at 2% retained removable vertices, preserving small features; coordinates rounded to 5 decimal places.",
    analytical = if (ctx$fips != "28") "GeoParquet geometry simplified with Mapshaper shared arcs at a 10 m interval, preserving small features.",
    statistics = "Reference for poverty_pct: exclude missing estimates and islands, row-standardize weights, spdep::moran and spdep::localmoran(mlvar=FALSE)."),
  packages = lapply(setNames(c("sf", "spdep", "arrow", "rmapshaper"), c("sf", "spdep", "arrow", "rmapshaper")),
                    function(p) as.character(packageVersion(p))),
  assets = setNames(lapply(products, function(p) list(bytes = file.size(file.path(stage, p)),
                                      sha256 = sha256(file.path(stage, p)))), products)
)
write_json(source_info, "sources.json")
stopifnot(all(file.copy(file.path(stage, c(products, "sources.json")), output, overwrite = TRUE)))
message("Wrote ", length(ids), " ", ctx$name, " census tracts to ", output)
