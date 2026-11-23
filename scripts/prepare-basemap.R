# Rebuild the small public-domain backdrop: Natural Earth land, water, states and
# places, and Census TIGER primary and secondary roads for the state.
# Usage: Rscript scripts/prepare-basemap.R [roads] [--state MS] [--out DIR] [--cache DIR] [--pin]
# ("roads" rebuilds only the roads; options in scripts/lib/region.R).
suppressPackageStartupMessages(library(sf))
sf_use_s2(FALSE)
source("scripts/lib/region.R")
args <- commandArgs(trailingOnly = TRUE)
only_roads <- "roads" %in% args
ctx <- region_context(setdiff(args, "roads"))
if (!only_roads) {
inputs <- c(land="ne_50m_land", lakes="ne_50m_lakes", states="ne_50m_admin_1_states_provinces_lines",
            rivers="ne_10m_rivers_lake_centerlines", places="ne_10m_populated_places_simple")
# RUMB_NE_CACHE (or the older BGIS_NE_CACHE) points at a folder of cached downloads.
ne_cache <- function() Sys.getenv("RUMB_NE_CACHE", Sys.getenv("BGIS_NE_CACHE", tempdir()))
# The Natural Earth revision that reproduces the committed backdrop (REPRODUCIBILITY.md).
ne_revision <- Sys.getenv("RUMB_NE_REVISION", "ca96624a56bd078437bca8184e78163e5039ad19")
ne_url <- function(layer) paste0("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/", ne_revision, "/geojson/", layer, ".geojson")
clip <- st_bbox(c(xmin=-98,ymin=26,xmax=-82,ymax=39), crs=4326)
parts <- lapply(names(inputs), function(kind) {
  src <- inputs[[kind]]
  cache <- ne_cache()
  path <- file.path(cache, paste0("bgis-", src, ".geojson"))
  if (!file.exists(path)) download.file(ne_url(src), path, mode="wb")
  geo <- st_read(path, quiet=TRUE, wkt_filter=st_as_text(st_as_sfc(clip)))
  if (kind %in% c("land", "lakes")) geo <- st_make_valid(geo)
  geo <- suppressWarnings(st_crop(geo, clip))
  if (kind != "places") geo <- suppressWarnings(st_simplify(geo, dTolerance=.002))
  label <- if ("name" %in% names(geo)) as.character(geo$name) else rep("", nrow(geo))
  st_sf(kind=kind, name=label, geometry=st_geometry(geo))
})
context <- do.call(rbind, parts)
st_write(context, file.path(ctx$out, "context.geojson"), quiet=TRUE, delete_dsn=TRUE, layer_options="COORDINATE_PRECISION=4")
# The small global outline is requested when a user leaves the regional basemap.
global <- "ne_110m_land"
path <- file.path(ne_cache(), paste0("bgis-", global, ".geojson"))
if (!file.exists(path)) download.file(ne_url(global), path, mode="wb")
world <- st_sf(geometry=st_geometry(st_read(path, quiet=TRUE)))
st_write(world, file.path(ctx$out, "world-land.geojson"), quiet=TRUE, delete_dsn=TRUE, layer_options="COORDINATE_PRECISION=4")
}

# Census TIGER/Line 2024 primary (S1100) and secondary (S1200) roads. Only numbered
# routes are kept (unnamed and municipal street segments are clutter at this
# scale). Each route is dissolved into one feature per class and route, simplified
# to about 40 m and written with 4 decimals; `ref` is the short route label
# (I-55, US 49, MS 25; the state route prefix is the state's abbreviation).
roads_url <- sprintf("https://www2.census.gov/geo/tiger/TIGER2024/PRISECROADS/tl_2024_%s_prisecroads.zip", ctx$fips)
roads_zip <- cached(ctx, roads_url)
pin(ctx, "tiger_roads", roads_url, roads_zip)
roads <- st_read(paste0("/vsizip/", roads_zip), quiet = TRUE)
stopifnot(all(roads$MTFCC %in% c("S1100", "S1200")))
roads$class <- ifelse(roads$MTFCC == "S1100", "primary", "secondary")
number <- sub("^.*?([0-9]+[A-Z]?).*$", "\\1", roads$FULLNAME)
has_number <- grepl("[0-9]", roads$FULLNAME)
roads$ref <- ifelse(has_number & roads$RTTYP == "I", paste0("I-", number),
             ifelse(has_number & roads$RTTYP == "U", paste0("US ", number),
             ifelse(has_number & roads$RTTYP == "S", paste(ctx$abbr, number), NA_character_)))

roads <- st_transform(roads[!is.na(roads$ref), ], metric_crs(ctx))
key <- paste(roads$class, roads$ref, sep = "|")
merged <- do.call(rbind, lapply(split(seq_len(nrow(roads)), key), function(rows) {
  line <- st_line_merge(st_cast(st_union(st_geometry(roads)[rows]), "MULTILINESTRING"))
  st_sf(class = roads$class[rows[1]], name = roads$ref[rows[1]], ref = roads$ref[rows[1]], geometry = line)
}))
merged <- st_transform(st_simplify(merged, dTolerance = 40, preserveTopology = FALSE), "OGC:CRS84")
merged <- merged[!st_is_empty(merged), ]
merged <- merged[order(merged$class == "primary", merged$ref), ]
st_write(merged, file.path(ctx$out, "roads.geojson"), quiet = TRUE, delete_dsn = TRUE,
         layer_options = c("COORDINATE_PRECISION=4", "RFC7946=YES", "WRITE_NAME=NO"))
message("Wrote ", nrow(merged), " road routes; TIGER ZIP SHA-256 ",
        digest::digest(roads_zip, algo = "sha256", file = TRUE))
