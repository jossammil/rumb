#!/usr/bin/env Rscript
# Compares two builds of a region by meaning, not bytes: the committed folder
# and a fresh build of the same state. Run at the repository root:
#   Rscript scripts/compare-region.R COMMITTED BUILT [--geometry 1e-9]
# Every file the pipeline writes is compared when both folders have it:
#   - JSON values (ids, properties, neighbors, tables, sources) must be equal;
#     package versions and output checksums are reported, not compared;
#   - reference.json statistics must agree to 1e-12;
#   - coordinates must agree to --geometry degrees (default exact), because
#     simplification may differ in the last digits across GDAL, GEOS or
#     mapshaper versions (CI on Linux rounds some road vertices 1e-4° apart
#     from macOS; it compares with --geometry 2e-4, about 20 m);
#   - tracts.parquet columns must be equal and its geometries equal to the same
#     tolerance;
#   - the layer library (layers/*.geojson, *.neighbors.json, library.json) is
#     compared the same way; the output sizes and checksums library.json
#     records are reported through the files themselves, not compared;
#   - display GeoJSON shapes that differ beyond the coordinate tolerance are
#     compared as shapes: GEOS on Linux repairs and simplifies some old MARIS
#     polygons with a vertex more or less than macOS. A polygon passes when its
#     symmetric difference is at most 1% of its area, a line when the Hausdorff
#     distance is at most 250 m; points must match the coordinate tolerance.
#     Properties and ids stay exact, and so do the analytical GeoParquet
#     geometry and every neighbor file.
# Exits with status 1 and lists the differences when they do not match.
# R packages: jsonlite, arrow, sf, geojsonsf.
args <- commandArgs(trailingOnly = TRUE)
stopifnot(length(args) >= 2)
committed <- args[[1]]
built <- args[[2]]
tolerance <- if ("--geometry" %in% args) as.numeric(args[[match("--geometry", args) + 1]]) else 0
files <- c("tracts.geojson", "neighbors.json", "reference.json", "sources.json", "places-2025.json",
           "outline.geojson", "roads.geojson", "context.geojson",
           file.path("tables", c("index.json", "tracts-acs.json", "tracts-places.json",
                                 "tracts-centers.json", "counties-centers.json")))
layers <- list.files(file.path(committed, "layers"), "[.]json$|[.]geojson$")
files <- c(files, file.path("layers", layers))
ignored <- c("packages", "assets")
problems <- character()
notes <- character()
# Each file lists its first five problems and a count, so one file's many
# small differences cannot hide another's.
counts <- list()
report <- function(file, path, what) {
  counts[[file]] <<- (counts[[file]] %||% 0) + 1
  if (counts[[file]] <= 5)
    problems <<- c(problems, sprintf("%s %s: %s", file, if (length(path)) paste(path, collapse = "/") else "(top)", what))
}

suppressMessages(sf::sf_use_s2(FALSE))
# A display shape that differs beyond the coordinate tolerance: compare it as
# a shape, in metres (EPSG:5070), as described above.
same_shape <- function(a, b, file, path) {
  na <- unlist(a$coordinates); nb <- unlist(b$coordinates)
  if (identical(a$type, b$type) && length(na) == length(nb) && all(abs(na - nb) <= tolerance)) return(invisible())
  shape <- function(g) sf::st_transform(sf::st_make_valid(geojsonsf::geojson_sfc(as.character(jsonlite::toJSON(g, auto_unbox = TRUE, digits = NA)))), 5070)
  ga <- shape(a); gb <- shape(b)
  type <- as.character(sf::st_geometry_type(ga))
  if (grepl("POLYGON", type)) {
    area <- as.numeric(sf::st_area(ga))
    diff <- as.numeric(sf::st_area(sf::st_sym_difference(ga, gb)))
    if (length(diff) == 0) diff <- 0
    if (diff > 0.01 * area) report(file, path, sprintf("shapes differ by %.2f%% of the area", 100 * diff / area))
  } else if (grepl("LINESTRING", type)) {
    d <- as.numeric(sf::st_distance(ga, gb, which = "Hausdorff"))
    if (d > 250) report(file, path, sprintf("lines are %.0f m apart", d))
  } else report(file, path, "points moved")
}

