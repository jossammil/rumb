// Data colors and class breaks. Palettes stay the same in every theme so a map
// reads the same in a saved image; each is checked against dark backgrounds.
// Methods: quantile, equal interval, Fisher's natural breaks (Jenks),
// standard deviations and manual breaks.

export const palettes = {
  Lagoon: ["#e3eccd", "#b7d7ad", "#7dbda0", "#439d8c", "#246f70", "#12494e", "#092e34"],
  Indigo: ["#f1ecf9", "#d9cfe9", "#b5addb", "#8e8cc7", "#6669ac", "#45478a", "#2b2a62"],
  Ember: ["#fff1d4", "#f6d598", "#edb56d", "#d98d49", "#b85e36", "#903a2e", "#602520"],
  Viridis: ["#440154", "#443a83", "#31688e", "#21908c", "#35b779", "#8fd744", "#fde725"],
  // Magma's near-black start is dropped so the lowest class stays visible on dark maps.
  Magma: ["#51127c", "#822681", "#b63679", "#e65164", "#fb8861", "#fec287", "#fcfdbf"],
  Cividis: ["#00204d", "#2a406c", "#575c6d", "#7c7b78", "#a69d75", "#d3c164", "#ffea46"],
  // Diverging, from ColorBrewer (Cynthia Brewer, Mark Harrower and The
  // Pennsylvania State University; Apache-2.0): low, neutral middle, high.
  RdBu: ["#b2182b", "#ef8a62", "#fddbc7", "#f7f7f7", "#d1e5f0", "#67a9cf", "#2166ac"],
  PiYG: ["#c51b7d", "#e9a3c9", "#fde0ef", "#f7f7f7", "#e6f5d0", "#a1d76a", "#4d9221"],
  BrBG: ["#8c510a", "#d8b365", "#f6e8c3", "#f5f5f5", "#c7eae5", "#5ab4ac", "#01665e"],
};

/** Readable names for palettes whose key is a ColorBrewer code. */
export const PALETTE_NAMES = { RdBu: "Red–blue", PiYG: "Pink–green", BrBG: "Brown–teal" };
export const DIVERGING = new Set(["RdBu", "PiYG", "BrBG"]);
export const paletteKind = (name) => (DIVERGING.has(name) ? "diverging" : "sequential");

/** Classification methods offered in the style panel. */
export const METHODS = {
  quantile: "Quantile",
  equal: "Equal interval",
  jenks: "Natural breaks (Jenks)",
  sd: "Standard deviation",
  manual: "Manual breaks",
};
export const MAX_CLASSES = 9;

/**
 * Category colors: Okabe and Ito's eight colors, distinguishable with the
 * common color-vision deficiencies. Grey is kept for "Other".
 */
export const QUALITATIVE = ["#e69f00", "#56b4e9", "#009e73", "#f0e442", "#0072b2", "#d55e00", "#cc79a7", "#b9b1a5"];
export const OTHER_COLOR = "#7d7d7d";

/**
 * Colors for a text field's values: the most frequent first, up to seven,
 * then "Other". Returns { items: [{ value, color, count }], colorOf(value) }.
 */
