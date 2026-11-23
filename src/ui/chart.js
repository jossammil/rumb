// Small SVG charts for the inspector and the statistics: the Moran
// scatterplot, a general scatterplot with axes, a line chart with an envelope
// band, and a histogram. Axis ticks use Plank's "nice" steps (1, 2 or 5 times
// a power of ten; ported from pqview/srcjs/src/summary.js). The tick helpers
// are pure; the charts build SVG with s() from ui/dom.js.
import { number } from "../catalog/format.js";
import { clusters } from "../map/classify.js";
import { s } from "./dom.js";

/** A "nice" step near span / target: 1, 2 or 5 times a power of ten (from Plank). */
export function niceStep(span, target, integer = false) {
  if (!(span > 0)) return 1;
  const raw = span / target;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
  return integer ? Math.max(1, Math.round(step)) : step;
}

/** Ticks covering [lo, hi] at a nice step: { lo, hi, ticks } with the range widened to whole steps. */
export function niceTicks(lo, hi, target = 5) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { lo: 0, hi: 1, ticks: [0, 1] };
  if (lo === hi) [lo, hi] = [lo - 1, hi + 1];
  const step = niceStep(hi - lo, target);
  // Whole multiples of the step, so no tick drifts off by rounding.
  const first = Math.floor(lo / step),
    last = Math.ceil(hi / step);
  const ticks = [];
  for (let k = first; k <= last; k++) ticks.push(+(k * step).toPrecision(12) || 0);
  return { lo: ticks[0], hi: ticks.at(-1), ticks };
}

/** Equal-width bins: [{ from, to, count }], at nice edges. */
export function bins(values, target = 12) {
  const v = values.filter(Number.isFinite);
  if (!v.length) return [];
  const { lo, hi } = niceTicks(Math.min(...v), Math.max(...v), target);
  const step = niceStep(hi - lo, target);
  const out = [];
  for (let from = lo; from < hi - step / 2; from += step) out.push({ from: +from.toPrecision(12), to: +(from + step).toPrecision(12), count: 0 });
  for (const x of v) out[Math.min(out.length - 1, Math.max(0, Math.floor((x - lo) / step)))].count++;
  return out;
}

/** The Moran scatterplot: standardized value against the neighbor average. */
export function scatter(result, selected, onPick, [xLabel, yLabel] = ["Standardized measure", "Neighbor average"]) {
  const points = Object.entries(result.byId).filter(
    ([, r]) => Number.isFinite(r.z) && Number.isFinite(r.lag),
  );
  const span = Math.max(0.1, ...points.flatMap(([, r]) => [Math.abs(r.z), Math.abs(r.lag)]));
  const x = (z) => 125 + (z / span) * 93,
    y = (lag) => 76 - (lag / span) * 57;
  const dots = points.map(([id, r]) =>
    s(
      "circle",
      {
        "data-point": id,
        cx: x(r.z),
        cy: y(r.lag),
        r: 2.9,
        class: r.cluster === "NS" ? "ns-dot" : null,
        fill: r.cluster === "NS" ? null : clusters[r.cluster][1],
        opacity: 0.7,
        onclick: () => onPick(id),
      },
      s("title", { text: id }),
    ),
  );
  const sel = result.byId[selected];
  return s(
    "svg",
    {
      class: "scatter",
      viewBox: "0 0 250 165",
      role: "img",
      "aria-label": "Moran scatterplot. Horizontal axis: " + xLabel + ". Vertical axis: " + yLabel + ".",
    },
    s("rect", { x: 26, y: 9, width: 199, height: 133, rx: 3, class: "plot-bg" }),
    s("path", { d: "M26 76h199M125 9v133", class: "plot-axis", "stroke-dasharray": "3 3" }),
    s("path", {
      d: "M32 " + y(-span * result.globalI) + "L218 " + y(span * result.globalI),
      class: "plot-fit",
    }),
    dots,
    sel?.z != null &&
      s("circle", {
        cx: x(sel.z),
        cy: y(sel.lag),
        r: 5,
        class: "plot-mark",
        "pointer-events": "none",
      }),
    s(
      "g",
      { "font-size": 9, class: "plot-text", "text-anchor": "middle" },
      s("text", { x: 125, y: 158, text: xLabel }),
      s("text", { transform: "translate(12 76) rotate(-90)", text: yLabel }),
    ),
  );
}

// The frame shared by the charts with axes: a 250 × 165 view, plot area inset.
const W = 250,
  H = 165,
  L = 34,
  R = 8,
  T = 8,
  B = 26;
