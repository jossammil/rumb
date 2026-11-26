#!/usr/bin/env Rscript
# Builds the attribute tables that join to a state's reference tracts by GEOID,
# read lazily by the app: ACS 2020–2024 data-profile covariates, CDC PLACES 2025
# tract estimates and 2020 Census centers of population (tracts and counties).
# Writes <out>/tables/*.json and tables/index.json, which describes every field
# and records where each input came from. Run at the repository root after
# prepare-data.R and prepare-layers.R:
#   Rscript scripts/prepare-tables.R [--state MS] [--out DIR] [--cache DIR] [--pin]
# (options in scripts/lib/region.R). Downloads: DP02–DP05 exports for the
# state's tracts, the national PLACES CSV and the state's center files.
# R packages: jsonlite, digest, httr2, arrow, sf.
source("scripts/lib/region.R")
ctx <- region_context()
spec <- jsonlite::read_json("scripts/tables.json")
fill <- function(template) {
  x <- sub("{geo}", tract_filter(ctx), template, fixed = TRUE)
  gsub("{fips}", ctx$fips, x, fixed = TRUE)
}
output <- file.path(ctx$out, "tables")
dir.create(output, recursive = TRUE, showWarnings = FALSE)
stage <- tempfile("rumb-tables-")
dir.create(stage)

# The reference areas (nationally, counties), in the order the display file lists them.
national <- ctx$national
unit <- ctx$unit
tracts <- jsonlite::read_json(file.path(ctx$out, paste0(unit, ".geojson")))
ids <- vapply(tracts$features, function(f) f$properties$GEOID, character(1))
stopifnot(length(ids) > 0, !anyDuplicated(ids))

# A source's tract GEOIDs in terms of ours. In 2022 Connecticut replaced its
# eight counties with nine planning regions: tract codes stayed, county codes
# changed, so 2020-based files (centers, PLACES) name tracts by the old
# county. An id that does not match is matched by its tract code when that
# code is unique on both sides. Returns our id for each source id (NA if none).
align <- function(source_ids) {
  out <- ifelse(source_ids %in% ids, source_ids, NA_character_)
  # Counties have no tract codes; the 2025 county sources already use the planning regions.
  if (national) return(out)
  tract <- function(x) substr(x, 6, 11)
  free <- setdiff(ids, out)
  loose <- is.na(out)
  unique_code <- function(x) !duplicated(x) & !duplicated(x, fromLast = TRUE)
  ours <- free[unique_code(tract(free))]
  theirs <- unique_code(tract(source_ids)) & loose
  out[theirs] <- ours[match(tract(source_ids[theirs]), tract(ours))]
  out
}

