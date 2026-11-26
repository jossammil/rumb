# Shared helpers for the per-state data scripts. Every prepare-*.R script
# sources this file and takes the same options:
#   --state MS      a state's abbreviation, FIPS code or data id (default MS),
#                   or US for the national region, whose areas are counties
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
  manifest <- jsonlite::read_json("scripts/regions.json")
  regions <- c(manifest$regions, list(manifest$national))
  hit <- Filter(function(r) want %in% c(r$abbr, toupper(r$fips), toupper(r$id)), regions)
  if (length(hit) != 1) stop("Unknown state ", want, "; see scripts/regions.json")
  r <- hit[[1]]
  ctx <- list(
    id = r$id, fips = r$fips, abbr = r$abbr, name = r$name,
    # The national region's areas are counties; a state's are tracts.
    national = identical(r$id, manifest$national$id),
    unit = r$unit %||% "tracts",
    states = vapply(manifest$regions, function(s) s$fips, character(1)),
    out = value("--out", file.path("public/data", r$id)),
    cache = value("--cache", Sys.getenv("RUMB_SOURCE_CACHE", ".cache/sources")),
    pin = "--pin" %in% args,
    # The national region's own downloads are pinned with the national files.
    pins = file.path("scripts/sources", paste0(if (identical(r$id, manifest$national$id)) "national" else r$id, ".json")),
    build = file.path(".cache/build", r$id)
  )
  dir.create(ctx$out, recursive = TRUE, showWarnings = FALSE)
  dir.create(file.path(ctx$cache, ctx$fips), recursive = TRUE, showWarnings = FALSE)
  dir.create(file.path(ctx$cache, "us"), recursive = TRUE, showWarnings = FALSE)
  dir.create(ctx$build, recursive = TRUE, showWarnings = FALSE)
  ctx
}

sha256 <- function(path) digest::digest(path, algo = "sha256", file = TRUE)

# The data.census.gov geography filter for every tract in the state, or for
# every county in the country (the 50 states and DC).
tract_filter <- function(ctx) if (ctx$national) "010XX00US$0500000" else paste0("040XX00US", ctx$fips, "$1400000")
# An export row's GEO_ID: a tract of the state, or a county of one of the states.
geo_pattern <- function(ctx) {
  if (ctx$national) paste0("^0500000US(", paste(ctx$states, collapse = "|"), ")[0-9]{3}$")
  else paste0("^1400000US", ctx$fips, "[0-9]{9}$")
}

# Downloads may take minutes (CDC's 75 MB PLACES export is slow). R's default
# 60-second timeout cut it short in CI, and a timeout is only a warning, so
# fetch_url() turns every warning into a failed attempt. (Not "fetch": prepare-layers.R defines its own.)
options(timeout = max(1800, getOption("timeout")))
fetch_url <- function(url, dest) {
  unlink(dest)
  tryCatch(download.file(url, dest, mode = "wb", quiet = TRUE) == 0 && file.size(dest) > 0,
           warning = function(w) FALSE, error = function(e) FALSE)
}