function frame({ x, y, xLabel, yLabel, aria }, ...marks) {
  const sx = (v) => L + ((v - x.lo) / (x.hi - x.lo)) * (W - L - R),
    sy = (v) => H - B - ((v - y.lo) / (y.hi - y.lo)) * (H - T - B);
  return s(
    "svg",
    { class: "scatter chart", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": aria },
    s("rect", { x: L, y: T, width: W - L - R, height: H - T - B, rx: 3, class: "plot-bg" }),
    s(
      "g",
      { "font-size": 8, class: "plot-text" },
      x.ticks.map((t) => s("text", { x: sx(t), y: H - B + 10, "text-anchor": "middle", text: number(t) })),
      y.ticks.map((t) => s("text", { x: L - 3, y: sy(t) + 3, "text-anchor": "end", text: number(t) })),
    ),
    marks.map((mark) => mark(sx, sy)),
    s(
      "g",
      { "font-size": 9, class: "plot-text", "text-anchor": "middle" },
      s("text", { x: (L + W - R) / 2, y: H - 3, text: xLabel }),
      s("text", { transform: `translate(9 ${(T + H - B) / 2}) rotate(-90)`, text: yLabel }),
    ),
  );
}
const extent = (values) => {
  const v = values.filter(Number.isFinite);
  return [Math.min(...v), Math.max(...v)];
};

/**
 * Points [{ id, x, y }] with axes and an optional horizontal reference line,
 * such as residuals against fitted values. onPick(id) runs on a click.
 */
export function pointChart(points, { xLabel, yLabel, reference = null, selected = null, onPick = () => {} }) {
  const x = niceTicks(...extent(points.map((p) => p.x)), 5),
    y = niceTicks(...extent([...points.map((p) => p.y), ...(reference != null ? [reference] : [])]), 4);
  return frame(
    { x, y, xLabel, yLabel, aria: "Scatterplot of " + yLabel + " against " + xLabel + "." },
    (sx, sy) => reference != null && s("path", { d: `M${L} ${sy(reference)}H${W - R}`, class: "plot-axis", "stroke-dasharray": "3 3" }),
    (sx, sy) =>
      points.map((p) =>
        s(
          "circle",
          { "data-point": p.id, cx: sx(p.x), cy: sy(p.y), r: 2.6, class: "ns-dot", opacity: 0.75, onclick: () => onPick(p.id) },
          s("title", { text: p.id }),
        ),
      ),
    (sx, sy) => {
      const p = points.find((q) => q.id === selected);
      return p && s("circle", { cx: sx(p.x), cy: sy(p.y), r: 5, class: "plot-mark", "pointer-events": "none" });
    },
  );
}

/**
 * A line over x with an optional band (lo–hi, such as a simulation
 * envelope) and reference line: { x, y, lo, hi } arrays of equal length.
 */
export function lineChart({ x: xs, y: ys, lo, hi, reference = null }, { xLabel, yLabel }) {
  const x = niceTicks(...extent(xs), 5),
    y = niceTicks(...extent([...ys, ...(lo || []), ...(hi || []), ...(reference != null ? [reference] : [])]), 4);
  const path = (values, sx, sy) => values.map((v, i) => (i ? "L" : "M") + sx(xs[i]).toFixed(1) + " " + sy(v).toFixed(1)).join("");
  return frame(
    { x, y, xLabel, yLabel, aria: "Line chart of " + yLabel + " against " + xLabel + (lo ? ", with an envelope." : ".") },
    (sx, sy) =>
      lo &&
      s("path", {
        d: path(hi, sx, sy) + xs.map((_, i) => "L" + sx(xs[xs.length - 1 - i]).toFixed(1) + " " + sy(lo[xs.length - 1 - i]).toFixed(1)).join("") + "Z",
        class: "plot-band",
      }),
    (sx, sy) => reference != null && s("path", { d: `M${L} ${sy(reference)}H${W - R}`, class: "plot-axis", "stroke-dasharray": "3 3" }),
    (sx, sy) => s("path", { d: path(ys, sx, sy), class: "plot-fit", fill: "none" }),
  );
}

/** A histogram of values in equal-width bins. */
export function histogram(values, { xLabel, yLabel = "Areas", target = 12 }) {
  const b = bins(values, target);
  if (!b.length) return null;
  const x = { lo: b[0].from, hi: b.at(-1).to, ticks: niceTicks(b[0].from, b.at(-1).to, 5).ticks.filter((t) => t >= b[0].from && t <= b.at(-1).to) };
  const y = niceTicks(0, Math.max(...b.map((v) => v.count)), 4);
  return frame(
    { x, y, xLabel, yLabel, aria: "Histogram of " + xLabel + "." },
    (sx, sy) =>
      b.map((v) =>
        s(
          "rect",
          { x: sx(v.from) + 0.5, y: sy(v.count), width: Math.max(0.5, sx(v.to) - sx(v.from) - 1), height: sy(0) - sy(v.count), class: "plot-bar" },
          s("title", { text: number(v.from) + " to " + number(v.to) + ": " + v.count }),
        ),
      ),
  );
}
