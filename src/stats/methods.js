// The analysis methods the "Spatial analysis" section runs, and how each one's
// result reads everywhere it shows: the map's classes and legend, the
// inspector's feature rows and summary, the statistics CSV, the PNG note and
// the report. A result names its method; one without (saved before methods
// existed) is a Local Moran result. Pure.
import { number } from "../catalog/format.js";
import { clusters } from "../map/classify.js";

const fixed = (v, d = 4) => (v == null || !Number.isFinite(v) ? "" : number(v, d));

/** CSV columns every method shares, after its own. */
const SHARED_CSV = ["eligible_neighbors", "reason", "study_area", "neighbor_rule", "permutations", "seed", "alpha", "FDR_applied", "method"];
const sharedRow = (record, result, rule) => [
  record.neighbors.join(" "),
  record.reason,
  result.studyName,
  result.weights?.label || rule,
  result.permutations,
  result.seed,
  result.alpha,
  result.fdr,
  result.methodNote || result.method,
];

export const METHODS = {
  lisa: {
    id: "lisa",
    label: "Clusters and outliers (Local Moran)",
    title: "Cluster analysis",
    legendTitle: "Local Moran clusters",
    modeLabel: "Clusters",
    short: "clusters",
    request: "analyze",
    file: "spatial-clusters.csv",
    /** Map classes: key → [label, color]; NS and NA take the theme's neutral colors. */
    classes: () => clusters,
    /** The keys a compact legend shows for a layer that is not the focus. */
    swatches: ["HH", "LL", "HL", "LH"],
    classOf: (record) => record?.cluster ?? "NA",
    featureRows: (record) => [
      ["Local Moran’s I", fixed(record.localI)],
      ["Permutation p", fixed(record.p)],
      ["FDR q", fixed(record.q)],
      ["Classification", clusters[record.cluster][0]],
    ],
    summaryRows: (result) => [
      ["Global Moran’s I", fixed(result.globalI)],
      ["Permutation p", fixed(result.globalP)],
      ["Eligible areas", number(result.n, 0)],
    ],
    /** One line for the report's summary table. */
    reportText: (result) =>
      "Global Moran's I " + fixed(result.globalI) + " · p " + fixed(result.globalP) + " · " + result.studyName,
    /** What the significance rule was, for notes under the map. */
    rule: (result) => (result.fdr ? "FDR q" : "p") + " ≤ " + (result.alpha ?? 0.05),
    csvFields: [
      "GEOID_or_feature_ID",
      "measure",
      "value",
      "z",
      "neighbor_mean_z",
      "local_I",
      "permutation_p",
      "FDR_q",
      "cluster",
      ...SHARED_CSV.slice(0, 4),
      "global_I",
      "global_p",
      ...SHARED_CSV.slice(4),
    ],
    csvRow: (id, r, result, state) => {
      const shared = sharedRow(r, result, state.rule);
      return [
        id,
        state.measure,
        r.value,
        r.z,
        r.lag,
        r.localI,
        r.p,
        r.q,
        r.cluster,
        ...shared.slice(0, 4),
        result.globalI,
        result.globalP,
        ...shared.slice(4),
      ];
    },
    scatter: true,
    reading: true,
  },
};

// Hot and cold spots share the diverging red–blue of ColorBrewer RdBu.
const hotCold = {
  H99: ["Hot spot, 99% confidence", "#b2182b"],
  H95: ["Hot spot, 95% confidence", "#ef8a62"],
  H90: ["Hot spot, 90% confidence", "#fddbc7"],
  NS: ["Not significant", "#c9d0cc"],
  C90: ["Cold spot, 90% confidence", "#d1e5f0"],
  C95: ["Cold spot, 95% confidence", "#67a9cf"],
  C99: ["Cold spot, 99% confidence", "#2166ac"],
  NA: ["Unavailable", "#8a918b"],
};
const countOf = (result, prefix) => Object.values(result.byId).filter((r) => r.cluster?.startsWith(prefix)).length;
const globalText = (g, name) => (g ? fixed(g[name]) + " (z " + fixed(g.z, 2) + ", p " + fixed(g.p) + ")" : "Needs values ≥ 0");

