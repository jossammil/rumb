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

/** The methods in the order the menu lists them. */
export const METHOD_LIST = Object.values(METHODS);

/** The method that made a result (Local Moran for results saved before methods). */
export const methodOf = (result) => METHODS[result?.method] || METHODS.lisa;

/** A known method id, or "lisa". */
export const methodId = (id) => (METHODS[id] ? id : "lisa");