# ---- ACS data profiles -------------------------------------------------------
acs <- spec$acs
columns <- list()
labels <- character()
acs_sources <- list()
for (t in unlist(acs$tables)) {
  table <- sub("{table}", t, acs$table, fixed = TRUE)
  zip <- census_export(ctx, table)
  export <- read_export(ctx, zip, table, stage)
  d <- export$data
  csv <- export$csv
  labels <- c(labels, export$labels)
  # As in prepare-data.R, a few new TIGER tracts may have no ACS row.
  stopifnot(!anyDuplicated(d$GEOID), all(d$GEOID %in% ids), length(ids) - nrow(d) <= max(5, 0.01 * length(ids)))
  pin(ctx, paste0("acs_", tolower(t)), fill(sub("{table}", t, acs$url, fixed = TRUE)), csv, list(rows = nrow(d)))
  d <- d[match(ids, d$GEOID), ]
  for (name in setdiff(names(d), c("GEO_ID", "NAME", "GEOID"))) columns[[name]] <- d[[name]]
  acs_sources[[t]] <- list(url = fill(sub("{table}", t, acs$url, fixed = TRUE)), csv_sha256 = sha256(csv))
}
# A changed label means the variable code now means something else.
for (code in names(acs$labels)) {
  if (!identical(unname(labels[code]), acs$labels[[code]]))
    stop(code, " is now labelled '", labels[code], "', not '", acs$labels[[code]], "'.")
}
top_coded <- 0L
acs_num <- function(code) {
  x <- columns[[code]]
  stopifnot(!is.null(x))
  x[x %in% c("", "-", "**", "***", "*****", "(X)", "N", "null")] <- NA_character_
  # Medians are top- or bottom-coded ("250,000+", "2,500-"); keep the bound.
  coded <- !is.na(x) & grepl("^[0-9,.]+[+-]$", x)
  top_coded <<- top_coded + sum(coded)
  x <- sub("[+-]$", "", gsub(",", "", x))
  out <- suppressWarnings(as.numeric(x))
  stopifnot(all(is.na(out) == is.na(x)))
  out
}
acs_cols <- list()
acs_fields <- list()
acs_measures <- character()
source_of <- function(code) paste("ACS", sub("_.*$", "", code))
for (f in acs$fields) {
  key <- paste0("acs_", f$id)
  if (!is.null(f$estimate)) {
    acs_cols[[key]] <- acs_num(f$estimate)
    acs_cols[[paste0(key, "_moe")]] <- acs_num(f$moe)
    acs_fields[[key]] <- Filter(Negate(is.null), list(
      label = f$label, format = f$format, unit = f$unit, moe = paste0(key, "_moe"),
      source = source_of(f$estimate), vintage = acs$vintage, group = acs$group
    ))
    acs_fields[[paste0(key, "_moe")]] <- list(label = paste(f$label, "margin of error"), role = "meta")
  } else {
    pct <- paste0(key, "_pct")
    if (!is.null(f$complement)) {
      value <- 100 - acs_num(f$complement)
      count <- Reduce(`+`, lapply(unlist(f$countSum), acs_num))
    } else {
      value <- acs_num(f$pct)
      count <- acs_num(f$count)
    }
    universe <- acs_num(f$universe)
    # Percentages are published to one decimal; counts must agree with them.
    ok <- is.finite(value) & universe > 0
    stopifnot(all(count <= universe, na.rm = TRUE),
              all(abs(value[ok] - 100 * count[ok] / universe[ok]) < 0.051 + 1e-9))
    acs_cols[[pct]] <- value
    acs_cols[[paste0(key, "_moe")]] <- acs_num(f$pctMoe)
    acs_cols[[paste0(key, "_count")]] <- count
    acs_cols[[paste0(key, "_universe")]] <- universe
    acs_fields[[pct]] <- list(
      label = f$label, format = "percent", unit = "%", moe = paste0(key, "_moe"), count = paste0(key, "_count"),
      universe = paste0(key, "_universe"), countLabel = f$label, universeLabel = f$universeLabel,
      source = source_of(f$universe), vintage = acs$vintage, group = acs$group
    )
    acs_fields[[paste0(key, "_moe")]] <- list(label = paste(f$label, "margin of error"), role = "meta")
    acs_fields[[paste0(key, "_count")]] <- list(label = paste(f$label, "(count)"), format = "integer", role = "meta")
    acs_fields[[paste0(key, "_universe")]] <- list(label = f$universeLabel, format = "integer", role = "meta")
    key <- pct
  }
  acs_measures <- c(acs_measures, key)
}

# ---- CDC PLACES ----------------------------------------------------------------
places <- spec$places
if (national) {
  # The county file: the same measures and columns, one row per county.
  county_places <- spec$placesCounties
  places_csv <- cached(ctx, county_places$download, county_places$file, national = TRUE)
  if (sha256(places_csv) != county_places$sha256)
    stop("The county PLACES download changed (sha256 ", sha256(places_csv), "). Compare it with the pinned export, then update scripts/tables.json.")
  places[c("title", "url", "download", "sha256")] <- county_places[c("title", "url", "download", "sha256")]
  places$equivalent <- NULL
} else {
# Socrata's v3 export; the rows.csv link it replaced was retired in October
# 2026 and served the same bytes (the pinned SHA-256 below).
places_csv <- cached(ctx, places$download, "PLACES_tract_GIS_2025.csv", national = TRUE)
# CDC regenerates the CSV on each download, so its bytes can change while its
# data does not. tables.json lists exports checked to hold the same values as
# the pinned one; outputs record the pinned checksum, so they do not depend on
# which equivalent export was downloaded.
known_places <- c(places$sha256, vapply(places$equivalent %||% list(), function(e) e$sha256, character(1)))
if (!sha256(places_csv) %in% known_places)
  stop("The PLACES download changed (sha256 ", sha256(places_csv), "). Compare it with the pinned export, then add it to scripts/tables.json.")
}
p <- read.csv(places_csv, colClasses = "character", fileEncoding = "UTF-8-BOM", check.names = FALSE)
names(p) <- trimws(names(p))  # one 2025 heading ends in a tab
names(p) <- sub("_Crude95ci$", "_Crude95CI", names(p))  # the county file spells one "FOODSTAMP_Crude95ci"
abbrs <- vapply(jsonlite::read_json("scripts/regions.json")$regions, function(r) r$abbr, "")
p <- if (national) p[p$StateAbbr %in% abbrs, ] else p[p$StateAbbr == ctx$abbr, ]
p$area_id <- if (national) p$CountyFIPS else p$TractFIPS
stopifnot(nrow(p) > 0, !anyDuplicated(p$area_id))
p$area_id <- align(p$area_id)
unmatched_places <- sum(is.na(p$area_id))
if (unmatched_places) stop(unmatched_places, " PLACES ", unit, " match none here")
missing_places <- setdiff(ids, p$area_id)
row <- match(ids, p$area_id)
# CDC publishes no estimate for tracts with almost no adults. Any other gap
# means the tract IDs no longer line up.
# CDC publishes no estimate for tracts with almost no adults, and a handful of
# special-use tracts (bases, parks, airports) lack rows too. More than that
# means the tract ids no longer line up.
populated <- ids[is.finite(acs_cols$acs_population) & acs_cols$acs_population >= 50]
gaps <- intersect(missing_places, populated)
if (length(gaps) > max(5, 0.01 * length(ids)))
  stop(length(gaps), " populated tracts have no PLACES row: ", paste(head(gaps), collapse = ", "))
