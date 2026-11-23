# Shared helpers for the per-state data scripts. Every prepare-*.R script
# sources this file and takes the same options:
#   --state MS      a state's abbreviation, FIPS code or data id (default MS)
#   --out DIR       where the region's files go (default public/data/<id>)
#   --cache DIR     downloads (default $RUMB_SOURCE_CACHE or .cache/sources)
#   --pin           record what was downloaded instead of checking it
# Downloads are pinned in scripts/sources/<id>.json (national files in
# national.json): each source's SHA-256 (of
# the file itself, or of the CSV inside a data.census.gov export, whose ZIP
# wrapper changes between exports) and the counts read from it. Without --pin a
# script stops when a download no longer matches, so a changed source is
# reviewed before it reaches the app.
# R packages: jsonlite, digest, httr2 (sf for contiguity).

region_context <- function(args = commandArgs(trailingOnly = TRUE)) {
  value <- function(flag, default) {
    at <- match(flag, args)
    if (is.na(at)) return(default)
    stopifnot(at < length(args))
    args[[at + 1]]
  }
  known <- c("--state", "--out", "--cache", "--pin")
  flags <- args[startsWith(args, "--")]
  if (length(setdiff(flags, known))) stop("Unknown option ", setdiff(flags, known)[1])
  want <- toupper(value("--state", "MS"))
  regions <- jsonlite::read_json("scripts/regions.json")$regions
  hit <- Filter(function(r) want %in% c(r$abbr, r$fips, toupper(r$id)), regions)
  if (length(hit) != 1) stop("Unknown state ", want, "; see scripts/regions.json")
  r <- hit[[1]]
  ctx <- list(
    id = r$id, fips = r$fips, abbr = r$abbr, name = r$name,
    out = value("--out", file.path("public/data", r$id)),
    cache = value("--cache", Sys.getenv("RUMB_SOURCE_CACHE", ".cache/sources")),
    pin = "--pin" %in% args,
    pins = file.path("scripts/sources", paste0(r$id, ".json")),
    build = file.path(".cache/build", r$id)
  )
  dir.create(ctx$out, recursive = TRUE, showWarnings = FALSE)
  dir.create(file.path(ctx$cache, ctx$fips), recursive = TRUE, showWarnings = FALSE)
  dir.create(file.path(ctx$cache, "us"), recursive = TRUE, showWarnings = FALSE)
  dir.create(ctx$build, recursive = TRUE, showWarnings = FALSE)
  ctx
}

sha256 <- function(path) digest::digest(path, algo = "sha256", file = TRUE)

# The data.census.gov geography filter for every tract in the state.
tract_filter <- function(ctx) paste0("040XX00US", ctx$fips, "$1400000")

# A cached download: national files under us/, the state's under its FIPS code.
cached <- function(ctx, url, name = basename(url), national = FALSE) {
  dest <- file.path(ctx$cache, if (national) "us" else ctx$fips, name)
  if (!file.exists(dest)) {
    part <- paste0(dest, ".part")
    for (attempt in 1:3) {
      ok <- tryCatch(download.file(url, part, mode = "wb", quiet = TRUE) == 0, error = function(e) FALSE)
      if (ok) break
      Sys.sleep(5 * attempt)
    }
    if (!ok) stop("Could not download ", url)
    file.rename(part, dest)
  }
  dest
}

# A data.census.gov table export (a ZIP holding <table>-Data.csv) for the
# state's tracts. The export is a job: request it, poll, then download.
census_export <- function(ctx, table) {
  dest <- file.path(ctx$cache, ctx$fips, paste0(table, ".zip"))
  if (file.exists(dest)) return(dest)
  endpoint <- "https://data.census.gov/api/access/table/download"
  for (attempt in 1:3) {
    done <- tryCatch({
      response <- httr2::request(endpoint) |>
        httr2::req_body_json(list(request = list(id = table, g = tract_filter(ctx), download_estimate = FALSE))) |>
        httr2::req_retry(max_tries = 3) |>
        httr2::req_perform() |>
        httr2::resp_body_json()
      job <- response$response$download_id
      stopifnot(is.character(job), length(job) == 1)
      url <- NULL
      for (poll in seq_len(120)) {
        status <- httr2::request(paste0(endpoint, "?status&download_id=", job)) |>
          httr2::req_retry(max_tries = 3) |> httr2::req_perform() |> httr2::resp_body_json()
        if (identical(status$response$status, "complete")) {
          url <- status$response$url
          break
        }
        Sys.sleep(2)
      }
      stopifnot(!is.null(url))
      part <- paste0(dest, ".part")
      download.file(url, part, mode = "wb", quiet = TRUE)
      file.rename(part, dest)
    }, error = function(e) {
      message("Census export of ", table, " for ", ctx$name, " failed (", conditionMessage(e), "); retrying");
      FALSE
    })
    if (isTRUE(done)) return(dest)
    Sys.sleep(10 * attempt)
  }
  stop("Census table export did not finish for ", table, " (", ctx$name, ")")
}