METHODS.gistar = {
  id: "gistar",
  label: "Hot and cold spots (Getis–Ord Gi*)",
  title: "Hot spot analysis",
  legendTitle: "Gi* hot and cold spots",
  modeLabel: "Hot spots",
  short: "hot spots",
  request: "gistar",
  file: "hot-spots.csv",
  classes: () => hotCold,
  swatches: ["H99", "H90", "C90", "C99"],
  classOf: (record) => record?.cluster ?? "NA",
  featureRows: (record, result) => [
    ["Gi* z-score", fixed(record.gi, 3)],
    [result?.inference === "permutation" ? "Permutation p" : "Normal p", fixed(record.p)],
    ["FDR q", fixed(record.q)],
    ["Classification", hotCold[record.cluster][0]],
  ],
  summaryRows: (result) => [
    ["Hot spots", number(countOf(result, "H"), 0)],
    ["Cold spots", number(countOf(result, "C"), 0)],
    ["General G", globalText(result.generalG, "G")],
    ["Geary’s C", globalText(result.geary, "C")],
    ["Eligible areas", number(result.n, 0)],
  ],
  reportText: (result) =>
    countOf(result, "H") + " hot and " + countOf(result, "C") + " cold spots (90% confidence or more) · " + result.studyName,
  rule: (result) => (result.fdr ? "FDR q" : "p") + " ≤ 0.10, 0.05, 0.01",
  ruleText: (result) =>
    (result.inference === "permutation" ? "Conditional permutations" : "Normal approximation") +
    (result.fdr ? ", FDR-adjusted" : "") +
    " · bins at 90, 95 and 99% confidence",
  csvFields: [
    "GEOID_or_feature_ID",
    "measure",
    "value",
    "Gi_star_z",
    "p_value",
    "FDR_q",
    "hot_cold_bin",
    ...SHARED_CSV.slice(0, 4),
    "general_G",
    "general_G_z",
    "gearys_C",
    "gearys_C_z",
    "inference",
    ...SHARED_CSV.slice(4),
  ],
  csvRow: (id, r, result, state) => {
    const shared = sharedRow(r, result, state.rule);
    return [
      id,
      state.measure,
      r.value,
      r.gi,
      r.p,
      r.q,
      r.cluster,
      ...shared.slice(0, 4),
      result.generalG?.G,
      result.generalG?.z,
      result.geary?.C,
      result.geary?.z,
      result.inference,
      ...shared.slice(4),
    ];
  },
  scatter: false,
  reading: false,
};

const lisa = METHODS.lisa;

METHODS.bilisa = {
  ...lisa,
  id: "bilisa",
  label: "Bivariate clusters (a measure against neighbors' second measure)",
  title: "Bivariate cluster analysis",
  legendTitle: "Bivariate Local Moran clusters",
  short: "bivariate clusters",
  request: "bilisa",
  file: "bivariate-clusters.csv",
  featureRows: (record, result) => [
    [result?.secondLabel || "Second measure", record.second == null ? "Unavailable" : number(record.second)],
    ["Bivariate local I", fixed(record.localI)],
    ["Permutation p", fixed(record.p)],
    ["FDR q", fixed(record.q)],
    ["Classification", clusters[record.cluster][0]],
  ],
  summaryRows: (result) => [
    ["Second measure", result.secondLabel || ""],
    ["Bivariate Moran’s I", fixed(result.globalI)],
    ["Permutation p", fixed(result.globalP)],
    ["Eligible areas", number(result.n, 0)],
  ],
  reportText: (result) =>
    "Bivariate Moran's I " + fixed(result.globalI) + " (with neighbors' " + result.secondLabel + ") · p " +
    fixed(result.globalP) + " · " + result.studyName,
  scatterLabels: ["Standardized measure", "Neighbors' second measure"],
  csvFields: [...lisa.csvFields.slice(0, 3), "second_measure", "second_value", ...lisa.csvFields.slice(3)],
  csvRow: (id, r, result, state) => {
    const row = lisa.csvRow(id, r, result, state);
    return [...row.slice(0, 3), state.yField, r.second, ...row.slice(3)];
  },
  reading: false,
};

