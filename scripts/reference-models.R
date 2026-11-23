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

out$packages <- lapply(setNames(nm = c("sf", "jsonlite", "spdep", "lmtest")), function(p) as.character(packageVersion(p)))
jsonlite::write_json(out, "tests/models-reference.json", digits = NA, auto_unbox = TRUE, dataframe = "rows", matrix = "rowmajor")
message("Wrote tests/models-reference.json")