# The CSV inside an export, with its variable-description row removed. The
# first data row's GEO_ID must be a tract of this state.
read_export <- function(ctx, zip, table, stage) {
  csv_name <- paste0(table, "-Data.csv")
  unzip(zip, files = csv_name, exdir = stage)
  csv <- file.path(stage, csv_name)
  d <- read.csv(csv, colClasses = "character", fileEncoding = "UTF-8-BOM", check.names = FALSE)
  stopifnot(d$GEO_ID[1] == "Geography")
  labels <- unlist(d[1, ])
  d <- d[-1, ]
  bad <- !grepl(paste0("^1400000US", ctx$fips, "[0-9]{9}$"), d$GEO_ID)
  if (any(bad)) stop(table, " has rows outside ", ctx$name, ": ", d$GEO_ID[which(bad)[1]])
  d$GEOID <- sub("^1400000US", "", d$GEO_ID)
  list(data = d, labels = labels, csv = csv)
}

# ---- Pins ----------------------------------------------------------------------
pins_file <- function(ctx, national) if (national) "scripts/sources/national.json" else ctx$pins
pins_read <- function(path, region) {
  if (file.exists(path)) jsonlite::read_json(path) else list(version = 1, region = region)
}

# Checks (or, with --pin, records) one source: its URL, SHA-256 and any counts
# read from it. Stops on a mismatch. National files (the same for every state)
# are pinned once, in scripts/sources/national.json.
pin <- function(ctx, key, url, path, counts = list(), national = FALSE) {
  file <- pins_file(ctx, national)
  sha <- sha256(path)
  pins <- pins_read(file, if (national) "us" else ctx$id)
  entry <- c(list(url = url, sha256 = sha), counts)
  if (ctx$pin) {
    # Write only on a change, so parallel builds only read national.json.
    if (identical(lapply(pins[[key]], as.character), lapply(entry, as.character))) return(invisible(sha))
    pins[[key]] <- entry
    pins <- pins[c("version", "region", sort(setdiff(names(pins), c("version", "region"))))]
    dir.create(dirname(file), recursive = TRUE, showWarnings = FALSE)
    jsonlite::write_json(pins, file, auto_unbox = TRUE, pretty = TRUE)
    return(invisible(sha))
  }
  want <- pins[[key]]
  if (is.null(want)) stop(key, " is not pinned in ", file, ". Run with --pin and review it.")
  for (field in names(entry)) {
    if (!identical(as.character(want[[field]]), as.character(entry[[field]])))
      stop(key, " for ", ctx$name, " changed: ", field, " is ", entry[[field]], ", pinned ", want[[field]],
           ". Review the source, then run with --pin.")
  }
  invisible(sha)
}

# ---- Geometry ------------------------------------------------------------------
# Queen (a shared boundary point) and rook (a shared boundary segment)
# contiguity, from GEOS predicates on the original, unsimplified coordinates
# with the CRS removed, so shared TIGER vertices coincide exactly. Both graphs
# must be symmetric and rook must lie within queen.
contiguity <- function(geometry) {
  g <- sf::st_set_crs(geometry, NA)
  stopifnot(all(sf::st_is_valid(g)), all(!sf::st_is_empty(g)))
  graphs <- list(queen = sf::st_touches(g), rook = sf::st_relate(g, pattern = "F***1****"))
  for (i in seq_along(g)) {
    stopifnot(all(graphs$rook[[i]] %in% graphs$queen[[i]]))
    for (graph in graphs) {
      stopifnot(!i %in% graph[[i]], all(vapply(graph[[i]], function(j) i %in% graph[[j]], logical(1))))
    }
  }
  graphs
}

# A metric CRS for simplification tolerances and areas, never for output.
# Mississippi keeps its state plane system, so its files do not change.
metric_crs <- function(ctx) {
  switch(ctx$fips, "28" = 3814, "02" = 3338, "15" = "ESRI:102007", 5070)
}

# Longitude and latitude as the region uses them. Alaska's Aleutians cross
# 180°: its positive longitudes move west by 360°, so the state is one
# west-to-east piece (MapLibre draws longitudes below -180° in place).
region_lonlat <- function(x, ctx) {
  if (ctx$fips != "02") return(x)
  crs <- sf::st_crs(x)
  g <- sf::st_shift_longitude(sf::st_geometry(x)) - c(360, 0)
  sf::st_set_geometry(x, sf::st_set_crs(g, crs))
}

# GDAL's RFC 7946 mode wraps longitudes into [-180°, 180°] and splits shapes at
# 180°, which would undo Alaska's shift; Alaska's files are written without it.
rfc7946 <- function(ctx) if (ctx$fips == "02") "RFC7946=NO" else "RFC7946=YES"

write_json_file <- function(x, path, digits = 15) {
  jsonlite::write_json(x, path, auto_unbox = TRUE, null = "null", na = "null", digits = digits)
  invisible(path)
}
