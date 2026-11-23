#!/usr/bin/env Rscript
# Reference values for the statistics in src/stats/, computed in R from the
# committed data files, so the JS can be checked against independent code.
# Writes tests/stats-reference.json. Run at the repository root:
#   Rscript scripts/reference-stats.R
# R packages: jsonlite (sections added later use sf and spdep).
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

jsonlite::write_json(out, "tests/stats-reference.json", digits = NA, auto_unbox = TRUE, dataframe = "rows")
message("Wrote tests/stats-reference.json")
