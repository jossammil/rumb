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

out$packages <- lapply(setNames(nm = c("sf", "jsonlite", "spdep", "lmtest", "spatialreg", "MASS")), function(p) as.character(packageVersion(p)))
jsonlite::write_json(out, "tests/models-reference.json", digits = NA, auto_unbox = TRUE, dataframe = "rows", matrix = "rowmajor")
message("Wrote tests/models-reference.json")