METHODS.eblisa = {
  ...lisa,
  id: "eblisa",
  label: "Rate clusters, EB-adjusted (Local Moran)",
  title: "EB rate cluster analysis",
  legendTitle: "EB-adjusted Local Moran clusters",
  short: "EB rate clusters",
  request: "eblisa",
  file: "eb-rate-clusters.csv",
  featureRows: (record) => [
    ["Raw rate", record.rate == null ? "Unavailable" : number(record.rate, 5)],
    ["EB-standardized rate", fixed(record.value, 3)],
    ...lisa.featureRows(record),
  ],
  summaryRows: (result) => [
    ["EB Moran’s I", fixed(result.globalI)],
    ["Permutation p", fixed(result.globalP)],
    ["Pooled rate", result.eb ? number(result.eb.b, 6) : ""],
    ["Eligible areas", number(result.n, 0)],
  ],
  reportText: (result) => "EB-adjusted Moran's I " + fixed(result.globalI) + " · p " + fixed(result.globalP) + " · " + result.studyName,
  scatterLabels: ["EB-standardized rate", "Neighbor average"],
  csvFields: [...lisa.csvFields.slice(0, 3), "raw_rate", ...lisa.csvFields.slice(3)],
  csvRow: (id, r, result, state) => {
    const row = lisa.csvRow(id, r, result, state);
    return [...row.slice(0, 3), r.rate, ...row.slice(3)];
  },
  reading: false,
};

// Scan clusters by rank: reds for excess, blues for deficits, lightest last.
const HIGH = ["#b2182b", "#d6604d", "#f4a582", "#fddbc7"],
  LOW = ["#2166ac", "#4393c3", "#92c5de", "#d1e5f0"];
const scanClasses = (result) => {
  const out = {};
  const list = result?.clusters?.length ? result.clusters : [1, 2, 3].map((rank) => ({ rank, cases: 1, expected: 0 }));
  for (const k of list) {
    const high = k.cases >= k.expected,
      color = (high ? HIGH : LOW)[Math.min(k.rank, 4) - 1];
    const kind = (high ? "High" : "Low") + "-rate";
    out["K" + k.rank] = [
      (k.rank === 1 ? "Most likely " + kind.toLowerCase() + " cluster" : kind + " cluster " + k.rank) +
        (k.p != null ? " (p " + fixed(k.p, 3) + ")" : ""),
      color,
    ];
  }
  out.NS = ["Not in a reported cluster", "#c9d0cc"];
  out.NA = ["Unavailable", "#8a918b"];
  return out;
};
const clusterOf = (result, record) => result?.clusters?.find((k) => "K" + k.rank === record?.cluster);
const miles = (m) => number(m / 1609.344, 1) + " mi";

