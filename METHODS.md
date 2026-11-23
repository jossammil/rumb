# rumb's statistical methods

This page gives the formula behind each statistic in rumb, its source and the R
code it is checked against. The code is in `src/stats/`, written from the
publications cited here rather than ported from R or other GPL sources. The
R reference values come from `scripts/reference-stats.R` (and, for Local
Moran, `scripts/prepare-data.R`) and are compared in `tests/*.test.js`.

## Data the statistics use

- **Tracts:** ACS 2020–2024 poverty (S1701), 15 ACS data-profile covariates
  with 90% margins of error, counts and universes, and all 40 CDC PLACES 2025
  estimates with 95% intervals.
- **Counties:** County Health Rankings 2025 measures with numerators and
  denominators.
- **Locations:** 2020 Census centers of population for tracts and counties.
  Other layers use area-weighted centroids. Both are projected to
  EPSG:3814 (NAD83 / Mississippi Transverse Mercator).

**PLACES values are model-based.** CDC estimates them from BRFSS with ACS
and county-level covariates, so their spatial patterns partly reflect the
model. Results on them carry that caution.

## Who is analysed

An area is left out, and the inspector says why, when it is:

- outside the study area;
- missing a value (or, for rates, a count);
- on a zero denominator;
- without a location (distance weights and scans);
- without an eligible neighbor.

Distance weights are built among the eligible areas only, so each keeps its
k neighbors inside the study area.

## Spatial weights

