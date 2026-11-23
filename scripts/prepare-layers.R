#!/usr/bin/env Rscript
# Builds the add-on layers listed in scripts/layers.json into <out>/layers/:
# one display GeoJSON per layer, queen and rook neighbors for polygon layers, and
# library.json, which describes every layer to the app and records where each
# came from. Run at the repository root, after prepare-data.R:
#   Rscript scripts/prepare-layers.R [--state MS] [--out DIR] [--cache DIR] [--pin]
# (options in scripts/lib/region.R). Mississippi gets every layer, most of them
# from MARIS. Other states get the layers whose source covers the nation:
# County Health Rankings, on the Census Bureau's 2024 cartographic boundary
# counties, with neighbors taken from the state's tract neighbors.
# R packages: sf, rmapshaper, jsonlite, digest.
suppressPackageStartupMessages(library(sf))
sf_use_s2(FALSE)
source("scripts/lib/region.R")
ctx <- region_context()
spec <- jsonlite::read_json("scripts/layers.json")
output <- file.path(ctx$out, "layers")
dir.create(output, recursive = TRUE, showWarnings = FALSE)
stage <- tempfile("rumb-layers-")
dir.create(stage)
na_text <- unlist(spec$na)
`%||%` <- function(a, b) if (is.null(a)) b else a

# A pinned download: MARIS files are Mississippi's, the others national.
fetch <- function(l) {
  national <- !identical(l$source %||% "maris", "maris")
  path <- cached(ctx, l$url, national = national)
  pin(ctx, paste0("layer_", l$id), l$url, path, national = national)
  path
}
read_zip <- function(zip, id) {
  dir <- file.path(stage, id)
  unzip(zip, exdir = dir)
  shp <- list.files(dir, "[.]shp$", recursive = TRUE, full.names = TRUE)
  if (length(shp) > 1) shp <- shp[basename(shp) == sub("[.]zip$", ".shp", basename(zip))]
  stopifnot(length(shp) == 1)
  x <- st_read(shp, quiet = TRUE)
  if (is.na(st_crs(x))) stop(id, " has no coordinate reference system")
  x
}

# Upper-case text from older inventories reads better in title case.
title_case <- function(x) {
  upper <- !is.na(x) & x == toupper(x)
  x[upper] <- gsub("(^|[ /(-])([a-z])", "\\1\\U\\2", tolower(x[upper]), perl = TRUE)
  x
}
clean_text <- function(x) {
  x <- trimws(as.character(x))
  x[x %in% na_text] <- NA_character_
  x
}
clean_number <- function(x) {
  x <- suppressWarnings(as.numeric(x))
  x[!is.finite(x) | x == -999] <- NA_real_
  x
}

# Applies a layer's field list: rename, code values, clean, derive ratios.
shape_fields <- function(df, fields) {
  out <- list()
  for (name in names(fields)) {
    f <- fields[[name]]
    if (!is.null(f$ratio)) next
    if (!f$from %in% names(df)) stop("missing source field ", f$from)
    raw <- df[[f$from]]
    fmt <- f$format %||% if (is.numeric(raw)) "number" else "text"
    if (!is.null(f$values)) {
      key <- clean_text(raw)
      mapped <- unlist(f$values)[key]
      value <- ifelse(is.na(mapped), key, mapped)
    } else if (fmt %in% c("number", "integer", "percent", "rate", "currency")) {
      value <- clean_number(raw)
      if (fmt == "integer") value <- round(value)
    } else {
      value <- clean_text(raw)
      if (isTRUE(f$title)) value <- title_case(value)
      if (fmt == "url") value <- ifelse(is.na(value) | grepl("^https?://", value, ignore.case = TRUE),
                                        value, paste0("http://", value))
    }
    out[[name]] <- unname(value)
  }
  for (name in names(fields)) {
    f <- fields[[name]]
    if (is.null(f$ratio)) next
    num <- out[[f$ratio[[1]]]]
    den <- out[[f$ratio[[2]]]]
    out[[name]] <- ifelse(is.finite(den) & den > 0, round(f$scale * num / den, 2), NA_real_)
  }
  as.data.frame(out, stringsAsFactors = FALSE)
}

