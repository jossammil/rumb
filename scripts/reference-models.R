#!/usr/bin/env Rscript
# Reference values for rumb's models (src/stats/linalg.js and the regression,
# access and point-pattern modules), computed in R from the committed data
# files. Writes tests/models-reference.json. Run at the repository root:
#   Rscript scripts/reference-models.R
# R packages: jsonlite, sf (later sections add spdep, spatialreg, lmtest, MASS).
suppressPackageStartupMessages(library(sf))
out <- list(R = R.version.string)

# ---- the data: tracts with their ACS and PLACES tables ---------------------------
table_frame <- function(file) {
  t <- jsonlite::read_json(file, simplifyVector = TRUE)
  data.frame(GEOID = t$ids, as.data.frame(lapply(t$columns, function(v) as.numeric(unlist(lapply(v, function(x) if (is.null(x)) NA else x))))))
}
tracts <- st_drop_geometry(st_read("public/data/ms/tracts.geojson", quiet = TRUE))
acs <- table_frame("public/data/ms/tables/tracts-acs.json")
places <- table_frame("public/data/ms/tables/tracts-places.json")
d <- merge(merge(tracts, acs, by = "GEOID"), places, by = "GEOID")
d <- d[order(d$GEOID), ]
covariates <- c("acs_uninsured_pct", "acs_age65_pct", "acs_no_vehicle_pct", "acs_bachelors_pct")
outcome <- "places_diabetes"
complete <- complete.cases(d[, c(outcome, covariates)])
m <- d[complete, ]

# ---- linear algebra -------------------------------------------------------------------
X <- cbind(1, as.matrix(m[, covariates]))
y <- m[[outcome]]
q <- qr(X)
neighbors <- jsonlite::read_json("public/data/ms/neighbors.json")$queen
similar <- function(ids, graph) {
  A <- matrix(0, length(ids), length(ids))
  for (i in seq_along(ids)) A[i, match(intersect(unlist(graph[[ids[i]]]), ids), ids)] <- 1
  stopifnot(isSymmetric(A), all(rowSums(A) > 0))
  dh <- 1 / sqrt(rowSums(A))
  A * outer(dh, dh)
}
chr_graph <- jsonlite::read_json("public/data/ms/layers/chr_counties_2025.neighbors.json")$queen
chr_ids <- sort(names(chr_graph))
tract_ids <- m$GEOID[vapply(m$GEOID, function(id) any(unlist(neighbors[[id]]) %in% m$GEOID), logical(1))]
out$linalg <- list(
  ids = I(m$GEOID), covariates = I(covariates), outcome = outcome,
  coef = unname(qr.coef(q, y)),
  xtxInverse = unname(chol2inv(qr.R(q))),
  cholesky = unname(t(chol(crossprod(X)))),
  eigenCounties = sort(eigen(similar(chr_ids, chr_graph), symmetric = TRUE, only.values = TRUE)$values),
  eigenTractIds = I(tract_ids),
  eigenTracts = sort(eigen(similar(tract_ids, neighbors), symmetric = TRUE, only.values = TRUE)$values)
)

# ---- OLS and its diagnostics -------------------------------------------------------------
# The tracts with every variable and at least one queen neighbor among them.
suppressPackageStartupMessages({
  library(spdep)
  library(lmtest)
})
r <- m[match(tract_ids, m$GEOID), ]
fit <- lm(reformulate(covariates, outcome), data = r)
sm <- summary(fit)
Xr <- model.matrix(fit)
e <- residuals(fit)
mom <- function(k) mean((e - mean(e))^k)
jb <- length(e) / 6 * ((mom(3) / mom(2)^1.5)^2 + (mom(4) / mom(2)^2 - 3)^2 / 4)
vifs <- vapply(covariates, function(v) {
  aux <- summary(lm(reformulate(setdiff(covariates, v), v), data = r))
  1 / (1 - aux$r.squared)
}, numeric(1))
unit <- sweep(Xr, 2, sqrt(colSums(Xr^2)), "/")
ev <- eigen(crossprod(unit), symmetric = TRUE, only.values = TRUE)$values
queen_nb <- structure(lapply(tract_ids, function(id) sort(match(intersect(unlist(neighbors[[id]]), tract_ids), tract_ids))),
                      class = "nb", region.id = tract_ids)
centers <- jsonlite::read_json("public/data/ms/tables/tracts-centers.json", simplifyVector = TRUE)
pts <- st_transform(st_as_sf(data.frame(lon = centers$lon, lat = centers$lat)[match(tract_ids, centers$ids), ],
                             coords = c("lon", "lat"), crs = 4269), 3814)