| Rule | Neighbors of area i | Weights before row standardization |
| --- | --- | --- |
| Queen | Polygons sharing a boundary point (GEOS DE-9IM `F***T****`) | 1 |
| Rook | Polygons sharing a boundary segment (`F***1****`) | 1 |
| k nearest | The k closest centers; ties go to the lower index. "Make symmetric" adds j → i whenever i → j. | 1 |
| Distance band | Every center within d. With no d given, d is the largest nearest-neighbor distance × (1 + 10⁻⁹), the smallest band that leaves no area alone (GeoDa's default). | 1 |
| Inverse distance | Every center within d, as above | 1 / max(d_ij, 1 m)^p, p = 1 or 2 |

Statistics row-standardize: w*_ij = w_ij / Σ_j w_ij. Binary rows keep
GeoDa's arithmetic exactly, so queen and rook results are bit-identical to
earlier versions.

**Check:** neighbor sets match spdep's `knn2nb(knearneigh())`,
`make.sym.nb()` and `dnearneigh()` exactly, on the same PROJ-projected
centers. Centroids are within 2 mm of GEOS `st_centroid`.

## Local and global Moran's I

With z_i = (x_i − x̄) / s, where s is the sample standard deviation:

- Global I = Σ_i z_i lag_i / Σ_i z_i², with lag_i = Σ_j w*_ij z_j.
- Local I_i = z_i · lag_i (Anselin 1995).
- Quadrants: high–high, low–low, high–low and low–high, from the signs of
  z_i and lag_i where p ≤ α.

**Check:** global and local I against `spdep::moran` and
`localmoran(mlvar = FALSE)`, to 1e-10 and 1e-9, for all seven weight kinds.

**Bivariate Local Moran** (Anselin, Syabri & Smirnov 2002):
- I_i = z(x)_i · Σ_j w*_ij z(y)_j.
- The global statistic is the slope Σ z(x) lag z(y) / Σ z(x)².
- Permutations move y only.
- **Check:** `spdep::localmoran_bv`, to 1e-10.

**EB-adjusted Moran** (Assunção & Reis 1999), for rates r_i = e_i / n_i:
- b = Σe / Σn.
- s² = Σ n_i (r_i − b)² / Σn.
- a = s² − b / n̄, raised to b / n̄ if negative (spdep's rule).
- z_i = (r_i − b) / √(a + b / n_i), and Moran's I is computed on z.
- **Check:** `spdep::EBImoran.mc` statistic and the z formula, to 1e-10.

## Hot and cold spots

**Getis–Ord Gi\*** (Ord & Getis 1995) includes i in its own neighborhood.
The self weight is 1, or the row's largest weight for inverse distance.

z_i = (Σ_j w_ij x_j − x̄ W_i) / ( S √((n S1_i − W_i²) / (n − 1)) )

where W_i = Σ_j w_ij, S1_i = Σ_j w_ij², and S² = Σx²/n − x̄². The z-score
does not change when a row is rescaled. Bins: hot (z > 0) or cold spot at
99, 95 or 90% confidence, from p ≤ 0.01, 0.05 or 0.10 (or q with FDR).

**Check:** `spdep::localG` on `include.self` weights, to 1e-10, for queen, k
nearest, band and inverse distance.

**General G** (Getis & Ord 1992) and **Geary's C** (Geary 1954) use their
randomization moments:
- E[G] = S0 / (n(n − 1)), with S0, S1 and S2 the usual weight sums.
- E[C] = 1, with the Cliff–Ord variance.

**Check:** `spdep::globalG.test` and `geary.test(randomisation = TRUE)`:
statistics to 1e-12, variances to 1e-9.

## Inference

- **Permutation tests** are seeded (Mulberry32, default seed 12345, 999
  draws).
  - Global statistics shuffle every value.
  - Local statistics hold the area's own value and draw its neighbors'
    values without replacement from the other areas (conditional
    randomization).
  - Both are two-sided about the null expectation, count ties, and add one
    to numerator and denominator.
- **Normal p-values** (Gi* by default) are 2Φ(−|z|).
- **FDR:** Benjamini–Hochberg q-values across the tested areas, when chosen.

**Check:** the permutation p-values approach the exact conditional null,
enumerated on small chains.

## Rates

For events e_i on a base n_i (population, births, person-years), with
r_i = e_i / n_i, and shown on the measure's own scale:

| Field | Method | Check |
| --- | --- | --- |
| `eb_*` | Global empirical Bayes (Marshall 1991): b + a(r_i − b) / (a + b/n_i), with a = max(0, s² − b/n̄) | `spdep::EBest`, 1e-10 |
| `seb_*` | Spatial EB: the same within each area's window W_i (itself and its queen neighbors). m_i = Σ_W e / Σ_W n; a_i = max(0, Σ_W n_j (r_j − m_i)² / Σ_W n − m_i / n̄_W) | `spdep::EBlocal(geoda = TRUE)`, 1e-10 |
| `sr_*` | Window rate: Σ_W e / Σ_W n | R formula, 1e-12 |
| `er_*` | Excess risk: r_i / b (observed ÷ expected) | R formula, 1e-12 |
| `lcl_*`, `ucl_*` | Exact (Garwood) Poisson 95% limits: Γ⁻¹(0.025; e) and Γ⁻¹(0.975; e + 1), divided by n | `poisson.test`, 1e-12 |

Areas without counts stay out of every estimate and window; they are never
counted as zero.

**Reliability**, shown by **Hatch unreliable estimates**:
- **ACS estimates:** low reliability when CV = MOE / 1.645 / estimate is
  over 40%; 12–40% is medium (the classes Esri and the Census Bureau use).
- **Rates:** unstable on fewer than 20 events (NCHS), or when the source
  flags a value as unreliable.
- Model-based and smoothed values are never hatched.

## Kulldorff's spatial scan

The scan is the Poisson model, purely spatial (Kulldorff 1997):

- **Windows:** circles around each area's center, adding areas in order of
  distance (ties by index) while their population stays within the chosen
  share of the total (5–50%; 25% by default) and, optionally, a radius.
- **Expected counts:** E_i = C · p_i / P.
- **Log-likelihood ratio:** for c cases where E were expected,
  LLR = c ln(c/E) + (C − c) ln((C − c)/(C − E)). It counts only when c > E
  (high), c < E (low) or either. High-rate windows need at least 2 cases,
  as smerc requires.
- **Clusters:** the most likely cluster maximizes the LLR. Secondary
  clusters are the best windows that overlap no stronger one; those with
  p ≤ 0.05 are reported.
- **p-values:** (1 + #{replicates whose largest LLR ≥ the cluster's}) /
  (R + 1). Each replicate redistributes C cases in proportion to population
  by a seeded multinomial draw.
- **Relative risk:** (c / E) / ((C − c) / (C − E)).

**Check:** `smerc::scan.test` (Poisson, multinomial) on the same projected
centers:
- members and LLR match exactly for drug overdose deaths by county (50%)
  and tract poverty (10%);
- p-values agree within Monte Carlo error.

In Chromium, 999 replicates over 878 tracts take about 2.9 s at 25% and
5.4 s at 50%.

## Distributions and random numbers

`stats/dist.js` computes:
- log-gamma (Lanczos), with Stirling's series and Loader's (2000)
  saddle-point form for large shapes;
- the regularized incomplete gamma and beta functions (series and Lentz's
  continued fractions);
- from those, the normal, t, F, chi-square, gamma and Poisson distributions
  and their quantiles (safeguarded Newton and Halley steps).

**Check:** R's `pnorm`, `qnorm`, `pt`, `qt`, `pf`, `pchisq`, `qchisq`,
`qgamma`, `ppois` and `lgamma` to 1e-12 relative error, deep tails
included. Near p = 1 the chi-square quantile is checked by its round trip,
where R's own upper tail shows rumb's value is the closer one.

`stats/random.js` draws:
- binomials by inversion below n·p = 10 and Hörmann's (1993) transformed
  rejection above;
- multinomials by sequential binomials.

**Check:** their moments and a chi-square goodness-of-fit pass at fixed
seeds.

## References

- Anselin, L. (1995). Local indicators of spatial association — LISA. *Geographical Analysis* 27(2), 93–115.
- Anselin, L., Syabri, I., & Smirnov, O. (2002). Visualizing multivariate spatial correlation with dynamically linked windows. In *New Tools for Spatial Data Analysis*, CSISS.
- Assunção, R. M., & Reis, E. A. (1999). A new proposal to adjust Moran's I for population density. *Statistics in Medicine* 18, 2147–2162.
- Cliff, A. D., & Ord, J. K. (1981). *Spatial Processes: Models and Applications*. Pion.
- Garwood, F. (1936). Fiducial limits for the Poisson distribution. *Biometrika* 28, 437–442.
- Geary, R. C. (1954). The contiguity ratio and statistical mapping. *The Incorporated Statistician* 5(3), 115–145.
- Getis, A., & Ord, J. K. (1992). The analysis of spatial association by use of distance statistics. *Geographical Analysis* 24(3), 189–206.
- Hörmann, W. (1993). The generation of binomial random variates. *Journal of Statistical Computation and Simulation* 46, 101–110.
- Kulldorff, M. (1997). A spatial scan statistic. *Communications in Statistics — Theory and Methods* 26(6), 1481–1496.
- Loader, C. (2000). Fast and accurate computation of binomial probabilities. Technical report.
- Marshall, R. J. (1991). Mapping disease and mortality rates using empirical Bayes estimators. *Applied Statistics* 40(2), 283–294.
- Ord, J. K., & Getis, A. (1995). Local spatial autocorrelation statistics: distributional issues and an application. *Geographical Analysis* 27(4), 286–306.
- Benjamini, Y., & Hochberg, Y. (1995). Controlling the false discovery rate. *Journal of the Royal Statistical Society B* 57(1), 289–300.
