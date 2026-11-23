#!/usr/bin/env Rscript
# Reference values for the statistics in src/stats/, computed in R from the
# committed data files, so the JS can be checked against independent code.
# Writes tests/stats-reference.json. Run at the repository root:
#   Rscript scripts/reference-stats.R
# R packages: jsonlite, sf, spdep.
out <- list(R = R.version.string)

# ---- probability distributions -------------------------------------------------
grid <- function(...) expand.grid(..., KEEP.OUT.ATTRS = FALSE)
cases <- list()
x <- c(-38, -30, -20, -10, -8.5, -5, -3, -2, -1.96, -1, -0.5, -1e-3, 0, 0.3, 1, 1.645, 2.5, 5, 8, 10)
cases$pnorm <- data.frame(x = x, lower = pnorm(x), upper = pnorm(x, lower.tail = FALSE))
p <- c(1e-300, 1e-100, 1e-20, 1e-10, 1e-5, 0.001, 0.025, 0.05, 0.1, 0.3, 0.5, 0.7, 0.9, 0.975, 0.999, 1 - 1e-10)
cases$qnorm <- data.frame(p = p, x = qnorm(p))
g <- grid(t = c(-50, -5, -2.5, -1, 0, 0.5, 1.96, 3, 10, 40), df = c(1, 2.5, 5, 10, 30, 100, 870))
cases$pt <- transform(g, lower = pt(t, df), upper = pt(t, df, lower.tail = FALSE))
g <- grid(p = c(1e-10, 0.001, 0.025, 0.05, 0.5, 0.9, 0.975, 0.995), df = c(1, 3, 10, 30, 870))
cases$qt <- transform(g, x = qt(p, df))
g <- grid(f = c(0.01, 0.5, 1, 2, 5, 20, 200), pair = 1:5)
d <- rbind(c(1, 1), c(2, 10), c(5, 30), c(3, 870), c(30, 30))
g$d1 <- d[g$pair, 1]
g$d2 <- d[g$pair, 2]
g$pair <- NULL
cases$pf <- transform(g, lower = pf(f, d1, d2), upper = pf(f, d1, d2, lower.tail = FALSE))
g <- grid(x = c(0.001, 0.1, 1, 3.84, 10, 50, 300), k = c(1, 2, 3, 10, 100))
cases$pchisq <- transform(g, lower = pchisq(x, k), upper = pchisq(x, k, lower.tail = FALSE))
g <- grid(p = c(1e-10, 0.001, 0.025, 0.5, 0.975, 0.999, 1 - 1e-12), k = c(1, 2, 5, 30, 200, 2000))
cases$qchisq <- transform(g, x = qchisq(p, k))
g <- grid(p = c(1e-8, 0.025, 0.5, 0.975), shape = c(0.01, 0.5, 1, 3.5, 50, 1e4, 5e5))
cases$qgamma <- transform(g, x = qgamma(p, shape))
g <- grid(k = c(0, 1, 5, 20, 100, 1000), lambda = c(0.1, 1, 5, 20, 100, 1000))
cases$ppois <- transform(g, lower = ppois(k, lambda), upper = ppois(k, lambda, lower.tail = FALSE))
x <- c(0.001, 0.5, 1, 1.5, 2, 3.7, 10, 30.5, 100, 1e4, 1e7)
cases$lgamma <- data.frame(x = x, y = lgamma(x))
counts <- c(0, 1, 4, 10, 19, 20, 57, 300, 5000, 560000)
ci <- t(vapply(counts, function(k) poisson.test(k)$conf.int, numeric(2)))
cases$poissonCI <- data.frame(count = counts, lower = ci[, 1], upper = ci[, 2])
out$distributions <- cases

# ---- distance weights and Moran's I on tract centers of population ---------------
suppressPackageStartupMessages({
  library(sf)
  library(spdep)
})
centers <- jsonlite::read_json("public/data/ms/tables/tracts-centers.json", simplifyVector = TRUE)
tracts <- st_read("public/data/ms/tracts.geojson", quiet = TRUE)
x <- tracts$poverty_pct[match(centers$ids, tracts$GEOID)]
ok <- is.finite(x)
ids <- centers$ids[ok]
stopifnot(!is.unsorted(ids))
# Census centers are NAD83 longitude and latitude; EPSG:3814 is NAD83 / Mississippi TM.
pts <- st_transform(st_as_sf(data.frame(lon = centers$lon[ok], lat = centers$lat[ok]),
                             coords = c("lon", "lat"), crs = 4269), 3814)
xy <- unname(st_coordinates(pts))
v <- x[ok]
index_lists <- function(nb) lapply(nb, function(j) I(as.integer(j) - 1L))
moran_I <- function(nb, glist = NULL) {
  # Inverse squared distances give some rows tiny totals, which nb2listw warns
  # about; the statistic still matches matrix algebra to 1e-13.
  lw <- suppressWarnings(nb2listw(nb, glist = glist, style = "W"))
  moran(v, lw, length(nb), Szero(lw))$I
}
k6 <- knn2nb(knearneigh(xy, k = 6))
k6s <- make.sym.nb(k6)
nearest <- knn2nb(knearneigh(xy, k = 1))
threshold <- max(unlist(nbdists(nearest, xy))) * (1 + 1e-9)
connected <- suppressWarnings(dnearneigh(xy, 0, threshold))  # three sub-graphs, none alone
band25 <- suppressWarnings(dnearneigh(xy, 0, 25 * 1609.344))
stopifnot(all(card(connected) > 0), all(card(band25) > 0))
inverse <- function(nb, p) lapply(nbdists(nb, xy), function(d) 1 / pmax(d, 1)^p)
out$weights <- list(
  ids = I(ids), xy = xy, values = v,
  knn6 = index_lists(k6), knn6sym = index_lists(k6s),
  threshold = threshold, connected = index_lists(connected), band25cards = I(card(band25)),
  moran = list(
    knn6 = moran_I(k6), knn6sym = moran_I(k6s), connected = moran_I(connected), band25 = moran_I(band25),
    idw1 = moran_I(connected, inverse(connected, 1)), idw2 = moran_I(connected, inverse(connected, 2)),
    idw25 = moran_I(band25, inverse(band25, 1))
  )
)

