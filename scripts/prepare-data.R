#!/usr/bin/env Rscript
# Builds a state's reference tracts: display GeoJSON, analytical GeoParquet,
# contiguity, the Moran reference and sources.json. Run at the repository root:
#   Rscript scripts/prepare-data.R [--state MS] [--out DIR] [--cache DIR] [--pin]
# (options in scripts/lib/region.R). Inputs: the state's 2024 TIGER/Line tracts
# and the ACS S1701 export for all its tracts from data.census.gov. With
# --state US the areas are every county of the 50 states and DC: shapes from the
# 2024 cartographic boundary file (shorelines, for a national map), contiguity
# from 2024 TIGER/Line counties, so neighbors cross state lines.
# R packages: sf, spdep, arrow, jsonlite, digest, rmapshaper, geojsonsf, httr2.
suppressPackageStartupMessages(library(sf))
source("scripts/lib/region.R")
ctx <- region_context()
stage <- tempfile("rumb-prepare-")
dir.create(stage)
output <- ctx$out

national <- ctx$national
unit <- ctx$unit  # "tracts" or "counties": the reference layer's id and file names
tiger_url <- if (national) "https://www2.census.gov/geo/tiger/TIGER2024/COUNTY/tl_2024_us_county.zip" else
  sprintf("https://www2.census.gov/geo/tiger/TIGER2024/TRACT/tl_2024_%s_tract.zip", ctx$fips)
table_url <- paste0("https://data.census.gov/table/ACSST5Y2024.S1701?g=", tract_filter(ctx))
tiger_zip <- cached(ctx, tiger_url, national = national)
subject_zip <- census_export(ctx, "ACSST5Y2024.S1701")

export <- read_export(ctx, subject_zip, "ACSST5Y2024.S1701", stage)
acs <- export$data
acs_csv <- export$csv
shapes <- st_read(paste0("/vsizip/", tiger_zip), quiet = TRUE)
if (national) {
  # TIGER also lists Puerto Rico and the Island Areas; the region is the 50 states and DC.
  shapes <- shapes[shapes$STATEFP %in% ctx$states, ]
  pin(ctx, "tiger_counties", tiger_url, tiger_zip, list(counties = nrow(shapes)), national = TRUE)
  # The shapes drawn and queried: the cartographic file, clipped to the
  # shoreline, with the same counties.
  cb_url <- "https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_county_500k.zip"
  cb_zip <- cached(ctx, cb_url, national = TRUE)
  pin(ctx, "layer_census_counties_2024", cb_url, cb_zip, national = TRUE)
  drawn <- st_read(paste0("/vsizip/", cb_zip), quiet = TRUE)
  drawn <- drawn[drawn$STATEFP %in% ctx$states, ]
  drawn <- drawn[order(drawn$GEOID), ]
  stopifnot(identical(sort(shapes$GEOID), drawn$GEOID))
} else {
  pin(ctx, "tiger_tracts", tiger_url, tiger_zip,
      list(tracts = nrow(shapes), counties = length(unique(shapes$COUNTYFP))))
}
pin(ctx, "acs_s1701", table_url, acs_csv, list(rows = nrow(acs)), national = national)
stopifnot(!anyDuplicated(acs$GEOID), !anyDuplicated(shapes$GEOID), all(acs$GEOID %in% shapes$GEOID))
# TIGER 2024 can list a few tracts the ACS table does not (New York has 14 new
# Suffolk County tracts); they stay on the map with missing estimates.
without_acs <- sort(setdiff(shapes$GEOID, acs$GEOID))
if (length(without_acs) > max(5, 0.01 * nrow(shapes)))
  stop(length(without_acs), " TIGER tracts have no ACS row: ", paste(head(without_acs), collapse = ", "))