export function categories(values, max = 7) {
  const counts = new Map();
  for (const v of values) if (v != null && v !== "") counts.set(String(v), (counts.get(String(v)) || 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const kept = ranked.length > max + 1 ? ranked.slice(0, max) : ranked.slice(0, max + 1);
  const color = new Map(kept.map(([value], i) => [value, QUALITATIVE[i % QUALITATIVE.length]]));
  const items = kept.map(([value, count]) => ({ value, color: color.get(value), count }));
  const other = ranked.slice(kept.length).reduce((n, [, c]) => n + c, 0);
  if (other) items.push({ value: "Other", color: OTHER_COLOR, count: other, other: true });
  return { items, colorOf: (v) => (v == null || v === "" ? null : color.get(String(v)) || OTHER_COLOR) };
}

/** Text fields with a handful of distinct values (2 to 24), good for coloring by category. */
export function categoryFields(features, limit = 24) {
  const seen = new Map();
  for (const f of features)
    for (const [k, v] of Object.entries(f.properties || {})) {
      if (typeof v !== "string" || k.startsWith("__")) continue;
      const set = seen.get(k) || new Set();
      if (set.size <= limit) set.add(v);
      seen.set(k, set);
    }
  return [...seen].filter(([, set]) => set.size >= 2 && set.size <= limit).map(([k]) => k);
}

/** The single color of a layer with no measure. (Missing values and "not
 * significant" use theme colors: neutralColors() in basemap-style.js.) */
export const UNIFORM_COLOR = "#397d70";

/** LISA clusters and Compare quadrants share one high/low color language. */
export const quadrantColors = {
  HH: "#d0563f",
  LL: "#3a7fb0",
  HL: "#f0a57f",
  LH: "#9cc6dc",
};
export const clusters = {
  HH: ["High–high", quadrantColors.HH],
  LL: ["Low–low", quadrantColors.LL],
  HL: ["High–low", quadrantColors.HL],
  LH: ["Low–high", quadrantColors.LH],
  NS: ["Not significant", "#c9d0cc"],
  NA: ["Unavailable", "#8a918b"],
};

/**
 * Interior class breaks (cuts) for a method: "quantile", "equal", "jenks"
 * (Fisher's natural breaks), "sd" (standard deviations) or "manual" (the
 * `breaks` given). Breaks equal to the minimum or maximum, or repeated, are
 * dropped, so a legend can show fewer classes than asked for. A value v falls
 * in class classOf(v, cuts): the number of cuts at or below it.
 */
export function classify(values, count, method, { breaks } = {}) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return [];
  if (method === "manual")
    return [...new Set((breaks || []).filter(Number.isFinite))].sort((a, b) => a - b).slice(0, MAX_CLASSES - 1);
  if (method === "jenks") return jenks(sorted, count);
  if (method === "sd") return sdCuts(sorted, count);
  const cuts = [];
  for (let i = 1; i < count; i++) {
    const pos = ((sorted.length - 1) * i) / count,
      lo = Math.floor(pos);
    const q = sorted[lo] + (sorted[Math.ceil(pos)] - sorted[lo]) * (pos - lo);
    const cut =
      method === "quantile" ? q : sorted[0] + ((sorted.at(-1) - sorted[0]) * i) / count;
    if (cut > sorted[0] && cut < sorted.at(-1) && cuts.at(-1) !== cut) cuts.push(cut);
  }
  return cuts;
}

/**
 * Fisher's natural breaks: the k classes of consecutive values with the least
 * total within-class sum of squares (the optimum, not a heuristic). Equal
 * values stay together: the dynamic program runs on distinct values weighted
 * by how often they occur, and a divide-and-conquer search over the monotone
 * split points keeps it O(k·n·log n). Cuts lie halfway between neighboring
 * classes, as R's classInt reports them. `sorted` must be ascending.
 */
export function jenks(sorted, k) {
  const xs = [],
    ws = [];
  for (const v of sorted)
    if (xs.length && xs.at(-1) === v) ws[ws.length - 1]++;
    else xs.push(v), ws.push(1);
  const n = xs.length;
  k = Math.min(k, n);
  if (k < 2) return [];
  // Prefix sums of weight, weighted value and weighted square, centred for precision.
  const shift = xs[n >> 1];
  const W = new Float64Array(n + 1),
    S = new Float64Array(n + 1),
    Q = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const x = xs[i] - shift;
    W[i + 1] = W[i] + ws[i];
    S[i + 1] = S[i] + ws[i] * x;
    Q[i + 1] = Q[i] + ws[i] * x * x;
  }
  /** Within-class sum of squares of distinct values j..i (inclusive). */
  const sse = (j, i) => {
    const w = W[i + 1] - W[j],
      s = S[i + 1] - S[j];
    return Math.max(0, Q[i + 1] - Q[j] - (s * s) / w);
  };
  let prev = new Float64Array(n);
  for (let i = 0; i < n; i++) prev[i] = sse(0, i);
  const starts = [];
  for (let c = 1; c < k; c++) {
    const cur = new Float64Array(n).fill(Infinity),
      from = new Int32Array(n);
    // cur[i] = min over j (c ≤ j ≤ i) of prev[j - 1] + sse(j, i); the best j never decreases with i.
    const solve = (lo, hi, jlo, jhi) => {
      if (lo > hi) return;
      const mid = (lo + hi) >> 1;
      let best = Infinity,
        arg = jlo;
      for (let j = jlo; j <= Math.min(mid, jhi); j++) {
        const cost = prev[j - 1] + sse(j, mid);
        if (cost < best) (best = cost), (arg = j);
      }
      cur[mid] = best;
      from[mid] = arg;
      solve(lo, mid - 1, jlo, arg);
      solve(mid + 1, hi, arg, jhi);
    };
    solve(c, n - 1, c, n - 1);
    starts.push(from);
    prev = cur;
  }
  // Walk back from the last value to find where each class starts.
  const cuts = [];
  let end = n - 1;
  for (let c = k - 1; c >= 1; c--) {
    const j = starts[c - 1][end];
    cuts.unshift((xs[j - 1] + xs[j]) / 2);
    end = j - 1;
  }
  return cuts;
}

