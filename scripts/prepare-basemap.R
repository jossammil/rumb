# Rebuild the small public-domain Natural Earth backdrop. Usage: Rscript scripts/prepare-basemap.R
suppressPackageStartupMessages(library(sf))
sf_use_s2(FALSE)
inputs <- c(land="ne_50m_land", lakes="ne_50m_lakes", states="ne_50m_admin_1_states_provinces_lines",
            rivers="ne_10m_rivers_lake_centerlines", places="ne_10m_populated_places_simple")
clip <- st_bbox(c(xmin=-98,ymin=26,xmax=-82,ymax=39), crs=4326)
parts <- lapply(names(inputs), function(kind) {
  src <- inputs[[kind]]
  cache <- Sys.getenv("BGIS_NE_CACHE", tempdir())
  path <- file.path(cache, paste0("bgis-", src, ".geojson"))
  if (!file.exists(path)) download.file(paste0("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/", src, ".geojson"), path, mode="wb")
  geo <- st_read(path, quiet=TRUE, wkt_filter=st_as_text(st_as_sfc(clip)))
  if (kind %in% c("land", "lakes")) geo <- st_make_valid(geo)
  geo <- suppressWarnings(st_crop(geo, clip))
  if (kind != "places") geo <- suppressWarnings(st_simplify(geo, dTolerance=.002))
  label <- if ("name" %in% names(geo)) as.character(geo$name) else rep("", nrow(geo))
  st_sf(kind=kind, name=label, geometry=st_geometry(geo))
})
context <- do.call(rbind, parts)
st_write(context, "public/data/context.geojson", quiet=TRUE, delete_dsn=TRUE, layer_options="COORDINATE_PRECISION=4")
# The small global outline is requested when a user leaves the regional basemap.
global <- "ne_110m_land"
path <- file.path(Sys.getenv("BGIS_NE_CACHE", tempdir()), paste0("bgis-", global, ".geojson"))
if (!file.exists(path)) download.file(paste0("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/", global, ".geojson"), path, mode="wb")
world <- st_sf(geometry=st_geometry(st_read(path, quiet=TRUE)))
st_write(world, "public/data/world-land.geojson", quiet=TRUE, delete_dsn=TRUE, layer_options="COORDINATE_PRECISION=4")