# Queen: polygons within half a metre of each other; rook: those that share at
# least a metre of boundary. Tolerances absorb the small gaps in older layers.
neighbor_graphs <- function(geometry, ids) {
  g <- st_make_valid(geometry)
  queen <- st_is_within_distance(g, g, 0.5)
  queen <- lapply(seq_along(queen), function(i) setdiff(queen[[i]], i))
  edges <- st_boundary(g)
  rook <- lapply(seq_along(queen), function(i) Filter(function(j) {
    shared <- suppressWarnings(st_intersection(edges[i], st_buffer(g[j], 0.5)))
    length(shared) > 0 && sum(as.numeric(st_length(shared))) >= 1
  }, queen[[i]]))
  by_id <- function(graph) setNames(lapply(graph, function(k) I(ids[k])), ids)
  list(queen = by_id(queen), rook = by_id(rook))
}

write_layer <- function(x, id, geometry, keep) {
  x <- region_lonlat(st_transform(x, "OGC:CRS84"), ctx)
  if (geometry == "point") {
    if (any(st_geometry_type(x) == "MULTIPOINT")) {
      coords <- st_coordinates(x)
      counts <- tabulate(coords[, "L1"], nrow(x))
      if (any(counts > 1)) message(id, ": ", sum(counts > 1), " multipoints reduced to their first point")
      first <- coords[!duplicated(coords[, "L1"]), , drop = FALSE]
      stopifnot(nrow(first) == nrow(x))
      st_geometry(x) <- st_sfc(lapply(seq_len(nrow(first)), function(k) st_point(first[k, 1:2])), crs = "OGC:CRS84")
    }
  } else {
    x <- st_make_valid(x)
    x <- rmapshaper::ms_simplify(x, keep = keep, keep_shapes = TRUE)
  }
  path <- file.path(stage, paste0(id, ".geojson"))
  st_write(x, path, driver = "GeoJSON", quiet = TRUE, delete_dsn = TRUE,
           layer_options = c("ID_FIELD=feature_id", "ID_TYPE=String", "RFC7946=YES",
                             "COORDINATE_PRECISION=5", "WRITE_NAME=NO"))
  list(path = path, bbox = round(unname(as.numeric(st_bbox(x))), 4))
}

field_meta <- function(f, column) {
  meta <- list(label = f$label, format = f$format %||% if (is.numeric(column)) "number" else "text")
  if (identical(meta$format, "percent")) meta$unit <- "%"
  if (!is.null(f$source)) meta$source <- f$source
  if (!is.null(f$ratio)) meta$pool <- list(numerator = f$ratio[[1]], denominator = f$ratio[[2]], scale = f$scale)
  meta
}

build_maris <- function(l) {
  zip <- fetch(l)
  x <- read_zip(zip, l$id)
  df <- st_drop_geometry(x)
  data <- shape_fields(df, l$fields)
  ids <- if (!is.null(l$idFrom)) as.character(df[[l$idFrom]]) else as.character(seq_len(nrow(df)))
  stopifnot(!anyDuplicated(ids), !anyNA(ids))
  # A few inventory records have no real location (empty, or a placeholder at the
  # largest representable coordinate). Drop them; IDs stay the source row numbers.
  ok <- !st_is_empty(x)
  if (l$geometry == "point") {
    xy <- suppressWarnings(st_coordinates(st_transform(st_centroid(st_geometry(x)), "OGC:CRS84")))
    ok <- ok & is.finite(xy[, 1]) & is.finite(xy[, 2]) & xy[, 1] > -95 & xy[, 1] < -85 & xy[, 2] > 28 & xy[, 2] < 37
  }
  dropped <- sum(!ok)
  if (dropped) message(l$id, ": dropped ", dropped, " records with no usable location")
  x <- x[ok, ]
  df <- df[ok, , drop = FALSE]
  data <- data[ok, , drop = FALSE]
  ids <- ids[ok]
  graphs <- if (l$geometry == "polygon") neighbor_graphs(st_geometry(x), ids)
  shaped <- st_sf(feature_id = ids, data, geometry = st_geometry(x))
  list(sf = shaped, graphs = graphs, dropped = dropped,
       fields = setNames(lapply(names(l$fields), function(n) field_meta(l$fields[[n]], data[[n]])), names(l$fields)),
       measures = names(Filter(function(f) isTRUE(f$measure), l$fields)),
       source = list(url = l$url, sha256 = sha256(zip), terms = spec$terms[[l$terms]]))
}

