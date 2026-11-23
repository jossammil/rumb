// Map style: the measure, classification and palette controls, and drawing
// every stacked layer's colors (each from its own view settings) and the focus
// layer's legend.
import { featureId } from "../core/features.js";
import { layerViewDefaults } from "../core/state.js";
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

  /** A layer's view settings: the state for the focus layer, else what it remembered. */
  function viewOf(l) {
    const { state } = app;
    if (l.id === state.active) return state;
    return (
      state.layerViews[l.id] ||
      layerViewDefaults(app.catalog, l.preferredMeasure || app.fieldList(l)[0] || "")
    );
  }

  /** One layer's features with __rumb_id and __rumb_color, and how they were classed. */
  function colorize(l, view) {
    const features = l.collection.features,
      measure = view.measure,
      data = features.map((f) => f.properties?.[measure]);
    const cuts = classify(data, view.count, view.classification),
      colors = ramp(view.palette, cuts.length + 1);
    const clustered = view.mode === "cluster" && view.result;
    const { na, ns } = neutralColors();
    const clusterColor = (key) => (key === "NS" ? ns : key === "NA" ? na : clusters[key][1]);
    const uniform = l.meta?.style?.color || UNIFORM_COLOR;
    const annotated = features.map((f) => {
      const id = featureId(f),
        v = f.properties?.[measure];
      let color = !measure ? uniform : !Number.isFinite(v) ? na : colors[classOf(v, cuts)];
      if (clustered) color = clusterColor(view.result.byId[id]?.cluster ?? "NA");
      return { ...f, properties: { ...f.properties, __rumb_id: id, __rumb_color: color } };
    });
    return { annotated, data, cuts, colors, clustered, clusterColor, uniform, na };
  }

  /** Colors every stacked layer, redraws the map and the legend, then the inspector. */
  function draw() {
    const { state } = app;
    if (state.view === "compare") return;
    let focus = null;
    for (const e of state.stack) {
      const l = app.layerById(e.id);
      if (!l || !app.atlas.has(e.id)) continue;
      const drawn = colorize(l, viewOf(l));
      app.atlas.setData(e.id, drawn.annotated);
      if (e.id === state.active) focus = drawn;
    }
    const l = app.layer();
    values.clear();
    for (const f of l.collection.features) values.set(featureId(f), f);
    const { data, cuts, colors, clustered, clusterColor, uniform, na } = focus || colorize(l, state);

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
      const title = l.meta ? l.name : "Features";
      items = [{ color: uniform, text: title }];
      renderLegend(legend, { kind: l.meta ? "categories" : "ramp", title, items, action });
    } else {
      items = classItems(colors, cuts, na);
      const valid = data.filter(Number.isFinite);
      const unit = app.fieldMeta(l, state.measure)?.unit || "";
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
