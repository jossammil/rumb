const paths = {
  layers: '<path d="m3 8 9-5 9 5-9 5zM3 12l9 5 9-5M3 16l9 5 9-5"/>',
  data: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 4 16 4 16 0V5M4 12v7c0 4 16 4 16 0v-7"/>',
  code: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16"/>',
  map: '<path d="m3 5 6-2 6 3 6-2v15l-6 2-6-3-6 2zM9 3v15m6-12v15"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  folder: '<path d="M3 18V5h6l3 3h8v3M3 19l3-8h16l-3 8z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  fit: '<path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"/>',
  inspect: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  sliders:
    '<path d="M3 7h7m5 0h6M3 17h3m5 0h10"/><circle cx="12.5" cy="7" r="2.5"/><circle cx="8.5" cy="17" r="2.5"/>',
  cluster:
    '<circle cx="5" cy="7" r="2"/><circle cx="17" cy="4" r="2"/><circle cx="12" cy="14" r="2"/><circle cx="20" cy="19" r="2"/><path d="m7 7 8-2m1 1-3 6m1 3 4 3m-8-5L6 9"/>',
  photo: '<path d="M3 7h4l2-3h6l2 3h4v13H3z"/><circle cx="12" cy="13" r="4"/>',
  chart: '<path d="M4 3v17h17M8 15l4-5 3 2 5-7"/>',
  pin: '<path d="M19 10c0 6-7 12-7 12S5 16 5 10a7 7 0 0 1 14 0z"/><circle cx="12" cy="10" r="2.5"/>',
  play: '<path d="m7 4 13 8-13 8z"/>',
  select: '<path d="m5 3 5 17 3-7 7-3z"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  legend: '<path d="M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
};
export function icon(name, size = 18) {
  return (
    '<svg width="' +
    size +
    '" height="' +
    size +
    '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    (paths[name] || "") +
    "</svg>"
  );
}
export const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const number = (v, digits = 1) =>
  v == null || !Number.isFinite(Number(v))
    ? "Unavailable"
    : Number(v).toLocaleString("en-US", { maximumFractionDigits: digits });
export const node = (id) => document.getElementById(id);
export const colors = {
  Lagoon: [
    "#e3eccd",
    "#b7d7ad",
    "#7dbda0",
    "#439d8c",
    "#246f70",
    "#12494e",
    "#092e34",
  ],
  Indigo: [
    "#f1ecf9",
    "#d9cfe9",
    "#b5addb",
    "#8e8cc7",
    "#6669ac",
    "#45478a",
    "#2b2a62",
  ],
  Ember: [
    "#fff1d4",
    "#f6d598",
    "#edb56d",
    "#d98d49",
    "#b85e36",
    "#903a2e",
    "#602520",
  ],
};
export const clusters = {
  HH: ["High–high", "#b65243"],
  LL: ["Low–low", "#326887"],
  HL: ["High–low", "#e39b7a"],
  LH: ["Low–high", "#96bed3"],
  NS: ["Not significant", "#d4dbd7"],
  NA: ["Unavailable", "#abb3af"],
};
export function classify(values, count, method) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return [];
  const cuts = [];
  for (let i = 1; i < count; i++) {
    const pos = ((sorted.length - 1) * i) / count,
      lo = Math.floor(pos);
    const q = sorted[lo] + (sorted[Math.ceil(pos)] - sorted[lo]) * (pos - lo);
    const cut =
      method === "quantile"
        ? q
        : sorted[0] + ((sorted.at(-1) - sorted[0]) * i) / count;
    if (cut > sorted[0] && cut < sorted.at(-1) && cuts.at(-1) !== cut)
      cuts.push(cut);
  }
  return cuts;
}
export function ramp(name, n) {
  const c = colors[name] || colors.Lagoon;
  return Array.from(
    { length: n },
    (_, i) => c[Math.round((i * (c.length - 1)) / Math.max(1, n - 1))],
  );
}
export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