build_chr <- function(l, built) {
  csv <- fetch(l)
  labels <- read.csv(csv, nrows = 1, header = FALSE, colClasses = "character", check.names = FALSE)
  d <- read.csv(csv, skip = 1, colClasses = "character", check.names = FALSE)
  names(labels) <- names(d)
  d <- d[d$statecode == ctx$fips & d$countycode != "000", ]
  geo <- built[[l$geometryFrom]]$sf
  if (!setequal(d$fipscode, geo$feature_id))
    stop("County Health Rankings and the county geometry disagree for ", ctx$name, ": ",
         paste(head(c(setdiff(d$fipscode, geo$feature_id), setdiff(geo$feature_id, d$fipscode))), collapse = ", "))
  d <- d[match(geo$feature_id, d$fipscode), ]
  fraction <- unlist(l$fraction)
  value <- function(v) {
    x <- clean_number(d[[paste0(v, "_rawvalue")]])
    if (v %in% fraction) x <- x * 100
    if (!is.null(l$scaleBy[[v]])) x <- x * l$scaleBy[[v]]
    round(x, 4)
  }
  data <- list(name = geo$name)
  fields <- list(name = list(label = "County", format = "text"))
  measures <- character()
  for (row in l$measures) {
    v <- row[[1]]; label <- row[[2]]; kind <- row[[3]]; scale <- row[[4]]; fmt <- row[[5]]; group <- row[[6]]
    raw <- paste0(v, "_rawvalue")
    data[[raw]] <- value(v)
    meta <- list(label = label, format = fmt, group = group, source = "County Health Rankings 2025")
    if (fmt == "percent") meta$unit <- "%"
    # The published value is age-adjusted; the numerator and denominator are crude,
    # so anything pooled or smoothed from them is a crude rate.
    adjusted <- length(row) >= 7 && identical(row[[7]], "age-adjusted")
    if (adjusted) meta$ageAdjusted <- TRUE
    num <- paste0(v, "_numerator")
    data[[num]] <- clean_number(d[[num]])
    fields[[num]] <- list(label = paste0(label, ": numerator"), format = "number", role = "meta")
    pool <- list(numerator = num, kind = kind)
    if (kind == "ratio") {
      den <- paste0(v, "_denominator")
      data[[den]] <- clean_number(d[[den]])
      fields[[den]] <- list(label = paste0(label, ": denominator"), format = "number", role = "meta")
      pool$denominator <- den
      pool$scale <- scale
      if (adjusted) pool$crude <- TRUE
    }
    flag <- paste0(v, "_flag")
    if (flag %in% names(d)) {
      data[[flag]] <- clean_number(d[[flag]])
      fields[[flag]] <- list(label = paste0(label, ": flag (1 unreliable, 2 suppressed)"), format = "integer", role = "meta")
      pool$flag <- flag
    }
    meta$pool <- pool
    fields[[raw]] <- meta
    measures <- c(measures, raw)
  }
  for (row in l$display) {
    raw <- paste0(row[[1]], "_rawvalue")
    data[[raw]] <- value(row[[1]])
    fields[[raw]] <- list(label = row[[2]], format = row[[3]], group = row[[4]], source = "County Health Rankings 2025")
    if (row[[3]] == "percent") fields[[raw]]$unit <- "%"
    measures <- c(measures, raw)
  }
  lead <- unlist(l$lead)
  measures <- c(lead, setdiff(measures, lead))
  shaped <- st_sf(feature_id = geo$feature_id, as.data.frame(data, stringsAsFactors = FALSE),
                  geometry = st_geometry(geo))
  list(sf = shaped, graphs = built[[l$geometryFrom]]$graphs, fields = fields, measures = measures,
       source = list(url = l$url, sha256 = sha256(csv), terms = spec$terms[[l$terms]],
                     geometry = built[[l$geometryFrom]]$source$url))
}

