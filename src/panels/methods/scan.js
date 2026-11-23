// Spatial scan controls: how large a window may grow (a share of the
// population, and optionally a radius) and which rates to look for. The
// replicates and seed are the test settings below.
import { h, options } from "../../ui/dom.js";
import { poolOf } from "../../stats/pool.js";

export function render(app, mount) {
  const { state } = app,
    l = app.layer(),
    scan = { maxPop: 0.25, maxMiles: null, direction: "high", ...state.scan };
  const set = (patch) => {
    app.analysis.clearResults();
    app.store.set({ scan: { ...scan, ...patch } });
    app.renderAll();
  };
  const share = h(
    "select",
    { id: "scan-pop", onchange: (ev) => set({ maxPop: Number(ev.target.value) }) },
    options([
      ["0.05", "5% of the population"],
      ["0.1", "10%"],
      ["0.25", "25%"],
      ["0.5", "50% (SaTScan's default; slower)"],
    ]),
  );
  share.value = String(scan.maxPop);
  const radius = h("input", {
    id: "scan-miles",
    type: "number",
    min: 1,
    max: 300,
    step: 1,
    placeholder: "No limit",
    value: scan.maxMiles ?? "",
    onchange: (ev) => set({ maxMiles: Number(ev.target.value) >= 1 ? Math.min(300, Number(ev.target.value)) : null }),
  });
  const direction = h(
    "select",
    { id: "scan-direction", onchange: (ev) => set({ direction: ev.target.value }) },
    options([
      ["high", "High rates"],
      ["low", "Low rates"],
      ["both", "High and low rates"],
    ]),
  );
  direction.value = scan.direction;
  const pool = poolOf(app.fieldMeta(l, state.measure));
  mount.replaceChildren(
    h(
      "div",
      { class: "two-fields" },
      h("div", null, h("label", { for: "scan-pop", text: "Largest window" }), share),
      h("div", null, h("label", { for: "scan-miles", text: "Radius (mi)" }), radius),
    ),
    h("label", { for: "scan-direction", text: "Look for" }),
    direction,
    h("p", {
      class: "subtle",
      id: "scan-note",
      text: pool?.denominator
        ? "Cases: " + app.label(pool.numerator, l) + " · population: " + app.label(pool.denominator, l) +
          ". Replicates and seed are under Test settings."
        : "This measure has no counts. Choose a rate with a numerator and a denominator.",
    }),
  );
}
