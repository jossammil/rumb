#!/usr/bin/env Rscript
# Builds the attribute tables that join to the reference tracts by GEOID, read
# lazily by the app: ACS 2020–2024 data-profile covariates, CDC PLACES 2025
# tract estimates and 2020 Census centers of population (tracts and counties).
# Writes public/data/ms/tables/*.json and tables/index.json, which describes
# every field and records where each input came from. Run at the repository root:
#   Rscript scripts/prepare-tables.R [download-cache-folder]
# The cache may already hold DP02.zip–DP05.zip (data.census.gov exports for all
# Mississippi tracts) and the national PLACES CSV; anything missing is downloaded.
# R packages: jsonlite, digest, httr2.
spec <- jsonlite::read_json("scripts/tables.json")
args <- commandArgs(trailingOnly = TRUE)
cache <- if (length(args)) args[[1]] else Sys.getenv("RUMB_TABLE_CACHE", file.path(tempdir(), "rumb-tables"))
dir.create(cache, recursive = TRUE, showWarnings = FALSE)
output <- "public/data/ms/tables"
dir.create(output, recursive = TRUE, showWarnings = FALSE)
stage <- tempfile("rumb-tables-")
dir.create(stage)
sha256 <- function(path) digest::digest(path, algo = "sha256", file = TRUE)
fetch <- function(url, name = basename(url)) {
  dest <- file.path(cache, name)
  if (!file.exists(dest)) download.file(url, dest, mode = "wb", quiet = TRUE)
  dest
}

# The reference tracts, in the order the display file lists them.
tracts <- jsonlite::read_json("public/data/ms/tracts.geojson")
ids <- vapply(tracts$features, function(f) f$properties$GEOID, character(1))
stopifnot(length(ids) == 878L, !anyDuplicated(ids))