knn_nb <- knn2nb(knearneigh(st_coordinates(pts), k = 6))
spatial <- function(nb) {
  lw <- nb2listw(nb, style = "W")
  mt <- lm.morantest(fit, lw, alternative = "two.sided")
  rs <- lm.RStests(fit, lw, test = "all")
  list(I = unname(mt$estimate[1]), expected = unname(mt$estimate[2]), variance = unname(mt$estimate[3]),
       lmError = unname(rs$RSerr$statistic), lmLag = unname(rs$RSlag$statistic),
       robustLmError = unname(rs$adjRSerr$statistic), robustLmLag = unname(rs$adjRSlag$statistic),
       sarma = unname(rs$SARMA$statistic))
}
out$ols <- list(
  ids = I(tract_ids),
  coef = unname(coef(fit)), se = unname(sm$coefficients[, 2]), t = unname(sm$coefficients[, 3]), p = unname(sm$coefficients[, 4]),
  sigma = sm$sigma, r2 = sm$r.squared, adjR2 = sm$adj.r.squared,
  F = unname(sm$fstatistic[1]), logLik = as.numeric(logLik(fit)), aic = AIC(fit), sc = BIC(fit),
  vif = unname(vifs), conditionNumber = sqrt(max(ev) / min(ev)), jarqueBera = jb,
  breuschPagan = unname(bptest(fit, studentize = FALSE)$statistic), koenker = unname(bptest(fit, studentize = TRUE)$statistic),
  queen = spatial(queen_nb), knn6 = spatial(knn_nb), knn6Ids = I(tract_ids)
)

# ---- spatial lag and spatial error models (maximum likelihood, eigenvalues) ---------------
suppressPackageStartupMessages(library(spatialreg))
xy_r <- st_coordinates(pts)
band_nb <- dnearneigh(xy_r, 0, max(unlist(nbdists(knn2nb(knearneigh(xy_r, k = 1)), xy_r))) * (1 + 1e-9))
spatial_fits <- function(nb) {
  lw <- nb2listw(nb, style = "W")
  lag <- lagsarlm(reformulate(covariates, outcome), data = r, listw = lw, method = "eigen", quiet = TRUE)
  err <- errorsarlm(reformulate(covariates, outcome), data = r, listw = lw, method = "eigen", quiet = TRUE)
  imp <- impacts(lag, listw = lw)
  ls <- summary(lag)
  es <- summary(err)
  list(
    lag = list(rho = unname(lag$rho), rhoSe = unname(lag$rho.se), coef = unname(coef(lag)[-1]), se = unname(lag$rest.se),
               logLik = as.numeric(logLik(lag)), aic = AIC(lag), lr = as.numeric(ls$LR1$statistic), wald = as.numeric(ls$Wald1$statistic),
               direct = unname(imp$direct), indirect = unname(imp$indirect), total = unname(imp$total)),
    error = list(lambda = unname(err$lambda), lambdaSe = unname(err$lambda.se), coef = unname(coef(err)[-1]), se = unname(err$rest.se),
                 logLik = as.numeric(logLik(err)), aic = AIC(err), lr = as.numeric(es$LR1$statistic))
  )
}
out$spatial <- list(queen = spatial_fits(queen_nb), band = spatial_fits(band_nb))

# ---- count models: Poisson and negative binomial with a log-population offset ------------
# Drug overdose deaths by county (County Health Rankings 2025) on three county measures,
# with log person-years as the offset, over the counties with every value.
chr <- st_drop_geometry(st_read("public/data/ms/layers/chr_counties_2025.geojson", quiet = TRUE))
chr <- chr[order(as.character(chr$id)), ]
count_covariates <- c("v085_rawvalue", "v023_rawvalue", "v058_rawvalue")
cd <- chr[complete.cases(chr[, c("v138_numerator", "v138_denominator", count_covariates)]) & chr$v138_denominator > 0, ]
# Like every rumb analysis, keep the counties with a queen neighbor among them.
chr_queen <- jsonlite::read_json("public/data/ms/layers/chr_counties_2025.neighbors.json")$queen
cd_ids <- as.character(cd$id)
cd <- cd[vapply(cd_ids, function(id) any(unlist(chr_queen[[id]]) %in% cd_ids), logical(1)), ]
count_formula <- reformulate(c(count_covariates, "offset(log(v138_denominator))"), "v138_numerator")
tight <- glm.control(epsilon = 1e-14, maxit = 100)
pois <- glm(count_formula, family = poisson, data = cd, control = tight)
nb <- MASS::glm.nb(count_formula, data = cd, control = tight)
summarize_count <- function(fit) {
  s <- summary(fit)
  list(coef = unname(coef(fit)), se = unname(s$coefficients[, 2]), z = unname(s$coefficients[, 3]),
       deviance = fit$deviance, nullDeviance = fit$null.deviance, aic = AIC(fit), logLik = as.numeric(logLik(fit)),
       pearson = unname(residuals(fit, type = "pearson")))
}
out$counts <- list(
  ids = I(as.character(cd$id)), covariates = I(count_covariates),
  poisson = summarize_count(pois),
  nb = c(summarize_count(nb), list(theta = nb$theta, thetaSe = nb$SE.theta))
)

