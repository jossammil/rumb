// Map style: the measure, classification and palette controls, and drawing
// the active layer's colors and legend.
import { fieldInfo } from "../catalog/catalog.js";
import { featureId } from "../core/features.js";
import { neutralColors } from "../map/basemap-style.js";
import { classify, classOf, clusters, palettes, ramp, UNIFORM_COLOR } from "../map/classify.js";
import { classItems, renderLegend } from "../map/legend.js";
import { $, h, options } from "../ui/dom.js";

export function createStyle(app) {
  let items = [];
  /** Features of the active layer by ID, as last drawn. */
  const values = new Map();

  function renderControls(fields) {
    const { state } = app;
    const measure = $("measure");
    measure.replaceChildren(
      ...(fields.length
        ? options(fields.map((f) => [f, app.label(f)]))
        : options([["", "Uniform style"]])),
    );
    measure.value = state.measure;
    measure.disabled = !fields.length;
    $("classification").value = state.classification;
    $("class-count").value = String(state.count);
    $("palettes").replaceChildren(
      ...Object.entries(palettes).map(([name, stops]) =>
        h(
          "button",
          {
            "aria-label": name + " palette",
            title: name,
            "aria-pressed": String(state.palette === name),
            "data-palette": name,
            onclick: () => {
              app.store.set({ palette: name });
              app.renderAll();
            },
          },
          stops.map((c) => h("span", { style: { background: c } })),
        ),
      ),
    );
  }

  /** Colors every feature, redraws the map and the legend, then the inspector. */
  function draw() {
    const { state } = app;
    if (state.view === "compare") return;
    const l = app.layer(),
      features = l.collection.features,
      data = features.map((f) => f.properties?.[state.measure]);
    const cuts = classify(data, state.count, state.classification),
      colors = ramp(state.palette, cuts.length + 1);
    const clustered = state.mode === "cluster" && state.result;
    const { na, ns } = neutralColors();
    const clusterColor = (key) => (key === "NS" ? ns : key === "NA" ? na : clusters[key][1]);
    values.clear();
    const annotated = features.map((f) => {
      const id = featureId(f),
        v = f.properties?.[state.measure];
      values.set(id, f);
      let color = !state.measure
        ? UNIFORM_COLOR
        : !Number.isFinite(v)
          ? na
          : colors[classOf(v, cuts)];
      if (clustered) color = clusterColor(state.result.byId[id]?.cluster ?? "NA");
      return { ...f, properties: { ...f.properties, __rumb_id: id, __rumb_color: color } };
    });
    app.atlas.setData(state.active, annotated);

    const legend = $("legend");
    const action = state.result
      ? {
          label: "View analysis",
          run: () => {
            app.store.set({ inspector: true });
            app.renderInspector();
          },
        }
      : null;
    if (clustered) {
      items = Object.entries(clusters).map(([key, [text]]) => ({ text, color: clusterColor(key) }));
      renderLegend(legend, { kind: "categories", title: "Local Moran clusters", items, action });
    } else if (!state.measure) {
      items = [{ color: UNIFORM_COLOR, text: "Features" }];
      renderLegend(legend, { kind: "ramp", title: "Features", items, action });
    } else {
      items = classItems(colors, cuts, na);
      const valid = data.filter(Number.isFinite);
      const unit = l.referenceFields ? fieldInfo(app.catalog, state.measure)?.unit || "" : "";
      renderLegend(legend, {
        kind: "ramp",
        title: app.label(state.measure),
        items,
        unit,
        extents: valid.length
          ? valid.reduce(([lo, hi], v) => [Math.min(lo, v), Math.max(hi, v)], [Infinity, -Infinity])
          : null,
        missing: data.length - valid.length,
        action,
      });
    }
    app.renderInspector();
  }

  return {
    renderControls,
    draw,
    values,
    /** Legend entries as drawn, for the PNG export. */
    legendItems: () => items,
  };
}