/** The total within-class sum of squares of a classification (for checking Jenks). */
export function withinSS(values, cuts) {
  const groups = new Map();
  for (const v of values.filter(Number.isFinite)) {
    const c = classOf(v, cuts),
      g = groups.get(c) || [];
    g.push(v);
    groups.set(c, g);
  }
  let total = 0;
  for (const g of groups.values()) {
    const mean = g.reduce((a, b) => a + b, 0) / g.length;
    for (const v of g) total += (v - mean) ** 2;
  }
  return total;
}

/**
 * Standard-deviation classes, one sample standard deviation wide and centred
 * on the mean: with an odd count the middle class is the mean ± 0.5 SD; with
 * an even count the mean is a break. Breaks beyond the data are dropped.
 */
export function sdCuts(sorted, count) {
  const n = sorted.length;
  if (n < 2) return [];
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(sorted.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1));
  if (!(sd > 0)) return [];
  const cuts = [];
  for (let k = 1; k < count; k++) {
    const cut = mean + sd * (k - count / 2);
    if (cut > sorted[0] && cut < sorted.at(-1)) cuts.push(cut);
  }
  return cuts;
}

/** Manual breaks typed as "10, 20; 30" (commas, semicolons or spaces): sorted, distinct; null if unreadable. */
export function parseBreaks(text) {
  const parts = String(text ?? "")
    .split(/[,;\s]+/)
    .filter(Boolean);
  if (!parts.length) return null;
  const values = parts.map(Number);
  if (values.some((v) => !Number.isFinite(v))) return null;
  return [...new Set(values)].sort((a, b) => a - b);
}

/** The class index of a value: how many breaks it reaches (binary search). */
export function classOf(value, cuts) {
  let lo = 0,
    hi = cuts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (value >= cuts[mid]) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * n colors across a palette. Sequential palettes with up to 7 classes take
 * stops directly (so existing maps keep their colors); longer ramps, and every
 * diverging ramp (so its middle stays in the middle), are sampled in OKLab.
 */
export function ramp(name, n) {
  const c = palettes[name] || palettes.Lagoon;
  if (n <= c.length && !DIVERGING.has(name))
    return Array.from(
      { length: n },
      (_, i) => c[Math.round((i * (c.length - 1)) / Math.max(1, n - 1))],
    );
  return Array.from({ length: n }, (_, i) => sample(c, n === 1 ? 0.5 : i / (n - 1)));
}

// OKLab (Björn Ottosson, 2020): perceptually even color mixing.
const toLinear = (u) => (u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4);
const toGamma = (u) => (u <= 0.0031308 ? 12.92 * u : 1.055 * u ** (1 / 2.4) - 0.055);
function oklab(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function hexOf([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return "#" + rgb.map((u) => Math.round(Math.min(1, Math.max(0, toGamma(u))) * 255).toString(16).padStart(2, "0")).join("");
}
/** The color at position t (0 to 1) along a list of stops, mixed in OKLab. */
export function sample(stops, t) {
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1),
    i = Math.min(stops.length - 2, Math.floor(x)),
    f = x - i;
  const a = oklab(stops[i]),
    b = oklab(stops[i + 1]);
  return hexOf(a.map((v, k) => v + (b[k] - v) * f));
}
