# rumb's statistical methods

This page gives the formula behind each statistic in rumb, its source and the R
code it is checked against. The code is in `src/stats/`, written from the
publications cited here rather than ported from R or other GPL sources. The
R reference values come from `scripts/reference-stats.R` and
`scripts/reference-models.R` (and, for Local Moran,
`scripts/prepare-data.R`). They are compared in `tests/*.test.js`.

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
- **Work budget:** window entries × replicates up to 2 billion. A larger
  scan does not run; it suggests the widest whole-mile radius that fits, or
  fewer replicates (999 or 99). Windows are built in two passes (sizes, then members) into
  typed arrays.

**Check:** `smerc::scan.test` (Poisson, multinomial) on the same projected
centers:
- members and LLR match exactly for drug overdose deaths by county (50%)
  and tract poverty (10%);
- p-values agree within Monte Carlo error.

In Chromium, 999 replicates over 878 tracts take about 2.9 s at 25% and
5.4 s at 50%.

## Regression

The outcome is the measure on the map, and the covariates are the ones you
tick. An area needs every variable and an eligible neighbor; the inspector
counts the rest out.

**Ordinary least squares** (`stats/regression.js`):
- β by Householder QR; standard errors from σ²(XᵀX)⁻¹ with
  σ² = e'e / (n − k); t tests.