METHODS.scan = {
  id: "scan",
  label: "Rate clusters (Kulldorff spatial scan)",
  title: "Spatial scan",
  legendTitle: "Spatial scan clusters",
  modeLabel: "Clusters",
  short: "scan clusters",
  request: "scan",
  file: "scan-clusters.csv",
  classes: scanClasses,
  swatches: ["K1", "K2", "K3"],
  classOf: (record) => record?.cluster ?? "NA",
  featureRows: (record, result) => {
    const k = clusterOf(result, record);
    return [
      ["Cases", number(record.cases, 0)],
      ["Expected", fixed(record.expected, 1)],
      ["Observed ÷ expected", fixed(record.cases / record.expected, 2)],
      ["Cluster", k ? (k.rank === 1 ? "Most likely" : "Secondary " + k.rank) + " · p " + fixed(k.p, 3) : "None reported"],
    ];
  },
  summaryRows: (result) => [
    ...result.clusters.map((k) => [
      (k.rank === 1 ? "Most likely" : "Cluster " + k.rank),
      k.members.length + " areas · O/E " + fixed(k.ratio, 2) + " · RR " + fixed(k.relativeRisk, 2) + " · LLR " +
        fixed(k.llr, 2) + " · p " + fixed(k.p, 3),
    ]),
    ["Cases", number(result.total.cases, 0) + " in " + number(result.n, 0) + " areas"],
    ...(result.missing ? [["Left out", number(result.missing, 0) + " areas without counts"]] : []),
  ],
  reportText: (result) => {
    const k = result.clusters[0];
    return k
      ? "Most likely cluster: " + k.members.length + " areas, RR " + fixed(k.relativeRisk, 2) + ", p " + fixed(k.p, 3) +
          (result.clusters.length > 1 ? " · " + (result.clusters.length - 1) + " secondary" : "") + " · " + result.studyName
      : "No cluster · " + result.studyName;
  },
  rule: () => "secondary clusters at p ≤ 0.05",
  ruleText: (result) =>
    "Windows up to " + Math.round(result.maxPop * 100) + "% of the population" +
    (result.maxMiles ? " and " + result.maxMiles + " mi" : "") +
    " · scanning for " + (result.direction === "both" ? "high and low" : result.direction) + " rates",
  csvFields: [
    "GEOID_or_feature_ID",
    "measure",
    "cases",
    "population",
    "expected",
    "cluster",
    "cluster_llr",
    "cluster_relative_risk",
    "cluster_p",
    "cluster_radius_mi",
    "cluster_center",
    "reason",
    "study_area",
    "replicates",
    "seed",
    "max_population_share",
    "max_radius_mi",
    "direction",
    "method",
  ],
  csvRow: (id, r, result, state) => {
    const k = clusterOf(result, r);
    return [
      id,
      state.measure,
      r.cases,
      r.population,
      r.expected,
      r.cluster,
      k?.llr,
      k?.relativeRisk,
      k?.p,
      k ? k.radius / 1609.344 : null,
      k?.center,
      r.reason,
      result.studyName,
      result.permutations,
      result.seed,
      result.maxPop,
      result.maxMiles,
      result.direction,
      result.methodNote,
    ];
  },
  /** What the analysis was built on, for the summary and notes. */
  basis: (result) => "Windows around " + (result.from || "area centers"),
  trials: "replicates",
  scatter: false,
  reading: false,
  miles,
};

const MODEL_NAMES = {
  ols: "Ordinary least squares",
  lag: "Spatial lag (maximum likelihood)",
  error: "Spatial error (maximum likelihood)",
  poisson: "Poisson (log-population offset)",
  nb: "Negative binomial (log-population offset)",
};

// Regression residuals: standardized, in GeoDa's bands, on RdBu (red: the
// measure is higher than the model predicts).
const residualClasses = {
  P3: ["More than 2.5 SD above the prediction", "#b2182b"],
  P2: ["1.5 to 2.5 SD above", "#ef8a62"],
  P1: ["0.5 to 1.5 SD above", "#fddbc7"],
  Z: ["Within 0.5 SD", "#c9d0cc"],
  N1: ["0.5 to 1.5 SD below", "#d1e5f0"],
  N2: ["1.5 to 2.5 SD below", "#67a9cf"],
  N3: ["More than 2.5 SD below the prediction", "#2166ac"],
  NA: ["Unavailable", "#8a918b"],
};
const pText = (p) => (p < 0.0001 ? "<0.0001" : fixed(p));
/** Three significant digits, for rate ratios that can be very small. */
const sig = (v) => (Number.isFinite(v) ? String(Number(v.toPrecision(3))) : "");
const testRow = (name, t) => (t ? [name, fixed(t.statistic, 3), String(t.df ?? ""), pText(t.p)] : null);