# A cached download: national files under us/, the state's under its FIPS code.
cached <- function(ctx, url, name = basename(url), national = FALSE) {
  dest <- file.path(ctx$cache, if (national) "us" else ctx$fips, name)
  if (!file.exists(dest)) {
    part <- paste0(dest, ".part")
    for (attempt in 1:3) {
      ok <- fetch_url(url, part)
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
      if (!fetch_url(url, part)) stop("the download of the finished export failed")
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

# The CSV inside an export, with its variable-description row removed. Every
# row's GEO_ID must be one of the region's areas (geo_pattern).
read_export <- function(ctx, zip, table, stage) {
  csv_name <- paste0(table, "-Data.csv")
  unzip(zip, files = csv_name, exdir = stage)
  csv <- file.path(stage, csv_name)
  d <- read.csv(csv, colClasses = "character", fileEncoding = "UTF-8-BOM", check.names = FALSE)
  stopifnot(d$GEO_ID[1] == "Geography")
  labels <- unlist(d[1, ])
  d <- d[-1, ]
  # The country's counties include Puerto Rico's municipios, which the region leaves out.
  if (ctx$national) d <- d[!grepl("^0500000US72[0-9]{3}$", d$GEO_ID), ]
  bad <- !grepl(geo_pattern(ctx), d$GEO_ID)
  if (any(bad)) stop(table, " has rows outside ", ctx$name, ": ", d$GEO_ID[which(bad)[1]])
  d$GEOID <- sub("^(1400000|0500000)US", "", d$GEO_ID)
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

# Contiguity that does not cross water: TIGER's graphs (from contiguity()),
# keeping a link only where the two areas also meet on land. `tiger` and
# `drawn` (the cartographic file, clipped to the shoreline) list the same
# areas in the same order. A link stays when the two cartographic shapes come
# within `slack` metres, or when TIGER has them meeting only at points and one
# of those lies within `slack` of the cartographic shapes: generalization
# opens land contacts a few metres apart, and once rounds a TIGER corner
# 301 m apart, while the narrowest water in TIGER's links is 175 m. Nothing
# is added, so the results stay symmetric and rook stays within queen.
shoreline <- function(graphs, tiger, drawn, slack = 100) {
  crs <- 5070
  shore <- sf::st_transform(sf::st_geometry(drawn), crs)
  edges <- sf::st_transform(sf::st_geometry(tiger), crs)
  queen <- graphs$queen
  # Each TIGER link once (i < j); distances for these pairs only take seconds.
  pairs <- do.call(rbind, lapply(seq_along(queen), function(i) if (length(queen[[i]])) cbind(i, queen[[i]])))
  pairs <- pairs[pairs[, 1] < pairs[, 2], , drop = FALSE]
  near <- as.numeric(sf::st_distance(shore[pairs[, 1]], shore[pairs[, 2]], by_element = TRUE)) <= slack
  on_land <- function(i, j) {
    shared <- sf::st_intersection(sf::st_boundary(edges[i]), sf::st_boundary(edges[j]))
    if (!length(shared) || sum(as.numeric(sf::st_length(shared))) > 0) return(FALSE)
    points <- sf::st_cast(shared, "POINT")
    any(lengths(sf::st_is_within_distance(points, shore, slack)) > 0)
  }
  keep <- near
  for (k in which(!near)) keep[k] <- on_land(pairs[k, 1], pairs[k, 2])
  kept <- pairs[keep, , drop = FALSE]
  out <- list(queen = lapply(seq_along(queen), function(i) sort(c(kept[kept[, 1] == i, 2], kept[kept[, 2] == i, 1]))))
  out$rook <- lapply(seq_along(graphs$rook), function(i) intersect(graphs$rook[[i]], out$queen[[i]]))
  for (i in seq_along(queen)) {
    stopifnot(all(out$rook[[i]] %in% out$queen[[i]]), all(out$queen[[i]] %in% queen[[i]]))
    for (graph in out) stopifnot(all(vapply(graph[[i]], function(j) i %in% graph[[j]], logical(1))))
  }
  out
}

# A metric CRS for simplification tolerances and areas, never for output.
# Mississippi keeps its state plane system, so its files do not change.
metric_crs <- function(ctx) {
  switch(ctx$fips, "28" = 3814, "02" = 3338, "15" = "ESRI:102007", 5070)
}

# Whether the region holds Alaska, whose Aleutians cross 180°.
has_alaska <- function(ctx) ctx$fips == "02" || ctx$national

# Longitude and latitude as the region uses them. Alaska's Aleutians cross
# 180°: its positive longitudes move west by 360°, so the state is one
# west-to-east piece (MapLibre draws longitudes below -180° in place). Every
# other longitude in the country is negative and comes back unchanged.
region_lonlat <- function(x, ctx) {
  if (!has_alaska(ctx)) return(x)
  crs <- sf::st_crs(x)
  g <- sf::st_shift_longitude(sf::st_geometry(x)) - c(360, 0)
  sf::st_set_geometry(x, sf::st_set_crs(g, crs))
}

# GDAL's RFC 7946 mode wraps longitudes into [-180°, 180°] and splits shapes at
# 180°, which would undo Alaska's shift; Alaska's files are written without it.
rfc7946 <- function(ctx) if (has_alaska(ctx)) "RFC7946=NO" else "RFC7946=YES"

write_json_file <- function(x, path, digits = 15) {
  jsonlite::write_json(x, path, auto_unbox = TRUE, null = "null", na = "null", digits = digits)
  invisible(path)
}
