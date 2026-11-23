// Hot spot controls: whether Gi* p-values come from the normal approximation
// (ArcGIS, spdep::localG) or from conditional permutations (GeoDa).
import { h, options } from "../../ui/dom.js";

export function render(app, mount) {
  const select = h(
    "select",
    {
      id: "gi-inference",
      onchange: (ev) => {
        const inference = ev.target.value;
        app.analysis.clearResults();
        app.store.set({ inference });
        app.renderAll();
      },
    },
    options([
      ["normal", "Normal approximation (z-scores)"],
      ["permutation", "Conditional permutations"],
    ]),
  );
  select.value = app.state.inference === "permutation" ? "permutation" : "normal";
  mount.replaceChildren(h("label", { for: "gi-inference", text: "p-values from" }), select);
}
