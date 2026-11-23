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

out$packages <- lapply(setNames(nm = c("sf", "jsonlite")), function(p) as.character(packageVersion(p)))
jsonlite::write_json(out, "tests/models-reference.json", digits = NA, auto_unbox = TRUE, dataframe = "rows", matrix = "rowmajor")
message("Wrote tests/models-reference.json")