places_cols <- list(places_pop18 = as.numeric(gsub(",", "", p$TotalPop18plus))[row])
places_fields <- list(places_pop18 = list(label = "Adults 18 and over (2020 Census)", format = "integer", role = "meta"))
places_measures <- character()
not_published <- character()
# Measures for a narrower population than all adults cannot be pooled by adult population.
narrower <- c("TEETHLOST", "COLON_SCREEN", "MAMMOUSE", "ACCESS2", "BPMED", "HIGHCHOL")
for (m in places$measures) {
  code <- m[[1]]
  key <- paste0("places_", tolower(code))
  estimate <- trimws(p[[paste0(code, "_CrudePrev")]])
  # Some states' 2025 release lacks whole measures (Kentucky and Pennsylvania
  # most of them, nine states the social-needs module): leave those out. A
  # tract may also lack a single estimate; it stays missing.
  if (all(estimate == "")) { not_published <- c(not_published, code); next }
  value <- suppressWarnings(as.numeric(estimate))[row]
  interval <- p[[paste0(code, "_Crude95CI")]][row]
  parts <- regmatches(interval, regexec("^\\(\\s*([0-9.]+),\\s*([0-9.]+)\\s*\\)$", interval))
  lcl <- vapply(parts, function(x) if (length(x) == 3) as.numeric(x[2]) else NA_real_, numeric(1))
  ucl <- vapply(parts, function(x) if (length(x) == 3) as.numeric(x[3]) else NA_real_, numeric(1))
  have <- !is.na(row) & !is.na(estimate[row]) & estimate[row] != ""
  stopifnot(all(is.finite(value[have])), all(lcl[have] <= value[have] & value[have] <= ucl[have]),
            all(is.na(value[!have])))
  places_cols[[key]] <- value
  places_cols[[paste0(key, "_lcl")]] <- lcl
  places_cols[[paste0(key, "_ucl")]] <- ucl
  meta <- list(label = m[[2]], format = "percent", unit = "%", lcl = paste0(key, "_lcl"), ucl = paste0(key, "_ucl"), ci = 95,
               source = "CDC PLACES 2025", vintage = places$vintage, group = m[[3]], modelBased = TRUE)
  if (!code %in% narrower) meta$pool <- list(kind = "weighted", numerator = key, weight = "places_pop18")
  places_fields[[key]] <- meta
  places_fields[[paste0(key, "_lcl")]] <- list(label = paste(m[[2]], "lower 95% limit"), unit = "%", role = "meta")
  places_fields[[paste0(key, "_ucl")]] <- list(label = paste(m[[2]], "upper 95% limit"), unit = "%", role = "meta")
  places_measures <- c(places_measures, key)
}

