#!/usr/bin/env Rscript
# Independent projected coordinates for tests/geo.test.js, from PROJ through sf:
# - a grid of NAD83 longitude/latitude points over Mississippi and its
#   neighbors, projected to EPSG:3814 (Mississippi Transverse Mercator);
# - Albers equal-area cases: EPSG:5070 (CONUS), EPSG:3338 (Alaska, with
#   Aleutian points on both sides of 180°) and a custom Texas Albers whose
#   standard parallels sit at 1/6 and 5/6 of Texas' latitude range.
# Each case is projected forward by sf, and its projected points inverted by
# sf back to longitude/latitude.
# Run at the repository root: Rscript scripts/reference-geo.R
suppressPackageStartupMessages(library(sf))
grid <- expand.grid(lon = seq(-94, -86, by = 0.5), lat = seq(29, 36, by = 0.5))
grid <- rbind(grid, data.frame(lon = c(-90.18, -88.08, -91.66, -98), lat = c(32.3, 30.16, 35.02, 26)))
pts <- st_transform(st_as_sf(grid, coords = c("lon", "lat"), crs = 4269), 3814)
xy <- st_coordinates(pts)
out <- list(
  crs = "EPSG:4269 to EPSG:3814", proj = sf_extSoftVersion()[["PROJ"]],
  points = lapply(seq_len(nrow(grid)), function(i) c(grid$lon[i], grid$lat[i], xy[i, 1], xy[i, 2]))
)

grs80 <- list(a = 6378137, rf = 298.257222101)
aea_proj <- function(p) {
  sprintf("+proj=aea +lat_0=%s +lon_0=%s +lat_1=%s +lat_2=%s +x_0=%s +y_0=%s +datum=NAD83 +units=m +no_defs",
          p$lat0, p$lon0, p$lat1, p$lat2, p$x0, p$y0)
}
# Forward: [lon, lat, x, y] from lon/lat. Inverse: [x, y, lon, lat] from sf's
# own projected points, so the two directions are checked separately.
albers_case <- function(name, crs, aea, lonlat) {
  fwd <- st_coordinates(st_transform(st_as_sf(lonlat, coords = c("lon", "lat"), crs = 4269), crs))
  back <- st_coordinates(st_transform(st_as_sf(data.frame(x = fwd[, 1], y = fwd[, 2]), coords = c("x", "y"), crs = crs), 4269))
  # PROJ's geographic output stays in [-180, 180].
  list(
    name = name, crs = if (is.numeric(crs)) paste0("EPSG:", crs) else crs, aea = aea, proj = aea_proj(aea),
    forward = lapply(seq_len(nrow(lonlat)), function(i) c(lonlat$lon[i], lonlat$lat[i], fwd[i, 1], fwd[i, 2])),
    inverse = lapply(seq_len(nrow(lonlat)), function(i) c(fwd[i, 1], fwd[i, 2], back[i, 1], back[i, 2]))
  )
}

conus <- expand.grid(lon = seq(-125, -66, by = 2.5), lat = seq(24, 50, by = 2))
conus_aea <- c(list(lat0 = 23, lon0 = -96, lat1 = 29.5, lat2 = 45.5, x0 = 0, y0 = 0), grs80)

# Alaska, and the Aleutians west of 180° (positive longitudes) and east of it.
alaska <- rbind(
  expand.grid(lon = seq(-180, -130, by = 2.5), lat = seq(51, 71, by = 2)),
  expand.grid(lon = c(172.5, 175, 177.5, 179.5), lat = c(51, 52, 53, 55)),
  data.frame(lon = c(172.9, 173.5, 179.1, -179.9, -178.1, -176.6, -172.5, -166.5),
             lat = c(52.9, 52.4, 51.4, 51.8, 51.8, 51.9, 52.5, 53.9))
)
alaska_aea <- c(list(lat0 = 50, lon0 = -154, lat1 = 55, lat2 = 65, x0 = 0, y0 = 0), grs80)

# Texas spans 25.84°N to 36.50°N and 106.65°W to 93.51°W; parallels at 1/6
# and 5/6 of the latitude range, rounded to 1e-4°, origin at the centre.
tx <- c(w = -106.65, s = 25.84, e = -93.51, n = 36.5)
texas_aea <- c(list(
  lat0 = round((tx[["s"]] + tx[["n"]]) / 2, 4), lon0 = round((tx[["w"]] + tx[["e"]]) / 2, 4),
  lat1 = round(tx[["s"]] + (tx[["n"]] - tx[["s"]]) / 6, 4), lat2 = round(tx[["s"]] + 5 * (tx[["n"]] - tx[["s"]]) / 6, 4),
  x0 = 0, y0 = 0
), grs80)
texas <- expand.grid(lon = seq(-107, -93, by = 1), lat = seq(25.5, 37, by = 0.5))

out$albers <- list(
  albers_case("CONUS Albers", 5070, conus_aea, conus),
  albers_case("Alaska Albers", 3338, alaska_aea, alaska),
  albers_case("Texas Albers", aea_proj(texas_aea), texas_aea, texas)
)
jsonlite::write_json(out, "tests/geo-reference.json", auto_unbox = TRUE, digits = NA)
message("Wrote ", nrow(grid), " EPSG:3814 points and ",
        nrow(conus) + nrow(alaska) + nrow(texas), " Albers points to tests/geo-reference.json")