# Area-weighted centroids of display polygons in EPSG:3814 (GEOS).
centroid_of <- function(file, n = Inf) {
  g <- st_read(file, quiet = TRUE)
  g <- g[seq_len(min(n, nrow(g))), ]
  c <- st_coordinates(st_centroid(st_geometry(st_transform(g, 3814))))
  unname(c)
}
out$centroids <- list(
  counties = centroid_of("public/data/ms/layers/chr_counties_2025.geojson"),
  tracts = centroid_of("public/data/ms/tracts.geojson", 120)
)
# ---- hot spots: Gi*, General G and Geary's C -------------------------------------
# Contiguity over the shipped queen graph among tracts with a value and an
# eligible neighbor; distance weights over the centers above. Gi* includes
# each tract in its own neighborhood; with inverse distance its self weight is
# the row's largest weight.
graph <- jsonlite::read_json("public/data/ms/neighbors.json")$queen
all_ids <- tracts$GEOID
valid <- all_ids[is.finite(tracts$poverty_pct)]
connected_ids <- sort(valid[vapply(valid, function(id) any(unlist(graph[[id]]) %in% valid), logical(1))])
queen <- structure(lapply(connected_ids, function(id) sort(match(intersect(unlist(graph[[id]]), connected_ids), connected_ids))),
                   class = "nb", region.id = connected_ids)
qx <- tracts$poverty_pct[match(connected_ids, all_ids)]
self_weights <- function(nb, glist) lapply(seq_along(nb), function(i) c(max(glist[[i]]), glist[[i]]))
gi <- function(nb, x, glist = NULL) {
  nb_self <- include.self(nb)
  if (!is.null(glist)) {
    # include.self puts i first in each sorted row only by chance; place its weight by position.
    glist <- lapply(seq_along(nb), function(i) {
      w <- c(max(glist[[i]]), glist[[i]])[order(c(i, nb[[i]]))]
      w
    })
  }
  as.numeric(localG(x, nb2listw(nb_self, glist = glist, style = "B")))
}
global_g <- function(nb, x) {
  t <- globalG.test(x, nb2listw(nb, style = "B"), alternative = "two.sided")
  list(G = unname(t$estimate[1]), expected = unname(t$estimate[2]), variance = unname(t$estimate[3]))
}
geary_c <- function(nb, x) {
  t <- geary.test(x, nb2listw(nb, style = "W"), randomisation = TRUE, alternative = "two.sided")
  list(C = unname(t$estimate[1]), expected = unname(t$estimate[2]), variance = unname(t$estimate[3]))
}
out$hotspots <- list(
  queen = list(ids = I(connected_ids), gi = gi(queen, qx), generalG = global_g(queen, qx), geary = geary_c(queen, qx)),
  knn6 = list(gi = gi(k6, v), generalG = global_g(k6, v), geary = geary_c(k6, v)),
  connected = list(gi = gi(connected, v)),
  idw1 = list(gi = gi(connected, v, inverse(connected, 1)))
)

# ---- LISA variants: bivariate Local Moran and EB-adjusted Moran ----------------------
# Over the queen graph's connected tracts above: poverty against child poverty
# (both present), and the EB-standardized poverty rate from its counts.
qy <- tracts$child_poverty_pct[match(connected_ids, all_ids)]
both <- is.finite(qy)
bi_ids <- connected_ids[both]
sub <- subset(queen, both)
stopifnot(all(card(sub) > 0))
bx <- qx[both]
by <- qy[both]
lw_sub <- nb2listw(sub, style = "W")
zx <- as.numeric(scale(bx))
zy <- as.numeric(scale(by))
bv <- localmoran_bv(bx, by, lw_sub, nsim = 99, iseed = 1)
events <- tracts$poverty_count[match(connected_ids, all_ids)]
base <- tracts$poverty_universe[match(connected_ids, all_ids)]
lw_q <- nb2listw(queen, style = "W")
ebi <- EBImoran.mc(events, base, lw_q, nsim = 99)
p <- events / base
b <- sum(events) / sum(base)
s2 <- sum(base * (p - b)^2) / sum(base)
a <- s2 - b / (sum(base) / length(base))
if (a < 0) a <- b / (sum(base) / length(base))
out$variants <- list(
  bivariate = list(ids = I(bi_ids), localI = as.numeric(bv[, "Ibvi"]),
                   globalI = sum(zx * lag.listw(lw_sub, zy)) / sum(zx * zx)),
  eb = list(ids = I(connected_ids), I = unname(ebi$statistic), a = a, b = b, z = (p - b) / sqrt(a + b / base))
)

out$packages <- list(sf = as.character(packageVersion("sf")), spdep = as.character(packageVersion("spdep")))

jsonlite::write_json(out, "tests/stats-reference.json", digits = NA, auto_unbox = TRUE, dataframe = "rows")
message("Wrote tests/stats-reference.json")
