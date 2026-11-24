// Point pattern controls: an optional field to weight the points by (beds,
// enrollment, capacity) for the centers, ellipse and density.
import { h, options } from "../../ui/dom.js";

export function render(app, mount) {
  const { state } = app,
    l = app.layer();
  const numeric = Object.entries(l.meta?.fields || {}).filter(([, f]) => f.format === "integer" || f.format === "number");
  const weight = h(
    "select",
    {
      id: "point-weight",
      onchange: (ev) => {
        const pointWeight = ev.target.value || null;
        app.analysis.clearResults();
        app.store.set({ pointWeight });
        app.renderAll();
      },
    },
    options([["", "Each point counts once"], ...numeric.map(([k, f]) => [k, "Weighted by " + f.label.toLowerCase()])]),
  );
  weight.value = numeric.some(([k]) => k === state.pointWeight) ? state.pointWeight : "";
  mount.replaceChildren(
    h("label", { for: "point-weight", text: "Weights for the centers" }),
    weight,
    h("p", {
      class: "subtle",
      id: "points-note",
      text:
        app.kindOf(l) === "point"
          ? "Tests " + l.name + " against random placement inside " + app.catalog.region.name + "'s outline, and draws their centers and spread. Neighbors don't apply."
          : "Make a point layer the focus (Add layer, then click it) for a point pattern.",
    }),
  );
}