- R² and adjusted R², and the F test.
- Log-likelihood −n/2 (ln 2π + ln(e'e/n) + 1). AIC and Schwarz count σ
  as a parameter, as R and spatialreg do (GeoDa does not).
- The Belsley condition number: √(λmax/λmin) of XᵀX with unit-length
  columns. Values over 30 suggest collinearity.
- Each covariate's VIF: 1 / (1 − R²) on the others.
- Jarque–Bera: n/6 (S² + (K − 3)²/4).
- Breusch–Pagan: half the explained sum of squares of e²/σ̂² on X.
  Koenker–Bassett: n R² of e² on X.

**Spatial diagnostics** use the row-standardized weights W, with
M = I − X(XᵀX)⁻¹Xᵀ and T = tr(WᵀW + WW). Every trace comes from p × p
products over sparse weights.

| Test | Statistic |
| --- | --- |
| Moran's I of the residuals | I = e'We / e'e; E[I] = tr(MW)/(n − k); Var[I] = [tr(MWMWᵀ) + tr(MWMW) + tr(MW)²] / ((n − k)(n − k + 2)) − E[I]² (Cliff & Ord 1981) |
| LM-error | (e'We/σ²)² / T |
| LM-lag | (e'Wy/σ²)² / nJ, with nJ = (WXβ)'M(WXβ)/σ² + T |
| Robust LM-error | (e'We/σ² − T e'Wy/(σ² nJ))² / (T − T²/nJ) |
| Robust LM-lag | (e'Wy/σ² − e'We/σ²)² / (nJ − T) |
| SARMA | robust LM-lag + LM-error, on 2 df |

The guide that follows the tests is Anselin's (2005):
- keep OLS when neither LM test is significant;
- otherwise pick the model whose test is;
- when both are, pick the one whose robust test is.

**Checks:**
- `lm`, `lmtest::bptest`, and VIF and Jarque–Bera by formula, to 1e-10.
- `spdep::lm.morantest` and `lm.RStests`, to 1e-9, over queen and
  6-nearest weights.
- The data: PLACES diabetes on four ACS covariates, over 869 tracts.

**Spatial lag** (y = ρWy + Xβ + ε) and **spatial error** (y = Xβ + u,
u = λWu + ε) models are fitted by maximum likelihood (`stats/spatial-models.js`;
Ord 1975, Anselin 1988):
- **Concentrated likelihood:** maximized by Brent's method on
  (1/ω_min, 1/ω_max), with log|I − ρW| = Σ log(1 − ρω_i).
- **Eigenvalues ω of W:** taken from the symmetric matrix D^-½ S D^-½
  similar to the row-standardized W = D⁻¹S. So the raw weights S must be
  symmetric: contiguity, a distance band, inverse distance or symmetric k
  nearest. Up to 2,500 areas.
- **Standard errors:** from the full information matrix, as spatialreg's
  eigen method computes them. tr(AᵀA), with A = W(I − ρW)⁻¹, comes from
  Neumann series over the sparse weights.
- **Above 2,500 areas** (up to 20,000):
  - log|I − ρW| by the Chebyshev approximation of order 7 (Pace & LeSage
    2004) on (−1, 0.999), with exact traces of the powers of the same
    symmetric matrix: tr S^2m = ‖S^m‖²_F and tr S^(2m+1) = ⟨S^m, S^(m+1)⟩;
  - standard errors from a numerical Hessian of the log-likelihood
    concentrated on σ²;
  - impacts from the power series Σ ρ^j tr W^j, with exact traces to
    order 8 and seeded Monte Carlo traces beyond.
- **Tests:** LR against OLS and Wald.
- **Lag model impacts** (LeSage & Pace 2009):
  - direct = β · mean(1/(1 − ρω_i));
  - total = β/(1 − ρ);
  - indirect = total − direct.

**Check:**
- `spatialreg::lagsarlm`, `errorsarlm` (`method = "eigen"`) and
  `impacts`, over queen and distance-band weights.
- ρ, λ and β to 1e-6, standard errors to 1e-5, and log-likelihood and
  AIC to 1e-9.
- Above 2,500 areas: `method = "Chebyshev"` (`cheb_q = 7`) on a 60 × 60
  rook lattice with synthetic data. ρ, λ, β and LR to 1e-6, log-likelihood
  and AIC to 1e-9, standard errors to 1e-3 (both are numerical Hessians),
  and direct and indirect impacts to 1e-5.

**Count models** (`stats/glm.js`) explain a rate's numerator with a log link
and log(denominator) as the offset:
- **Poisson** is fitted by IRLS.
- **Negative binomial** (NB2, variance μ + μ²/θ) alternates IRLS for β
  with Newton steps for θ by maximum likelihood, as `MASS::glm.nb` does.
- **Output:**
  - z tests;
  - rate ratios exp(β), with Wald 95% limits;
  - deviance against the intercept-only model;
  - AIC (θ counts as a parameter);
  - the Pearson χ²/df, as a guide to overdispersion;
  - Moran's I of the Pearson residuals, with a 999-permutation p.

**Check:**
- `glm(family = poisson)` and `MASS::glm.nb` on drug overdose deaths by
  county. R is fitted to full convergence (ε = 1e-14).
- Coefficients to 1e-7; SEs, deviances, AIC and Pearson residuals to
  1e-6; θ and its SE.

## Access to facilities

Access is measured from each area's center of population to the points of a
facility layer (`stats/access.js`). Distances are straight lines in
EPSG:3814, not travel times.

| Field | Meaning |
| --- | --- |
| `near_*` | Miles to the nearest facility |
| `in_*` | Facilities within a chosen distance |
| `acc_*` | E2SFCA (Luo & Qi 2009) per 10,000 people |

The E2SFCA ratio is built in two steps:
1. Each facility j gets R_j = S_j / Σ_k G(d_kj) P_k, over the areas k
   within the catchment d₀. S_j is 1 or a capacity field.
2. Each area gets A_i = Σ_j G(d_ij) R_j.

G is a step (1 inside d₀), or Dai's (2010) Gaussian
(e^(−½(d/d₀)²) − e^(−½)) / (1 − e^(−½)).

**Check:** R formulas on sf's distances, for every tract: pharmacies with
Gaussian and step decay, and nursing-home beds.

## Point patterns and density

These statistics use the points of a layer and the region's outline
(`stats/points.js`).

- **Average nearest neighbor** (Clark & Evans 1954):
  - R = mean nearest distance / (0.5 / √(n/A));
  - z = (observed − expected) / (0.26136 / √(n²/A));
  - A is the area of the outline in EPSG:3814.
- **Ripley's L(d) − d** (Besag 1977):
  - L(d) = √(K(d)/π), with K(d) = A · 2 · #{pairs within d} / (n(n − 1));
  - there is no edge correction;
  - the curve is compared with the range of simulated random patterns
    inside the outline (99, or fewer for large layers).
- **Centrography:**
  - (weighted) mean center;
  - median center by Weiszfeld's iteration;
  - standard distance √(Σw d²/Σw);
  - the standard deviational ellipse (Yuill 1971): its angle from
    tan θ = ((Σx̃² − Σỹ²) + √((Σx̃² − Σỹ²)² + 4(Σx̃ỹ)²)) / (2Σx̃ỹ), and its
    axes √2 · √(Σw(x̃ cos θ − ỹ sin θ)² / Σw) and the like (Wang, Shi &
    Miao 2015).
- **Density surfaces:**
  - quartic kernel (Silverman 1986, eq. 4.5):
    D = (3/π) Σ w_i (1 − (d_i/r)²)² / r², per square mile, on cells inside
    the outline;
  - the default radius is Esri's spatial variant of Silverman's rule,
    0.9 · min(SD, √(1/ln 2) · Dm) · n^(−0.2), where SD is the standard
    distance and Dm the median distance from the mean center.

**Check:** R formulas on sf's projection, for health departments and for
nursing homes weighted by beds, to 1e-6 or better:
- the outline's area;
- the nearest neighbor statistics;
- L at four distances;
- the centers, ellipse and bandwidth;
- densities at sample points.

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

`stats/linalg.js` covers the linear algebra (Golub & Van Loan):
- Householder QR;
- triangular inverses;
- Cholesky;
- the eigenvalues of symmetric matrices, by Householder tridiagonalization
  and implicit QR steps with Wilkinson shifts.

`dist.js` also gives digamma and trigamma by their asymptotic series.

**Check:** `qr.coef`, `chol2inv` and `eigen(symmetric = TRUE)`, to 1e-10.
The eigen check runs on 869 tracts.

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
- Anselin, L. (1988). *Spatial Econometrics: Methods and Models*. Kluwer.
- Anselin, L. (2005). *Exploring Spatial Data with GeoDa: A Workbook*. CSISS.
- Anselin, L., Bera, A. K., Florax, R., & Yoon, M. J. (1996). Simple diagnostic tests for spatial dependence. *Regional Science and Urban Economics* 26, 77–104.
- Barry, R. P., & Pace, R. K. (1999). Monte Carlo estimates of the log determinant of large sparse matrices. *Linear Algebra and its Applications* 289, 41–54.
- Besag, J. (1977). Comments on Ripley's paper. *Journal of the Royal Statistical Society B* 39, 193–195.
- Clark, P. J., & Evans, F. C. (1954). Distance to nearest neighbor as a measure of spatial relationships in populations. *Ecology* 35(4), 445–453.
- Dai, D. (2010). Black residential segregation, disparities in spatial access to health care facilities, and late-stage breast cancer diagnosis in metropolitan Detroit. *Health & Place* 16, 1038–1052.
- Golub, G. H., & Van Loan, C. F. (2013). *Matrix Computations* (4th ed.). Johns Hopkins.
- LeSage, J., & Pace, R. K. (2009). *Introduction to Spatial Econometrics*. CRC Press.
- Luo, W., & Qi, Y. (2009). An enhanced two-step floating catchment area (E2SFCA) method for measuring spatial accessibility to primary care physicians. *Health & Place* 15, 1100–1107.
- Luo, W., & Wang, F. (2003). Measures of spatial accessibility to health care in a GIS environment. *Environment and Planning B* 30, 865–884.
- McCullagh, P., & Nelder, J. A. (1989). *Generalized Linear Models* (2nd ed.). Chapman & Hall.
- Ord, K. (1975). Estimation methods for models of spatial interaction. *Journal of the American Statistical Association* 70, 120–126.
- Pace, R. K., & LeSage, J. P. (2004). Chebyshev approximation of log-determinants of spatial weight matrices. *Computational Statistics & Data Analysis* 45(2), 179–196.
- Silverman, B. W. (1986). *Density Estimation for Statistics and Data Analysis*. Chapman & Hall.
- Venables, W. N., & Ripley, B. D. (2002). *Modern Applied Statistics with S* (4th ed.). Springer.
- Wang, B., Shi, W., & Miao, Z. (2015). Confidence analysis of standard deviational ellipse and its extension into higher dimensional Euclidean space. *PLoS ONE* 10(3), e0118537.
- Yuill, R. S. (1971). The standard deviational ellipse: an updated tool for spatial description. *Geografiska Annaler B* 53(1), 28–39.