# ---- Centers of population -------------------------------------------------------
read_centers <- function(template, key) {
  url <- fill(template)
  path <- cached(ctx, url)
  d <- read.csv(path, colClasses = "character", fileEncoding = "UTF-8-BOM")
  pin(ctx, key, url, path, list(rows = nrow(d)))
  list(path = path, url = url, d = d)
}
if (national) {
  # The national county file, with Connecticut's former counties replaced by
  # its planning regions' centers, made from the 2020 tract centers as the
  # Census Bureau makes a mean center: latitude weighted by population,
  # longitude by population × cos(latitude). Tracts nest in planning regions;
  # 2024 TIGER gives each tract code its region.
  cc <- read_centers(spec$centers$countiesNational, "centers_counties")
  cc$d$GEOID <- paste0(cc$d$STATEFP, cc$d$COUNTYFP)
  cc$d <- cc$d[cc$d$STATEFP %in% ctx$states & cc$d$STATEFP != "09", c("GEOID", "LATITUDE", "LONGITUDE", "POPULATION")]
  ct <- read_centers(spec$centers$connecticutTracts, "centers_tracts_09")
  ct_zip <- cached(ctx, spec$centers$connecticutTiger, national = TRUE)
  pin(ctx, "tiger_tracts_09", spec$centers$connecticutTiger, ct_zip, national = TRUE)
  ct_tiger <- sf::st_read(paste0("/vsizip/", ct_zip), quiet = TRUE)
  stopifnot(all(ct$d$TRACTCE %in% ct_tiger$TRACTCE))
  # A tract code used in two regions goes to the 2024 tract holding its center.
  points <- sf::st_as_sf(ct$d, coords = c("LONGITUDE", "LATITUDE"), crs = 4269, remove = FALSE)
  points <- sf::st_transform(points, sf::st_crs(ct_tiger))
  region <- vapply(seq_len(nrow(ct$d)), function(i) {
    hits <- which(ct_tiger$TRACTCE == ct$d$TRACTCE[i])
    if (length(hits) > 1) hits <- hits[which.min(as.numeric(sf::st_distance(points[i, ], ct_tiger[hits, ])))]
    substr(ct_tiger$GEOID[hits], 1, 5)
  }, character(1))
  w <- as.numeric(ct$d$POPULATION)
  lat <- as.numeric(ct$d$LATITUDE)
  lon <- as.numeric(ct$d$LONGITUDE)
  cw <- w * cos(lat * pi / 180)
  ct_centers <- data.frame(
    GEOID = sort(unique(region)),
    LATITUDE = as.character(round(tapply(w * lat, region, sum) / tapply(w, region, sum), 6)),
    LONGITUDE = as.character(round(tapply(cw * lon, region, sum) / tapply(cw, region, sum), 6)),
    POPULATION = sprintf("%.0f", tapply(w, region, sum))
  )
  cc$d <- rbind(cc$d, ct_centers)
  stopifnot(setequal(cc$d$GEOID, ids))
  cc$d <- cc$d[match(ids, cc$d$GEOID), ]
  county_ids <- ids
  new_tracts <- character()
  # The County Health Rankings layer has the same counties.
  chr <- jsonlite::read_json(file.path(ctx$out, "layers", paste0(spec$centers$countyLayer, ".geojson")))
  stopifnot(setequal(vapply(chr$features, function(f) as.character(f$id), character(1)), ids))
} else {
  tc <- read_centers(spec$centers$tracts, "centers_tracts")
  tc$d$GEOID <- align(paste0(tc$d$STATEFP, tc$d$COUNTYFP, tc$d$TRACTCE))
  tc$d <- tc$d[!is.na(tc$d$GEOID), ]
  # A tract added since 2020 has no published center: use a point inside it,
  # with no population, and list it.
  new_tracts <- setdiff(ids, tc$d$GEOID)
  if (length(new_tracts) > max(5, 0.01 * length(ids)))
    stop(length(new_tracts), " tracts have no 2020 center of population: ", paste(head(new_tracts), collapse = ", "))
  if (length(new_tracts)) {
    shapes <- sf::st_read(file.path(ctx$out, "tracts.geojson"), quiet = TRUE)
    inside <- suppressWarnings(sf::st_coordinates(sf::st_point_on_surface(sf::st_geometry(shapes[match(new_tracts, shapes$GEOID), ]))))
    tc$d <- rbind(tc$d[c("GEOID", "LATITUDE", "LONGITUDE", "POPULATION")],
                  data.frame(GEOID = new_tracts, LATITUDE = as.character(round(inside[, 2], 6)),
                             LONGITUDE = as.character(round(inside[, 1], 6)), POPULATION = "0"))
  }
  tc$d <- tc$d[match(ids, tc$d$GEOID), ]
  cc <- read_centers(spec$centers$counties, "centers_counties")
  cc$d$GEOID <- paste0(cc$d$STATEFP, cc$d$COUNTYFP)
  counties <- jsonlite::read_json(file.path(ctx$out, "layers", paste0(spec$centers$countyLayer, ".geojson")))
  county_ids <- vapply(counties$features, function(f) as.character(f$id), character(1))
  stopifnot(length(county_ids) > 0, setequal(cc$d$GEOID, county_ids))
  cc$d <- cc$d[match(county_ids, cc$d$GEOID), ]
}
# I() keeps one-county states' columns as arrays.
centers <- function(d, id) list(version = 1, ids = I(id), lon = I(as.numeric(d$LONGITUDE)), lat = I(as.numeric(d$LATITUDE)),
                                population = I(as.integer(d$POPULATION)))