METHODS.model = {
  id: "model",
  label: "Regression (linear, spatial or count)",
  title: "Regression",
  legendTitle: "Standardized residuals",
  modeLabel: "Residuals",
  short: "residuals",
  request: "model",
  file: "regression-areas.csv",
  classes: () => residualClasses,
  swatches: ["P3", "P1", "N1", "N3"],
  classOf: (record) => record?.cluster ?? "NA",
  featureRows: (record, result) =>
    COUNTED.has(result?.modelType)
      ? [
          ["Observed count", number(record.value, 0)],
          ["Expected by the model", fixed(record.fitted, 1)],
          ["Pearson residual", fixed(record.residual, 2)],
        ]
      : [
          ["Predicted", fixed(record.fitted, 3)],
          ["Residual", fixed(record.residual, 3)],
          ["Standardized residual", fixed(record.standardized, 2)],
        ],
  summaryRows: (result) => [
    ["Model", MODEL_NAMES[result.modelType || "ols"]],
    ["Areas", number(result.n, 0)],
    ...(COUNTED.has(result.modelType)
      ? [
          ["Deviance · null", fixed(result.deviance.residual, 2) + " · " + fixed(result.deviance.null, 2) + " (df " + result.deviance.df + ")"],
          ["Log-likelihood · AIC", fixed(result.logLik, 2) + " · " + fixed(result.aic, 2)],
          result.theta
            ? ["θ (dispersion)", fixed(result.theta.estimate, 3) + " (SE " + fixed(result.theta.se, 3) + ")"]
            : ["Pearson χ² / df", fixed(result.dispersion, 2) + (result.dispersion > 1.5 ? " (overdispersed: try negative binomial)" : "")],
          ["Residual Moran’s I", fixed(result.residualMoran.I, 4) + " (permutation p " + fixed(result.residualMoran.p, 3) + ")"],
        ]
      : linearSummary(result)),
  ],
  /** Tables under the summary: [{ caption, head, rows }]. */
  details: (result) => (COUNTED.has(result.modelType) ? countDetails(result) : linearDetails(result)),
  /** Charts under the tables: [{ kind, … }] for ui/chart.js. */
  charts: (result) => {
    const counted = COUNTED.has(result.modelType);
    const records = Object.entries(result.byId).filter(([, r]) => Number.isFinite(r.fitted));
    return [
      {
        kind: "points",
        points: records.map(([id, r]) => ({ id, x: r.fitted, y: r.residual })),
        xLabel: counted ? "Expected count" : "Predicted",
        yLabel: counted ? "Pearson residual" : "Residual",
        reference: 0,
      },
      { kind: "histogram", values: records.map(([, r]) => r.standardized), xLabel: counted ? "Pearson residual" : "Standardized residual" },
    ];
  },
  reportText: (result) =>
    (COUNTED.has(result.modelType)
      ? MODEL_NAMES[result.modelType] + ": AIC " + fixed(result.aic, 1) + ", " + number(result.n, 0) + " areas · residual Moran's I " + fixed(result.residualMoran.I, 3)
      : "R² " + fixed(result.r2, 3) + " on " + result.covariates.length + " covariates, " + number(result.n, 0) + " areas" +
        (result.spatial ? " · residual Moran's I " + fixed(result.spatial.moran.I, 3) + " (p " + pText(result.spatial.moran.p) + ")" : "")) +
    " · " + result.studyName,
  rule: () => "residuals in standard deviations",
  ruleText: (result) => result.suggestion || "",
  csvFields: [
    "GEOID_or_feature_ID",
    "measure",
    "value",
    "predicted",
    "residual",
    "standardized_residual",
    "residual_class",
    "reason",
    "study_area",
    "covariates",
    "neighbor_rule",
    "method",
  ],
  csvRow: (id, r, result, state) => [
    id,
    state.measure,
    r.value,
    r.fitted,
    r.residual,
    r.standardized,
    r.cluster,
    r.reason,
    result.studyName,
    result.covariates.join(" "),
    result.weights?.label || state.rule,
    result.methodNote,
  ],
  /** Further downloads from the summary: the coefficient and diagnostic tables. */
  exports: [{ label: "Export coefficients", file: "regression-model.csv" }],
  scatter: false,
  reading: false,
  trials: null,
};

// The linear models' summary rows (after the model and area count).
function linearSummary(result) {
  return [
    ...(result.parameter
      ? [
          [result.parameter.name, fixed(result.parameter.estimate, 4) + " (SE " + fixed(result.parameter.se, 4) + ", p " + pText(result.parameter.p) + ")"],
          ["LR test against OLS", fixed(result.lr.statistic, 2) + " (p " + pText(result.lr.p) + ")"],
          ["AIC · OLS AIC", fixed(result.aic, 2) + " · " + fixed(result.olsAic, 2)],
          ["Model residual Moran’s I", fixed(result.residualMoran, 4)],
        ]
      : [
          ["R² · adjusted", fixed(result.r2, 3) + " · " + fixed(result.adjR2, 3)],
          ["F", fixed(result.F.statistic, 2) + " (p " + pText(result.F.p) + ")"],
        ]),
    ["Log-likelihood · AIC", fixed(result.logLik, 2) + " · " + fixed(result.aic, 2)],
    ["Condition number", fixed(result.conditionNumber, 1) + (result.conditionNumber > 30 ? " (collinearity likely)" : "")],
    ...(result.spatial
      ? [[(result.parameter ? "OLS residual" : "Residual") + " Moran’s I", fixed(result.spatial.moran.I, 4) + " (z " + fixed(result.spatial.moran.z, 2) + ", p " + pText(result.spatial.moran.p) + ")"]]
      : []),
  ];
}