shapes <- shapes[order(shapes$GEOID), ]
if (!national) {
  county_names <- tapply(sub(paste0("^.*; (.*); ", ctx$name, "$"), "\\1", acs$NAME), substr(acs$GEOID, 3, 5), `[`, 1)
}
acs <- acs[match(shapes$GEOID, acs$GEOID), ]
if (!national) acs$NAME[is.na(acs$NAME)] <- paste0("x; ", county_names[shapes$COUNTYFP[is.na(acs$NAME)]], "; ", ctx$name)
acs_num <- function(field) {
  vals <- acs[[field]]
  vals[vals %in% c("", "-", "**", "***", "*****", "(X)", "N")] <- NA_character_
  out <- as.numeric(vals)
  stopifnot(all(is.na(out) == is.na(vals)), all(out >= 0, na.rm = TRUE))
  out
}
# A county is named with its state's abbreviation (there are 30 Washington
# Counties) and grouped by state; a tract is grouped by its county.
abbr_of <- setNames(vapply(jsonlite::read_json("scripts/regions.json")$regions, function(r) r$abbr, ""), ctx$states)
state_of <- setNames(vapply(jsonlite::read_json("scripts/regions.json")$regions, function(r) r$name, ""), ctx$states)
group <- if (national) list(state = unname(state_of[shapes$STATEFP])) else
  list(county = sub(paste0("^.*; (.*); ", ctx$name, "$"), "\\1", acs$NAME))
measures <- data.frame(
  GEOID = shapes$GEOID,
  name = if (national) paste0(shapes$NAMELSAD, ", ", abbr_of[shapes$STATEFP]) else shapes$NAMELSAD,
  group,
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
  have <- !shapes$GEOID %in% without_acs
  rate <- rate[have]; count <- count[have]; universe <- universe[have]
  stopifnot(all(count <= universe), all(is.na(rate) == (universe == 0)))
  eligible <- universe > 0
  stopifnot(all(abs(rate[eligible] - 100 * count[eligible] / universe[eligible]) < 0.051))
}
with(measures, check_measure(poverty_pct, poverty_count, poverty_universe))
with(measures, check_measure(child_poverty_pct, child_poverty_count, child_poverty_universe))
if (national) {
  stopifnot(!anyNA(measures$state), length(unique(measures$state)) == length(ctx$states))
} else {
  stopifnot(!any(measures$county == acs$NAME), length(unique(measures$county)) == length(unique(shapes$COUNTYFP)))
}

graphs <- contiguity(st_geometry(shapes))
if (national) {
  # The same graphs without links across water (scripts/lib/region.R, shoreline()).
  shore <- shoreline(graphs, shapes, drawn)
  graphs$queenShore <- shore$queen
  graphs$rookShore <- shore$rook
}
ids <- measures$GEOID
by_id <- function(graph) setNames(lapply(graph, function(indices) I(ids[indices])), ids)
write_json <- function(x, filename) write_json_file(x, file.path(stage, filename))
write_json(lapply(graphs, by_id), "neighbors.json")

# The display asset and analytical source share stable IDs. Only display is simplified.
full <- region_lonlat(st_sf(measures, geometry = st_transform(st_geometry(if (national) drawn else shapes), "OGC:CRS84")), ctx)
# The cartographic file is already generalized, so it keeps more of its vertices.
display_keep <- if (national) 0.12 else 0.02
display <- rmapshaper::ms_simplify(full, keep = display_keep, keep_shapes = TRUE, snap = FALSE)
stopifnot(identical(display$GEOID, ids), all(!st_is_empty(display)))
display$feature_id <- display$GEOID
st_write(display, file.path(stage, paste0(unit, ".geojson")), driver = "GeoJSON", quiet = TRUE,
         layer_options = c("ID_FIELD=feature_id", "ID_TYPE=String",
                           rfc7946(ctx), "COORDINATE_PRECISION=5"))

