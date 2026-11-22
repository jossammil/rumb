// Data colors and class breaks. Palettes stay the same in every theme so a map
// reads the same in a saved image; each is checked against dark backgrounds.

export const palettes = {
  Lagoon: ["#e3eccd", "#b7d7ad", "#7dbda0", "#439d8c", "#246f70", "#12494e", "#092e34"],
  Indigo: ["#f1ecf9", "#d9cfe9", "#b5addb", "#8e8cc7", "#6669ac", "#45478a", "#2b2a62"],
  Ember: ["#fff1d4", "#f6d598", "#edb56d", "#d98d49", "#b85e36", "#903a2e", "#602520"],
  Viridis: ["#440154", "#443a83", "#31688e", "#21908c", "#35b779", "#8fd744", "#fde725"],
  // Magma's near-black start is dropped so the lowest class stays visible on dark maps.
  Magma: ["#51127c", "#822681", "#b63679", "#e65164", "#fb8861", "#fec287", "#fcfdbf"],
  Cividis: ["#00204d", "#2a406c", "#575c6d", "#7c7b78", "#a69d75", "#d3c164", "#ffea46"],
};

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
 * Interior class breaks for quantile or equal-interval classes. Breaks equal to
 * the minimum or maximum, or repeated, are dropped, so a legend can show fewer
 * classes than asked for.
 */
export function classify(values, count, method) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return [];
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

/** n colors spread evenly across a palette. */
export function ramp(name, n) {
  const c = palettes[name] || palettes.Lagoon;
  return Array.from(
    { length: n },
    (_, i) => c[Math.round((i * (c.length - 1)) / Math.max(1, n - 1))],
  );
}