# ---- access to facilities: nearest, within, E2SFCA ------------------------------------------
# From every tract's 2020 center of population to pharmacies (each counts once) and
# nursing homes (weighted by beds), in EPSG:3814 by sf; the formulas written out here.
tract_xy <- st_coordinates(st_transform(st_as_sf(data.frame(lon = centers$lon, lat = centers$lat),
                                                 coords = c("lon", "lat"), crs = 4269), 3814))
population <- acs$acs_population[match(centers$ids, acs$GEOID)]
access <- function(layer, size_field, within = 10, catchment = 30, kind = "gaussian") {
  pts <- st_read(file.path("public/data/ms/layers", paste0(layer, ".geojson")), quiet = TRUE)
  sxy <- st_coordinates(st_transform(pts, 3814))
  size <- if (is.null(size_field)) rep(1, nrow(pts)) else pts[[size_field]]
  d <- sqrt(outer(tract_xy[, 1], sxy[, 1], "-")^2 + outer(tract_xy[, 2], sxy[, 2], "-")^2)
  d0 <- catchment * 1609.344
  g <- if (kind == "step") (d <= d0) * 1 else ifelse(d <= d0, (exp(-0.5 * (d / d0)^2) - exp(-0.5)) / (1 - exp(-0.5)), 0)
  pop <- ifelse(is.finite(population) & population > 0, population, 0)
  served <- colSums(g * pop)
  ratio <- as.vector(g %*% ifelse(served > 0, size / served, 0)) * 10000
  list(nearest = apply(d, 1, min) / 1609.344, count = rowSums(d <= within * 1609.344), ratio = ratio)
}
out$access <- list(
  ids = I(centers$ids), xy = unname(tract_xy), population = population,
  pharmacies = access("pharmacies_2010", NULL),
  pharmaciesStep = access("pharmacies_2010", NULL, kind = "step"),
  nursingBeds = access("nursing_homes_2024", "beds", within = 15, catchment = 20)
)

# ---- point patterns: nearest neighbor, Ripley's L, centrography, kernel density ------------
# Public health departments (90) and nursing homes weighted by beds, in EPSG:3814,
# with the Mississippi outline's area; every formula written out here.
outline <- st_transform(st_read("public/data/ms/outline.geojson", quiet = TRUE), 3814)
A <- as.numeric(st_area(outline))
pattern <- function(layer, weight = NULL) {
  pts <- st_read(file.path("public/data/ms/layers", paste0(layer, ".geojson")), quiet = TRUE)
  xy <- st_coordinates(st_transform(pts, 3814))
  w <- if (is.null(weight)) rep(1, nrow(xy)) else pts[[weight]]
  n <- nrow(xy)
  D <- as.matrix(dist(xy))
  diag(D) <- Inf
  observed <- mean(apply(D, 1, min))
  expected <- 0.5 / sqrt(n / A)
  se <- 0.26136 / sqrt(n^2 / A)
  d <- c(5, 10, 20, 40) * 1609.344
  pd <- D[upper.tri(D)]
  L <- vapply(d, function(r) sqrt(A * 2 * sum(pd <= r) / (n * (n - 1)) / pi) - r, numeric(1))
  W <- sum(w)
  mx <- sum(w * xy[, 1]) / W
  my <- sum(w * xy[, 2]) / W
  med <- c(mx, my)
  for (i in 1:1000) {
    dd <- pmax(sqrt((xy[, 1] - med[1])^2 + (xy[, 2] - med[2])^2), 1e-9)
    nxt <- c(sum(w * xy[, 1] / dd), sum(w * xy[, 2] / dd)) / sum(w / dd)
    step <- sqrt(sum((nxt - med)^2))
    med <- nxt
    if (step < 1e-6) break
  }
  dx <- xy[, 1] - mx
  dy <- xy[, 2] - my
  sxx <- sum(w * dx^2); syy <- sum(w * dy^2); sxy <- sum(w * dx * dy)
  theta <- atan(((sxx - syy) + sqrt((sxx - syy)^2 + 4 * sxy^2)) / (2 * sxy))
  sx <- sqrt(2) * sqrt(sum(w * (dx * cos(theta) - dy * sin(theta))^2) / W)
  sy <- sqrt(2) * sqrt(sum(w * (dx * sin(theta) + dy * cos(theta))^2) / W)
  # Esri's default bandwidth, and the quartic kernel at a few locations.
  dm <- sqrt(dx^2 + dy^2)
  o <- order(dm)
  median_d <- dm[o][which(cumsum(w[o]) >= W / 2)[1]]
  sd_dist <- sqrt((sxx + syy) / W)
  bandwidth <- 0.9 * min(sd_dist, sqrt(1 / log(2)) * median_d) * W^-0.2
  at <- rbind(c(mx, my), med, xy[1, ] + c(5000, -3000), c(mx + 40000, my - 60000))
  quartic <- function(p, r) {
    d2 <- (xy[, 1] - p[1])^2 + (xy[, 2] - p[2])^2
    3 / pi * sum(ifelse(d2 < r^2, w * (1 - d2 / r^2)^2, 0)) * 1609.344^2 / r^2
  }
  list(
    ann = list(observed = observed / 1609.344, expected = expected / 1609.344, ratio = observed / expected,
               z = (observed - expected) / se),
    distances = d, L = L,
    mean = c(mx, my), median = med, standardDistance = sd_dist, theta = theta, sx = sx, sy = sy,
    bandwidth = bandwidth, at = unname(at),
    density = apply(at, 1, quartic, r = bandwidth), density15 = apply(at, 1, quartic, r = 15 * 1609.344)
  )
}
out$points <- list(area = A, health = pattern("public_health_departments_2010"), nursing = pattern("nursing_homes_2024", "beds"))