# ---- Write -------------------------------------------------------------------------
write <- function(x, name) {
  jsonlite::write_json(x, file.path(stage, name), auto_unbox = TRUE, digits = NA, na = "null", null = "null")
  name
}
table_file <- function(id, cols) list(version = 1, table = id, ids = I(ids), columns = cols)
# The same table as Parquet (Snappy, which the app's reader handles without
# extra codecs): GEOID, then one double column per field. Values are rounded
# to the 15 significant digits the JSON carries, so both read back to the same
# numbers.
write_parquet_table <- function(cols, name) {
  df <- data.frame(GEOID = ids, lapply(cols, function(x) signif(as.numeric(x), 15)), check.names = FALSE)
  arrow::write_parquet(df, file.path(stage, name), compression = "snappy")
  name
}
named <- function(x) paste0(unit, "-", x)
files <- c(
  write(table_file("acs", acs_cols), named("acs.json")),
  write(table_file("places", places_cols), named("places.json")),
  write_parquet_table(acs_cols, named("acs.parquet")),
  write_parquet_table(places_cols, named("places.parquet")),
  if (!national) write(centers(tc$d, ids), "tracts-centers.json"),
  write(centers(cc$d, county_ids), "counties-centers.json")
)
# Source notes name the reference areas ("tracts_without_estimates", or counties_…).
by_unit <- function(x) setNames(x, sub("tracts", unit, names(x), fixed = TRUE))
asset <- function(f) list(bytes = file.size(file.path(stage, f)), sha256 = sha256(file.path(stage, f)))
index <- list(
  version = 1,
  layer = unit,
  tables = list(
    list(id = "acs", name = "ACS 2020–2024 profile", group = acs$group, file = paste0("tables/", named("acs.json")),
         parquet = paste0("tables/", named("acs.parquet")),
         credit = acs$credit, vintage = acs$vintage, confidence = acs$confidence,
         measures = I(acs_measures), fields = acs_fields),
    list(id = "places", name = "CDC PLACES 2025", group = places$group, file = paste0("tables/", named("places.json")),
         parquet = paste0("tables/", named("places.parquet")),
         credit = places$credit, vintage = places$vintage, modelBased = TRUE, note = places$note,
         url = places$url, methodology = places$methodology, confidence = 95,
         measures = I(places_measures), fields = places_fields)
  ),
  centers = if (national) list(
    counties = list(file = "tables/counties-centers.json", credit = spec$centers$credit),
    chr_counties_2025 = list(file = "tables/counties-centers.json", credit = spec$centers$credit)
  ) else list(
    tracts = list(file = "tables/tracts-centers.json", credit = spec$centers$credit),
    chr_counties_2025 = list(file = "tables/counties-centers.json", credit = spec$centers$credit)
  ),
  sources = list(
    acs = list(title = acs$title, tables = acs_sources, top_or_bottom_coded = top_coded),
    places = by_unit(Filter(Negate(is.null), list(title = places$title, url = places$url, download = places$download,
                  sha256 = places$sha256, dictionary = places$dictionary,
                  tracts_without_estimates = I(missing_places),
                  populated_tracts_without_estimates = if (length(gaps)) I(gaps),
                  measures_not_published = if (length(not_published)) I(not_published)))),
    centers = if (national) list(title = spec$centers$title, counties = list(url = cc$url, sha256 = sha256(cc$path)),
                   connecticut = list(
                     method = "Planning regions: the population-weighted mean of their 2020 tract centers (latitude by population, longitude by population × cos latitude), tracts assigned by 2024 TIGER/Line tract codes.",
                     tracts = list(url = ct$url, sha256 = sha256(ct$path)),
                     tiger = list(url = spec$centers$connecticutTiger, sha256 = sha256(ct_zip))))
      else Filter(Negate(is.null), list(title = spec$centers$title, tracts = list(url = tc$url, sha256 = sha256(tc$path)),
                   counties = list(url = cc$url, sha256 = sha256(cc$path)),
                   tracts_without_centers = if (length(new_tracts)) I(new_tracts)))
  ),
  assets = setNames(lapply(files, asset), files),
  packages = list(jsonlite = as.character(packageVersion("jsonlite")), arrow = as.character(packageVersion("arrow")))
)
invisible(write(index, "index.json"))
stopifnot(all(file.copy(file.path(stage, c(files, "index.json")), output, overwrite = TRUE)))
message(sprintf("Wrote %d ACS and %d PLACES measures for %d %s, and %d + %d centers, to %s",
                length(acs_measures), length(places_measures), length(ids), unit, length(ids), length(county_ids), output))
