// The map legend, used by the map view and by Compare: either a ramp with its
// extents and class breaks, or a list of categories.
import { number } from "../catalog/format.js";
import { h } from "../ui/dom.js";

/** Legend entries for classed colors: "< 10", "10–<20", …, "≥ 40", then Unavailable. */
export function classItems(colors, cuts, na) {
  const fmt = (v) => number(v, 2);
  return colors
    .map((color, i) => ({
      color,
      text:
        colors.length === 1
          ? "All values"
          : i === 0
            ? "< " + fmt(cuts[0])
            : i === cuts.length
              ? "≥ " + fmt(cuts.at(-1))
              : fmt(cuts[i - 1]) + "–<" + fmt(cuts[i]),
    }))
    .concat({ color: na, text: "Unavailable", missing: true });
}

const chip = (color) => h("i", { class: "chip", style: { background: color } });

/**
 * Renders into el. kind "ramp": { title, items, extents: [lo, hi] | null, unit,
 * missing: count | null }. kind "categories": { title, items }.
 * `action` adds a button under the legend: { label, run }.
 */
export function renderLegend(el, { kind, title, items, extents, unit = "", missing, action }) {
  const shown = items.filter((x) => !x.missing);
  const parts = [h("div", { class: "legend-title", text: title })];
  if (kind === "categories") {
    parts.push(
      h(
        "div",
        { class: "legend-cats" },
        items.map((x) => h("span", null, chip(x.color), x.text)),
      ),
    );
  } else {
    parts.push(
      h(
        "div",
        { class: "legend-bar" },
        shown.map((x) => h("i", { title: x.text, style: { background: x.color } })),
      ),
    );
    if (extents)
      parts.push(
        h(
          "div",
          { class: "legend-extents" },
          h("span", { text: number(extents[0]) + unit }),
          h("span", { text: number(extents[1]) + unit }),
        ),
      );
    const na = items.find((x) => x.missing);
    if (missing != null && na)
      parts.push(h("div", { class: "legend-note" }, chip(na.color), number(missing) + " unavailable"));
    if (shown.length > 1)
      parts.push(
        h(
          "details",
          { class: "breaks" },
          h("summary", { text: "Class breaks" }),
          shown.map((x) => h("div", null, chip(x.color), x.text)),
        ),
      );
  }
  if (action)
    parts.push(h("button", { class: "plain-btn", text: action.label, onclick: action.run }));
  el.replaceChildren(...parts);
}
