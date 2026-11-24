#!/usr/bin/env Rscript
# Compares two builds of a region by meaning, not bytes: the committed folder
# and a fresh build of the same state. Run at the repository root:
#   Rscript scripts/compare-region.R COMMITTED BUILT [--geometry 1e-9]
# Every file the pipeline writes is compared when both folders have it:
#   - JSON values (ids, properties, neighbors, tables, sources) must be equal;
#     package versions and output checksums are reported, not compared;
#   - reference.json statistics must agree to 1e-12;
#   - coordinates must agree to --geometry degrees (default exact), because
#     simplification may differ in the last digits across GDAL or mapshaper
#     versions;
#   - tracts.parquet columns must be equal and its geometries equal to the same
#     tolerance;
#   - the layer library (layers/*.geojson, *.neighbors.json, library.json) is
#     compared the same way; output checksums inside library.json are reported
#     through the files themselves.
# Exits with status 1 and lists the differences when they do not match.
# R packages: jsonlite, arrow, sf.
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
report <- function(file, path, what) {
  problems <<- c(problems, sprintf("%s %s: %s", file, if (length(path)) paste(path, collapse = "/") else "(top)", what))
}

# Walks two parsed JSON values side by side. `tol` applies to numbers.
same <- function(a, b, file, path = character(), tol = 0, coords = FALSE) {
  if (length(problems) > 40) return(invisible())
  if (is.list(a) || is.list(b)) {
    if (!is.list(a) || !is.list(b)) return(report(file, path, "one side is a list"))
    if (!is.null(names(a)) || !is.null(names(b))) {
      keys <- union(names(a), names(b))
      if (!length(path)) keys <- setdiff(keys, ignored)
      for (k in keys) {
        if (!k %in% names(a) || !k %in% names(b)) { report(file, c(path, k), "missing on one side"); next }
        same(a[[k]], b[[k]], file, c(path, k), tol, coords || k == "coordinates")
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
  quit(status = 1)
}
message(built, " matches ", committed)