# ---- spatial models above 2,500 areas: the Chebyshev log-determinant ---------------------
# A 60 × 60 rook lattice (3,600 cells; cell r, c is number r·60 + c + 1, rows and columns
# from 0) with synthetic data from a fixed seed, rounded to 6 decimals and written out so
# rumb fits the same numbers. y_lag follows a lag process (ρ = 0.55), y_error an error
# process (λ = 0.6). Fitted by spatialreg with method = "Chebyshev" and cheb_q = 7, as rumb
# fits layers above 2,500 areas; impacts from the exact inverse.
side <- 60
cell <- function(r, c) r * side + c + 1
lattice_nb <- structure(lapply(0:(side^2 - 1), function(id) {
  r <- id %/% side
  c <- id %% side
  as.integer(sort(c(if (r > 0) cell(r - 1, c), if (c > 0) cell(r, c - 1), if (c < side - 1) cell(r, c + 1), if (r < side - 1) cell(r + 1, c))))
}), class = "nb", region.id = as.character(1:side^2))
lattice_lw <- nb2listw(lattice_nb, style = "W")
set.seed(20261123)
lattice <- data.frame(x1 = round(rnorm(side^2), 6), x2 = round(runif(side^2, 0, 10), 6))
mu <- 1 + 0.8 * lattice$x1 - 0.3 * lattice$x2
lattice$y_lag <- round(as.vector(invIrW(lattice_lw, 0.55) %*% (mu + rnorm(side^2))), 6)
lattice$y_error <- round(mu + as.vector(invIrW(lattice_lw, 0.6) %*% rnorm(side^2)), 6)
cheb <- list(cheb_q = 7)
lattice_ols <- function(outcome) as.numeric(logLik(lm(reformulate(c("x1", "x2"), outcome), data = lattice)))
lag_c <- lagsarlm(y_lag ~ x1 + x2, data = lattice, listw = lattice_lw, method = "Chebyshev", control = cheb, quiet = TRUE)
err_c <- errorsarlm(y_error ~ x1 + x2, data = lattice, listw = lattice_lw, method = "Chebyshev", control = cheb, quiet = TRUE)
imp_c <- impacts(lag_c, listw = lattice_lw)
lag_cs <- summary(lag_c)
err_cs <- summary(err_c)
out$chebyshev <- list(
  side = side, order = 7, x1 = lattice$x1, x2 = lattice$x2, yLag = lattice$y_lag, yError = lattice$y_error,
  lag = list(rho = unname(lag_c$rho), rhoSe = unname(lag_c$rho.se), coef = unname(coef(lag_c)[-1]), se = unname(lag_c$rest.se),
             logLik = as.numeric(logLik(lag_c)), aic = AIC(lag_c), lr = as.numeric(lag_cs$LR1$statistic),
             olsLogLik = lattice_ols("y_lag"),
             direct = unname(imp_c$direct), indirect = unname(imp_c$indirect), total = unname(imp_c$total)),
  error = list(lambda = unname(err_c$lambda), lambdaSe = unname(err_c$lambda.se), coef = unname(coef(err_c)[-1]), se = unname(err_c$rest.se),
               logLik = as.numeric(logLik(err_c)), aic = AIC(err_c), lr = as.numeric(err_cs$LR1$statistic),
               olsLogLik = lattice_ols("y_error"))
)

out$packages <- lapply(setNames(nm = c("sf", "jsonlite", "spdep", "lmtest", "spatialreg", "MASS")), function(p) as.character(packageVersion(p)))
jsonlite::write_json(out, "tests/models-reference.json", digits = NA, auto_unbox = TRUE, dataframe = "rows", matrix = "rowmajor")
message("Wrote tests/models-reference.json")
