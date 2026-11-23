// "Export layer data…" (W): one layer on the map, all its features or the
// ones the filter keeps or the selection, as CSV, GeoJSON or GeoParquet.
import { plural } from "../catalog/format.js";
import { featureId } from "../core/features.js";
import { exportFeatures, exportName, featuresCSV, featuresGeoJSON } from "../data/export.js";
import { $, h, options, saveBlob } from "../ui/dom.js";

export function openExport(app) {
  const { state } = app;
  const layers = [...state.stack].reverse().map((e) => app.layerById(e.id)).filter(Boolean);
  const layerSelect = h("select", { id: "export-layer" }, options(layers.map((l) => [l.id, l.name]), state.active));
  const scope = h("select", { id: "export-scope" });
  const format = h(
    "select",
    { id: "export-format" },
    options([
      ["csv", "CSV (a table; points keep lon and lat)"],
      ["geojson", "GeoJSON (with geometry)"],
      ["parquet", "GeoParquet (with geometry; loads the SQL engine)"],
    ]),
  );
  const note = h("p", { class: "subtle" });
  /** The ids a scope keeps, or null for all. */
  function idsFor(l, which) {
    if (which === "filtered") return new Set(app.filter.keptFor(l)?.keys() || []);
    if (which === "selected") return new Set([...(state.picks || []), state.selected].filter(Boolean).map(String));
    return null;
  }
  function refresh() {
    const l = app.layerById(layerSelect.value);
    const choices = [["all", "All " + plural(l.collection.features.length, "feature")]];
    const kept = app.filter.keptFor(l);
    if (kept) choices.push(["filtered", "Kept by the filter (" + kept.size + ")"]);
    const sel = idsFor(l, "selected");
    if (l.id === state.active && sel.size) choices.push(["selected", "Selected (" + sel.size + ")"]);
    const was = scope.value;
    scope.replaceChildren(...options(choices, choices.some(([v]) => v === was) ? was : kept ? "filtered" : "all"));
    note.textContent =
      "Columns: every field, style_color and style_class as drawn" + (kept ? ", and distance_mi from the filter" : "") + ".";
  }
  layerSelect.onchange = refresh;
  async function run() {
    const l = app.layerById(layerSelect.value);
    const which = scope.value;
    const distances = app.filter.current()?.kind !== "polygon" ? app.filter.keptFor(l) : null;
    const features = exportFeatures(l.collection.features, {
      ids: idsFor(l, which),
      drawn: app.style.drawn(l.id),
      distances,
      idOf: featureId,
    });
    if (!features.length) throw new Error("There are no features to export.");
    const stem = exportName(l.id, which);
    if (format.value === "csv") saveBlob(new Blob([featuresCSV(features)], { type: "text/csv;charset=utf-8" }), stem + ".csv");
    else if (format.value === "geojson")
      saveBlob(new Blob([featuresGeoJSON(features)], { type: "application/geo+json" }), stem + ".geojson");
    else {
      const engine = await app.ws.db();
      app.status("Writing GeoParquet…", "running");
      saveBlob(await engine.exportGeoParquet(featuresGeoJSON(features)), stem + ".parquet");
    }
    $("dialog").close();
    app.notify("Exported " + plural(features.length, "feature") + " of " + l.name + ".");
  }
  $("dialog-content").replaceChildren(
    h(
      "div",
      { class: "dialog-body export" },
      h("h2", { text: "Export layer data" }),
      h("label", { for: "export-layer", text: "Layer" }),
      layerSelect,
      h("label", { for: "export-scope", text: "Features" }),
      scope,
      h("label", { for: "export-format", text: "Format" }),
      format,
      note,
      h("button", { class: "primary", id: "export-go", text: "Export", onclick: (ev) => app.perform(ev.currentTarget, run) }),
    ),
  );
  refresh();
  $("dialog").showModal();
}