# Outside Mississippi, counties come from the national cartographic boundary
# file. Tracts nest in counties, so two counties touch (at a point, or along a
# segment) exactly when some of their tracts do: the county graphs come from the
# state's tract graphs, built on full-resolution TIGER vertices.
build_counties <- function(l) {
  zip <- cached(ctx, l$url, national = TRUE)
  pin(ctx, paste0("layer_", l$id), l$url, zip, national = TRUE)
  x <- st_read(paste0("/vsizip/", zip), quiet = TRUE)
  x <- x[x$STATEFP == ctx$fips, ]
  stopifnot(nrow(x) > 0, !anyDuplicated(x$GEOID))
  x <- x[order(x$GEOID), ]
  ids <- x$GEOID
  tracts <- jsonlite::read_json(file.path(ctx$out, "neighbors.json"))
  county_graph <- function(graph) {
    out <- setNames(lapply(ids, function(k) character()), ids)
    for (tract in names(graph)) {
      from <- substr(tract, 1, 5)
      to <- substr(unlist(graph[[tract]]), 1, 5)
      out[[from]] <- union(out[[from]], setdiff(to, from))
    }
    lapply(out, function(n) I(sort(n)))
  }
  graphs <- lapply(tracts[c("queen", "rook")], county_graph)
  stopifnot(setequal(unique(substr(names(tracts$queen), 1, 5)), ids))
  list(sf = st_sf(feature_id = ids, name = x$NAMELSAD, geometry = st_geometry(x)), graphs = graphs,
       source = list(url = l$url, sha256 = sha256(zip), terms = spec$terms[[l$terms]]))
}

# Tabular layers borrow geometry from a downloaded layer, so those come first.
mississippi <- ctx$fips == "28"
# [[ ]] throughout: `$` on a list matches partial names ("keep" would find "outsideKeep").
layers <- Filter(function(l) if (mississippi) !isTRUE(l[["outside"]]) else !identical(l[["source"]] %||% "maris", "maris"), spec$layers)
if (!mississippi) layers <- lapply(layers, function(l) {
  if (!is.null(l[["outsideGeometry"]])) {
    l[["geometryFrom"]] <- l[["outsideGeometry"]]
    l[["keep"]] <- l[["outsideKeep"]] %||% l[["keep"]]
  }
  l
})
built <- list()
library_layers <- list()
is_chr <- vapply(layers, function(l) identical(l$source, "chr"), logical(1))
for (l in layers[!is_chr]) built[[l$id]] <- if (identical(l$source, "counties")) build_counties(l) else build_maris(l)
for (l in layers[is_chr]) built[[l$id]] <- build_chr(l, built)
is_listed <- function(l) !identical(l$source, "counties")
for (l in Filter(is_listed, layers)) {
  b <- built[[l$id]]
  written <- write_layer(b$sf, l$id, l$geometry, l[["keep"]] %||% 0.03)
  file <- paste0(l$id, ".geojson")
  files <- file
  entry <- list(
    id = l$id, name = l$name, group = l$group, geometry = l$geometry,
    file = paste0("layers/", file), count = nrow(b$sf), bbox = written$bbox, idField = "id",
    labelField = l$label, typeField = l$type, placeField = l$place, populationField = l$population,
    popupFields = I(unlist(l$popup)), measures = I(b$measures), fields = b$fields,
    style = list(color = l$color), credit = l$credit, vintage = l$vintage,
    dropped = if (isTRUE(b$dropped > 0)) b$dropped
  )
  if (!is.null(b$graphs)) {
    nb <- paste0(l$id, ".neighbors.json")
    jsonlite::write_json(b$graphs, file.path(stage, nb), auto_unbox = TRUE)
    entry$neighbors <- paste0("layers/", nb)
    files <- c(files, nb)
  }
  entry$bytes <- sum(file.size(file.path(stage, files)))
  entry$source <- c(b$source, list(output = setNames(lapply(files, function(f) sha256(file.path(stage, f))), files)))
  library_layers[[length(library_layers) + 1]] <- Filter(Negate(is.null), entry)
  stopifnot(all(file.copy(file.path(stage, files), output, overwrite = TRUE)))
  message(sprintf("%-34s %5d features %8.0f KB", l$id, nrow(b$sf), entry$bytes / 1024))
}
groups <- unlist(spec$groups)
used <- vapply(library_layers, function(x) x$group, character(1))
stopifnot(all(used %in% groups))
if (!mississippi) groups <- groups[groups %in% used]
library_json <- list(version = 1, region = ctx$id, groups = I(groups), layers = library_layers,
                     packages = lapply(setNames(nm = c("sf", "rmapshaper")), function(p) as.character(packageVersion(p))))
jsonlite::write_json(library_json, file.path(output, "library.json"), auto_unbox = TRUE, digits = NA, null = "null")
message("Wrote ", length(library_layers), " layers to ", output)