# The analytical copy for spatial SQL. Mississippi keeps full TIGER resolution
# (10.7 MB); other states simplify with shared arcs to a 10 m interval, which
# keeps all states within GitHub Pages' size limit and moves no boundary more
# than about 10 m (Mississippi at 10 m: 151k of 983k vertices, 2.4 MB of WKB).
# The national counties simplify to 50 m, which keeps them near 1:500,000.
analytical <- full
interval <- if (national) 50 else 10
if (ctx$fips != "28") {
  # rmapshaper runs commands on GeoJSON text (an sf input returns nothing).
  text <- geojsonsf::sf_geojson(full["GEOID"], digits = 15)
  analytical <- geojsonsf::geojson_sf(rmapshaper::apply_mapshaper_commands(text, paste0("-simplify interval=", interval, " keep-shapes")))
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
arrow::write_parquet(table, file.path(stage, paste0(unit, ".parquet")), compression = "zstd", chunk_size = 64)

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
products <- c("neighbors.json", paste0(unit, c(".geojson", ".parquet")), "reference.json")
counted <- if (national) {
  list(county_count = length(ids), counties_without_acs = if (length(without_acs)) I(without_acs))
} else {
  list(tract_count = length(ids), tracts_without_acs = if (length(without_acs)) I(without_acs))
}
source_info <- c(list(
  version = paste0(ctx$id, "-", unit, "-acs2024-v1"), period = "2020–2024", state = ctx$name), counted, list(
  valid_poverty_rates = sum(is.finite(measures$poverty_pct)),
  valid_child_poverty_rates = sum(is.finite(measures$child_poverty_pct)),
  geography = Filter(Negate(is.null), list(
    title = if (national) "2024 cartographic boundary counties (1:500,000), 50 states and DC" else paste("2024 TIGER/Line", ctx$name, "census tracts"),
    url = if (national) cb_url else tiger_url,
    archive_sha256 = sha256(if (national) cb_zip else tiger_zip),
    contiguity = if (national) list(title = "2024 TIGER/Line counties", url = tiger_url, archive_sha256 = sha256(tiger_zip)))),
  measures = list(title = "2020–2024 ACS five-year subject table S1701", url = table_url,
    variables = "https://api.census.gov/data/2024/acs/acs5/subject/groups/S1701.html",
    csv_sha256 = sha256(acs_csv), confidence_level = 0.90,
    all_ages = list(rate = "S1701_C03_001E", moe = "S1701_C03_001M",
                    below = "S1701_C02_001E", universe = "S1701_C01_001E"),
    under_18 = list(rate = "S1701_C03_002E", moe = "S1701_C03_002M",
                    below = "S1701_C02_002E", universe = "S1701_C01_002E")),
  methods = list(weights = if (national) "Undirected, first-order, across state lines; queen shares at least one boundary point, rook a boundary segment, evaluated with GEOS on original TIGER/Line county vertices (whose boundaries run through water, so counties facing each other across a lake or bay may touch). queenShore and rookShore keep only the links that also meet on land: the 2024 cartographic shapes, clipped to the shoreline, come within 100 m, or TIGER's only contact is a point within 100 m of them."
      else paste0("Undirected, first-order, within ", ctx$name, "; queen shares at least one boundary point, rook a boundary segment, evaluated with GEOS on original TIGER vertices."),
    display = paste0("Mapshaper shared-arc simplification at ", display_keep * 100, "% retained removable vertices, preserving small features; coordinates rounded to 5 decimal places."),
    analytical = if (ctx$fips != "28") paste0("GeoParquet geometry simplified with Mapshaper shared arcs at a ", interval, " m interval, preserving small features."),
    statistics = "Reference for poverty_pct: exclude missing estimates and islands, row-standardize weights, spdep::moran and spdep::localmoran(mlvar=FALSE)."),
  packages = lapply(setNames(c("sf", "spdep", "arrow", "rmapshaper"), c("sf", "spdep", "arrow", "rmapshaper")),
                    function(p) as.character(packageVersion(p))),
  assets = setNames(lapply(products, function(p) list(bytes = file.size(file.path(stage, p)),
                                      sha256 = sha256(file.path(stage, p)))), products)
))
# Leave out what does not apply (NULL), so Mississippi's manifest is unchanged.
source_info$methods <- Filter(Negate(is.null), source_info$methods)
write_json(Filter(Negate(is.null), source_info), "sources.json")
stopifnot(all(file.copy(file.path(stage, c(products, "sources.json")), output, overwrite = TRUE)))
message("Wrote ", length(ids), " ", ctx$name, if (national) " counties" else " census tracts", " to ", output)