# ---- ACS data profiles -------------------------------------------------------
endpoint <- "https://data.census.gov/api/access/table/download"
census_export <- function(table, dest) {
  response <- httr2::request(endpoint) |>
    httr2::req_body_json(list(request = list(id = table, g = "040XX00US28$1400000", download_estimate = FALSE))) |>
    httr2::req_perform() |>
    httr2::resp_body_json()
  job <- response$response$download_id
  stopifnot(is.character(job), length(job) == 1)
  for (attempt in seq_len(60)) {
    status <- httr2::request(paste0(endpoint, "?status&download_id=", job)) |> httr2::req_perform() |> httr2::resp_body_json()
    if (identical(status$response$status, "complete")) {
      download.file(status$response$url, dest, mode = "wb", quiet = TRUE)
      return(invisible(dest))
    }
    Sys.sleep(2)
  }
  stop("Census table export did not finish for ", table)
}
acs <- spec$acs
columns <- list()
labels <- character()
acs_sources <- list()
for (t in unlist(acs$tables)) {
  table <- sub("{table}", t, acs$table, fixed = TRUE)
  zip <- file.path(cache, paste0(t, ".zip"))
  if (!file.exists(zip)) census_export(table, zip)
  csv_name <- paste0(table, "-Data.csv")
  unzip(zip, files = csv_name, exdir = stage)
  csv <- file.path(stage, csv_name)
  d <- read.csv(csv, colClasses = "character", fileEncoding = "UTF-8-BOM", check.names = FALSE)
  # The export's second heading row describes each variable.
  stopifnot(d$GEO_ID[1] == "Geography")
  labels <- c(labels, unlist(d[1, ]))
  d <- d[-1, ]
  stopifnot(all(grepl("^1400000US28[0-9]{9}$", d$GEO_ID)))
  d$GEOID <- sub("^1400000US", "", d$GEO_ID)
  stopifnot(!anyDuplicated(d$GEOID), setequal(d$GEOID, ids))
  d <- d[match(ids, d$GEOID), ]
  for (name in setdiff(names(d), c("GEO_ID", "NAME", "GEOID"))) columns[[name]] <- d[[name]]
  acs_sources[[t]] <- list(url = sub("{table}", t, acs$url, fixed = TRUE), csv_sha256 = sha256(csv))
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
places_csv <- fetch(places$download, "PLACES_tract_GIS_2025.csv")
if (!identical(sha256(places_csv), places$sha256))
  stop("The PLACES download changed (sha256 ", sha256(places_csv), "). Review it, then update scripts/tables.json.")
p <- read.csv(places_csv, colClasses = "character", fileEncoding = "UTF-8-BOM", check.names = FALSE)
names(p) <- trimws(names(p))  # one 2025 heading ends in a tab
p <- p[p$StateAbbr == "MS", ]
stopifnot(nrow(p) == 870L, !anyDuplicated(p$TractFIPS), all(p$TractFIPS %in% ids))
missing_places <- setdiff(ids, p$TractFIPS)
row <- match(ids, p$TractFIPS)
places_cols <- list(places_pop18 = as.numeric(gsub(",", "", p$TotalPop18plus))[row])
places_fields <- list(places_pop18 = list(label = "Adults 18 and over (2020 Census)", format = "integer", role = "meta"))
places_measures <- character()
# Measures for a narrower population than all adults cannot be pooled by adult population.
narrower <- c("TEETHLOST", "COLON_SCREEN", "MAMMOUSE", "ACCESS2", "BPMED", "HIGHCHOL")
for (m in places$measures) {
  code <- m[[1]]
  key <- paste0("places_", tolower(code))
  value <- as.numeric(p[[paste0(code, "_CrudePrev")]])[row]
  interval <- p[[paste0(code, "_Crude95CI")]][row]
  parts <- regmatches(interval, regexec("^\\(\\s*([0-9.]+),\\s*([0-9.]+)\\s*\\)$", interval))
  lcl <- vapply(parts, function(x) if (length(x) == 3) as.numeric(x[2]) else NA_real_, numeric(1))
  ucl <- vapply(parts, function(x) if (length(x) == 3) as.numeric(x[3]) else NA_real_, numeric(1))
  have <- !is.na(row)
  stopifnot(all(is.finite(value[have])), all(lcl[have] <= value[have] & value[have] <= ucl[have]))
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
read_centers <- function(url, name) {
  path <- fetch(url, name)
  d <- read.csv(path, colClasses = "character", fileEncoding = "UTF-8-BOM")
  list(path = path, d = d)
}
tc <- read_centers(spec$centers$tracts, "CenPop2020_Mean_TR28.txt")
tc$d$GEOID <- paste0(tc$d$STATEFP, tc$d$COUNTYFP, tc$d$TRACTCE)
stopifnot(setequal(tc$d$GEOID, ids))
tc$d <- tc$d[match(ids, tc$d$GEOID), ]
cc <- read_centers(spec$centers$counties, "CenPop2020_Mean_CO28.txt")
cc$d$GEOID <- paste0(cc$d$STATEFP, cc$d$COUNTYFP)
counties <- jsonlite::read_json(file.path("public/data/ms/layers", paste0(spec$centers$countyLayer, ".geojson")))
county_ids <- vapply(counties$features, function(f) as.character(f$id), character(1))
stopifnot(length(county_ids) == 82L, setequal(cc$d$GEOID, county_ids))
cc$d <- cc$d[match(county_ids, cc$d$GEOID), ]
centers <- function(d, id) list(version = 1, ids = I(id), lon = as.numeric(d$LONGITUDE), lat = as.numeric(d$LATITUDE),
                                population = as.integer(d$POPULATION))

# ---- Write -------------------------------------------------------------------------
write <- function(x, name) {
  jsonlite::write_json(x, file.path(stage, name), auto_unbox = TRUE, digits = NA, na = "null", null = "null")
  name
}
table_file <- function(id, cols) list(version = 1, table = id, ids = I(ids), columns = cols)
files <- c(
  write(table_file("acs", acs_cols), "tracts-acs.json"),
  write(table_file("places", places_cols), "tracts-places.json"),
  write(centers(tc$d, ids), "tracts-centers.json"),
  write(centers(cc$d, county_ids), "counties-centers.json")
)
asset <- function(f) list(bytes = file.size(file.path(stage, f)), sha256 = sha256(file.path(stage, f)))
index <- list(
  version = 1,
  layer = "tracts",
  tables = list(
    list(id = "acs", name = "ACS 2020–2024 profile", group = acs$group, file = "tables/tracts-acs.json",
         credit = acs$credit, vintage = acs$vintage, confidence = acs$confidence,
         measures = I(acs_measures), fields = acs_fields),
    list(id = "places", name = "CDC PLACES 2025", group = places$group, file = "tables/tracts-places.json",
         credit = places$credit, vintage = places$vintage, modelBased = TRUE, note = places$note,
         url = places$url, methodology = places$methodology, confidence = 95,
         measures = I(places_measures), fields = places_fields)
  ),
  centers = list(
    tracts = list(file = "tables/tracts-centers.json", credit = spec$centers$credit),
    chr_counties_2025 = list(file = "tables/counties-centers.json", credit = spec$centers$credit)
  ),
  sources = list(
    acs = list(title = acs$title, tables = acs_sources, top_or_bottom_coded = top_coded),
    places = list(title = places$title, url = places$url, download = places$download, sha256 = sha256(places_csv),
                  dictionary = places$dictionary, tracts_without_estimates = I(missing_places)),
    centers = list(title = spec$centers$title, tracts = list(url = spec$centers$tracts, sha256 = sha256(tc$path)),
                   counties = list(url = spec$centers$counties, sha256 = sha256(cc$path)))
  ),
  assets = setNames(lapply(files, asset), files),
  packages = list(jsonlite = as.character(packageVersion("jsonlite")))
)
invisible(write(index, "index.json"))
stopifnot(all(file.copy(file.path(stage, c(files, "index.json")), output, overwrite = TRUE)))
message(sprintf("Wrote %d ACS and %d PLACES measures for %d tracts, and %d + %d centers, to %s",
                length(acs_measures), length(places_measures), length(ids), length(ids), length(county_ids), output))
