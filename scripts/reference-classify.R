#!/usr/bin/env Rscript
# Independent class breaks for tests/classify.test.js: Fisher's natural breaks
# from classInt (style "fisher", the exact algorithm, no sampling) and
# standard-deviation breaks, for real fields with 3 to 9 classes.
# Run at the repository root: Rscript scripts/reference-classify.R
fields <- list(
  list(file = "public/data/ms/tracts.geojson", field = "poverty_pct"),
  list(file = "public/data/ms/tracts.geojson", field = "child_poverty_pct"),
  list(file = "public/data/ms/tracts.geojson", field = "poverty_universe"),
  list(file = "public/data/ms/layers/chr_counties_2025.geojson", field = "v085_rawvalue"),
  list(file = "public/data/ms/layers/chr_counties_2025.geojson", field = "v063_rawvalue"),
  list(file = "public/data/ms/layers/census_county_density_2020.geojson", field = "density")
)
cases <- list()
for (f in fields) {
  props <- jsonlite::read_json(f$file)$features
  x <- vapply(props, function(p) { v <- p$properties[[f$field]]; if (is.null(v)) NA_real_ else as.numeric(v) }, 0)
  x <- x[is.finite(x)]
  for (k in 3:9) {
    fisher <- classInt::classIntervals(x, k, style = "fisher", largeN = Inf)
    inner <- fisher$brks[-c(1, length(fisher$brks))]
    cls <- findInterval(x, inner)
    ssd <- sum(tapply(x, cls, function(g) sum((g - mean(g))^2)))
    sd_cuts <- mean(x) + sd(x) * (seq_len(k - 1) - k / 2)
    sd_cuts <- sd_cuts[sd_cuts > min(x) & sd_cuts < max(x)]
    cases[[length(cases) + 1]] <- list(file = f$file, field = f$field, k = k, n = length(x),
                                       fisher = inner, ssd = ssd, sd = I(sd_cuts))
  }
}
out <- list(classInt = as.character(packageVersion("classInt")), cases = cases)
jsonlite::write_json(out, "tests/classify-reference.json", auto_unbox = TRUE, digits = NA)
message("Wrote ", length(cases), " cases to tests/classify-reference.json")