// The linear models' tables: coefficients, impacts (lag), diagnostics.
function linearDetails(result) {
  return [
    {
      caption: "Coefficients",
      head: ["", "Estimate", "SE", result.parameter ? "z" : "t", "p", "VIF"],
      rows: result.coefficients.map((c, j) => [
        c.label || c.name,
        fixed(c.estimate, 4),
        fixed(c.se, 4),
        fixed(c.statistic, 2),
        pText(c.p),
        j && result.vif?.[j - 1] != null ? fixed(result.vif[j - 1], 2) : "",
      ]),
    },
    ...(result.impacts
      ? [
          {
            caption: "Impacts (average effect of a unit change)",
            head: ["", "Direct", "Indirect", "Total"],
            rows: result.impacts.map((m) => [m.label || m.name, fixed(m.direct, 4), fixed(m.indirect, 4), fixed(m.total, 4)]),
          },
        ]
      : []),
    {
      caption: result.parameter ? "OLS diagnostics" : "Diagnostics",
      head: ["Test", "Value", "df", "p"],
      rows: [
        testRow("Jarque–Bera (normality)", result.jarqueBera),
        testRow("Breusch–Pagan", result.breuschPagan),
        testRow("Koenker–Bassett", result.koenker),
        result.spatial && ["Moran’s I (residuals)", fixed(result.spatial.moran.I, 4), "", pText(result.spatial.moran.p)],
        testRow("LM-lag", result.spatial?.lmLag),
        testRow("Robust LM-lag", result.spatial?.robustLmLag),
        testRow("LM-error", result.spatial?.lmError),
        testRow("Robust LM-error", result.spatial?.robustLmError),
        testRow("SARMA", result.spatial?.sarma),
      ].filter(Boolean),
      note: result.suggestion,
    },
  ];
}

// A count model's tables: coefficients as rate ratios, and the fit tests.
function countDetails(result) {
  return [
    {
      caption: "Coefficients",
      head: ["", "Estimate", "SE", "z", "p", "Rate ratio", "95% CI"],
      rows: result.coefficients.map((c) => [
        c.label || c.name,
        fixed(c.estimate, 4),
        fixed(c.se, 4),
        fixed(c.statistic, 2),
        pText(c.p),
        sig(c.ratio),
        sig(c.lower) + "–" + sig(c.upper),
      ]),
    },
    {
      caption: "Fit",
      head: ["Test", "Value", "df", "p"],
      rows: [
        ["Residual deviance", fixed(result.deviance.residual, 2), String(result.deviance.df), pText(result.deviance.p)],
        ["Moran’s I (Pearson residuals)", fixed(result.residualMoran.I, 4), "", fixed(result.residualMoran.p, 3)],
      ],
      note: result.theta
        ? "θ = " + fixed(result.theta.estimate, 3) + ": the variance is μ + μ²/θ."
        : result.dispersion > 1.5
          ? "The Pearson χ²/df of " + fixed(result.dispersion, 2) + " shows overdispersion; the negative binomial model allows for it."
          : null,
    },
  ];
}

const COUNTED = new Set(["poisson", "nb"]);

/** The methods in the order the menu lists them. */
export const METHOD_LIST = Object.values(METHODS);

/** What a result was built on: its weights, or the method's own basis. */
export const basisOf = (result, rule) => methodOf(result).basis?.(result) || result?.weights?.label || rule + " neighbors";

/** The method that made a result (Local Moran for results saved before methods). */
export const methodOf = (result) => METHODS[result?.method] || METHODS.lisa;

/** A known method id, or "lisa". */
export const methodId = (id) => (METHODS[id] ? id : "lisa");