# Walks two parsed JSON values side by side. `tol` applies to numbers.
same <- function(a, b, file, path = character(), tol = 0, coords = FALSE) {
  if ((counts[[file]] %||% 0) > 200) return(invisible())
  if (is.list(a) || is.list(b)) {
    if (!is.list(a) || !is.list(b)) return(report(file, path, "one side is a list"))
    if (!is.null(names(a)) || !is.null(names(b))) {
      keys <- union(names(a), names(b))
      if (!length(path)) keys <- setdiff(keys, ignored)
      # Sizes and checksums of the layer files are reported through the files.
      if (grepl("library[.]json$", file)) keys <- setdiff(keys, c("bytes", "output"))
      for (k in keys) {
        if (!k %in% names(a) || !k %in% names(b)) { report(file, c(path, k), "missing on one side"); next }
        if (k == "geometry" && grepl("[.]geojson$", file) && is.list(a[[k]]) && is.list(b[[k]])) {
          same_shape(a[[k]], b[[k]], file, c(path, k))
          next
        }
        # Bounding boxes are coordinates too (library.json rounds them to 4 decimals).
        same(a[[k]], b[[k]], file, c(path, k), tol, coords || k %in% c("coordinates", "bbox"))
      }
    } else {
      if (length(a) != length(b)) return(report(file, path, sprintf("%d against %d items", length(a), length(b))))
      for (i in seq_along(a)) same(a[[i]], b[[i]], file, c(path, i), tol, coords)
    }
    return(invisible())
  }
  if (is.numeric(a) && is.numeric(b)) {
    limit <- if (coords) tolerance else tol
    if (length(a) != length(b) || any(abs(a - b) > limit * pmax(1, if (coords) 1 else abs(a))))
      report(file, path, sprintf("%s against %s", format(a, digits = 17), format(b, digits = 17)))
    return(invisible())
  }
  if (!identical(a, b)) report(file, path, sprintf("%s against %s", paste(a), paste(b)))
}

for (f in files) {
  a <- file.path(committed, f)
  b <- file.path(built, f)
  if (!file.exists(a) && !file.exists(b)) next
  if (!file.exists(a) || !file.exists(b)) { report(f, character(), "exists on one side only"); next }
  x <- jsonlite::read_json(a)
  y <- jsonlite::read_json(b)
  same(x, y, f, tol = if (f == "reference.json") 1e-12 else 0)
  if (!identical(unname(tools::md5sum(a)), unname(tools::md5sum(b)))) notes <- c(notes, paste(f, "differs in bytes"))
}

a <- file.path(committed, "tracts.parquet")
b <- file.path(built, "tracts.parquet")
if (file.exists(a) && file.exists(b)) {
  x <- as.data.frame(arrow::read_parquet(a))
  y <- as.data.frame(arrow::read_parquet(b))
  if (!identical(names(x), names(y))) report("tracts.parquet", character(), "different columns")
  for (col in setdiff(intersect(names(x), names(y)), "geometry")) {
    if (!identical(x[[col]], y[[col]])) report("tracts.parquet", col, "values differ")
  }
  gx <- sf::st_as_sfc(structure(lapply(x$geometry, as.raw), class = "WKB"))
  gy <- sf::st_as_sfc(structure(lapply(y$geometry, as.raw), class = "WKB"))
  if (length(gx) != length(gy)) report("tracts.parquet", "geometry", "different row counts")
  else {
    exact <- vapply(seq_along(gx), function(i) identical(x$geometry[[i]], y$geometry[[i]]), logical(1))
    if (!all(exact)) {
      close <- vapply(which(!exact), function(i) isTRUE(sf::st_equals_exact(gx[i], gy[i], par = tolerance, sparse = FALSE)[1, 1]), logical(1))
      if (!all(close)) report("tracts.parquet", "geometry", sprintf("%d geometries differ", sum(!close)))
    }
  }
  if (!identical(unname(tools::md5sum(a)), unname(tools::md5sum(b)))) notes <- c(notes, "tracts.parquet differs in bytes")
}

if (length(notes)) message(paste("note:", notes, collapse = "\n"))
if (length(problems)) {
  message(paste(problems, collapse = "\n"))
  message(paste0(names(counts), ": ", unlist(counts), " problem(s)", collapse = "\n"))
  quit(status = 1)
}
message(built, " matches ", committed)
