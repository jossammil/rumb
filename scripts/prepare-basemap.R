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
# The Natural Earth revision that reproduces the committed backdrop (REPRODUCIBILITY.md).
ne_revision <- Sys.getenv("RUMB_NE_REVISION", "ca96624a56bd078437bca8184e78163e5039ad19")
ne_url <- function(layer) paste0("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/", ne_revision, "/geojson/", layer, ".geojson")
# RUMB_NE_CACHE (or the older BGIS_NE_CACHE) may point at a folder of earlier downloads.
ne_file <- function(layer) {
  old <- file.path(Sys.getenv("RUMB_NE_CACHE", Sys.getenv("BGIS_NE_CACHE", "")), paste0("bgis-", layer, ".geojson"))
  path <- if (file.exists(old)) old else cached(ctx, ne_url(layer), paste0("ne-", layer, ".geojson"), national = TRUE)
  pin(ctx, layer, ne_url(layer), path, national = TRUE)
  path
}

# The backdrop extends 6° of longitude and 4° of latitude past the state, in
# whole degrees (Mississippi: 98°W–82°W, 26°N–39°N).
states_url <- "https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_state_500k.zip"
states_zip <- cached(ctx, states_url, national = TRUE)
pin(ctx, "cb_states", states_url, states_zip, national = TRUE)
states <- st_transform(st_read(paste0("/vsizip/", states_zip), quiet = TRUE), 4326)
states <- region_lonlat(states, ctx)
state <- states[states$STATEFP == ctx$fips, ]
stopifnot(nrow(state) == 1)
b <- st_bbox(state)
extent <- unname(c(round(b[["xmin"]] - 6), max(-85, round(b[["ymin"]] - 4)),
                   round(b[["xmax"]] + 6), min(85, round(b[["ymax"]] + 4))))
box <- function(e, crs = 4326) st_bbox(c(xmin = e[1], ymin = e[2], xmax = e[3], ymax = e[4]), crs = crs)
# Alaska's extent runs past 180°W: crop the far side separately and move it west.
crop_extent <- function(geo) {
  if (extent[1] >= -180) return(suppressWarnings(st_crop(geo, box(extent, st_crs(geo)))))
  west <- suppressWarnings(st_crop(geo, box(c(extent[1] + 360, extent[2], 180, extent[4]), st_crs(geo))))
  east <- suppressWarnings(st_crop(geo, box(c(-180, extent[2], extent[3], extent[4]), st_crs(geo))))
  if (nrow(west)) west <- st_set_geometry(west, st_set_crs(st_geometry(west) - c(360, 0), st_crs(geo)))
  rbind(west, east)
}
parts <- lapply(names(inputs), function(kind) {
  path <- ne_file(inputs[[kind]])
  geo <- if (extent[1] >= -180) st_read(path, quiet=TRUE, wkt_filter=st_as_text(st_as_sfc(box(extent))))
         else st_read(path, quiet=TRUE)
  if (kind %in% c("land", "lakes")) geo <- st_make_valid(geo)
  geo <- crop_extent(geo)
  if (kind != "places") geo <- suppressWarnings(st_simplify(geo, dTolerance=.002))
  label <- if ("name" %in% names(geo)) as.character(geo$name) else rep("", nrow(geo))
  st_sf(kind=rep(kind, nrow(geo)), name=label, geometry=st_geometry(geo))
})
context <- do.call(rbind, parts)
st_write(context, file.path(ctx$out, "context.geojson"), quiet=TRUE, delete_dsn=TRUE, layer_options="COORDINATE_PRECISION=4")
# The small global outline is requested when a user leaves the regional basemap.
world <- st_sf(geometry=st_geometry(st_read(ne_file("ne_110m_land"), quiet=TRUE)))
st_write(world, file.path(ctx$out, "world-land.geojson"), quiet=TRUE, delete_dsn=TRUE, layer_options="COORDINATE_PRECISION=4")

# Labels for the catalog: the nearest other states that show in the extent, at
# a point inside their visible part, and the first listed point of each nearby sea or lake
# that lies in the extent on open water. Written to .cache/build/<id>/backdrop.json
# for the catalog; Mississippi's committed catalog keeps its hand-placed labels.
view <- st_as_sfc(box(extent))
others <- suppressWarnings(st_intersection(states[states$STATEFP != ctx$fips, ], view))
# Only states with at least 10,000 km² in view, the 8 nearest to the state
# (Hawaii and Alaska have none).
others <- others[!st_is_empty(others), ]
others <- others[as.numeric(st_area(st_transform(others, metric_crs(ctx)))) > 1e10, ]
labels <- list()
if (nrow(others)) {
  surface <- suppressWarnings(st_point_on_surface(st_geometry(others)))
  near <- order(as.numeric(st_distance(st_transform(surface, metric_crs(ctx)), st_transform(st_geometry(state), metric_crs(ctx)))))
  others <- others[head(near, 8), ]
  spots <- st_coordinates(surface[head(near, 8)])
  labels <- lapply(seq_len(nrow(others)), function(k) list(toupper(others$NAME[k]), round(spots[k, 1], 2), round(spots[k, 2], 2)))
}
waters <- jsonlite::read_json("scripts/waters.json")$waters
land <- st_union(st_make_valid(parts[[1]]))
for (w in waters) {
  for (p in w$at) {
    pt <- st_sfc(st_point(c(p[[1]], p[[2]])), crs = 4326)
    inside <- p[[1]] > extent[1] && p[[1]] < extent[3] && p[[2]] > extent[2] && p[[2]] < extent[4]
    if (inside && !lengths(st_intersects(pt, land))) { labels[[length(labels) + 1]] <- list(w$name, p[[1]], p[[2]]); break }
  }
}
bounds <- round(unname(c(b[["xmin"]], b[["ymin"]], b[["xmax"]], b[["ymax"]])), 2)
write_json_file(list(bounds = list(bounds[1:2], bounds[3:4]), extent = extent, labels = labels),
                file.path(ctx$build, "backdrop.json"), digits = 6)
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
merged <- region_lonlat(st_transform(st_simplify(merged, dTolerance = 40, preserveTopology = FALSE), "OGC:CRS84"), ctx)
merged <- merged[!st_is_empty(merged), ]
merged <- merged[order(merged$class == "primary", merged$ref), ]
st_write(merged, file.path(ctx$out, "roads.geojson"), quiet = TRUE, delete_dsn = TRUE,
         layer_options = c("COORDINATE_PRECISION=4", rfc7946(ctx), "WRITE_NAME=NO"))
message("Wrote ", nrow(merged), " road routes; TIGER ZIP SHA-256 ",
        digest::digest(roads_zip, algo = "sha256", file = TRUE))
