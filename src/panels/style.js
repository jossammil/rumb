// Map style: the measure, classification and palette controls, and drawing
// every stacked layer's colors (each from its own view settings) and the focus
// layer's legend.
import { featureId } from "../core/features.js";
import { layerViewDefaults } from "../core/state.js";
import { neutralColors } from "../map/basemap-style.js";
import { categories, categoryFields, classify, classOf, clusters, palettes, ramp, UNIFORM_COLOR } from "../map/classify.js";
import { mapColors } from "../map/basemap-style.js";
import { classItems, renderLegend, renderOthers } from "../map/legend.js";
import { $, h, options } from "../ui/dom.js";

export function createStyle(app) {
  let items = [],
    others = [];
  /** Features of the active layer by ID, as last drawn. */
  const values = new Map();

  /** Text fields to color by: the catalog's type and place fields first. */
  function categoryChoices(l) {
    const found = categoryFields(l.collection.features);
    const first = [l.meta?.typeField, l.meta?.placeField].filter((f) => f && found.includes(f));
    return [...first, ...found.filter((f) => !first.includes(f))];
  }
  /** Fields a layer can be labeled with: its popup fields, else its text and number fields. */
  function labelChoices(l) {
    if (l.meta?.popupFields) return [l.meta.labelField, ...l.meta.popupFields].filter((f, i, a) => f && a.indexOf(f) === i);
    const props = l.collection.features[0]?.properties || {};
    return Object.keys(props).filter((k) => !k.startsWith("__") && ["string", "number"].includes(typeof props[k]));
  }

  function renderControls(fields) {
    const { state } = app;
    const l = app.layer(),
      kind = app.kindOf(l);
    const measure = $("measure");
    const cats = categoryChoices(l);
    measure.replaceChildren(
      ...(fields.length ? [h("optgroup", { label: "Measure" }, options(fields.map((f) => [f, app.label(f)])))] : []),
      ...(cats.length
        ? [h("optgroup", { label: "Category" }, options(cats.map((f) => ["category:" + f, app.label(f)])))]
        : []),
      ...options([["", fields.length ? "Single color" : "Uniform style"]]),
    );
    measure.value = state.category ? "category:" + state.category : state.measure || "";
    measure.disabled = !fields.length && !cats.length;
    const classed = !!state.measure && !state.category;
    $("classes-row").hidden = $("palette-row").hidden = !classed;
    renderLook(l, kind);
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

  /** The look controls, filled from the focus layer's stack entry. */
  function renderLook(l, kind) {
    const { state } = app;
    const entry = state.stack.find((e) => e.id === l.id) || {},
      look = entry.style || {};
    const single = !state.measure && !state.category;
    for (const el of document.querySelectorAll("#look [data-look]")) {
      const wants = el.dataset.look.split(" ");
      el.hidden = !wants.some((w) => (w === "single" ? single : w === kind || (kind === "mixed" && w !== "single")));
    }
    $("look-color").value = uniformOf(l);
    $("look-opacity").value = String(look.opacity ?? (kind === "point" ? 1 : 0.94));
    $("look-size").value = String(look.size ?? (kind === "line" ? 3 : 5));
    $("look-shape").value = look.shape || "circle";
    $("look-outline").value = String(look.outline ?? 0.75);
    $("look-outline-color").value = look.outlineColor || mapColors().outline;
    $("look-label").replaceChildren(
      ...options([["", "No labels"], ...labelChoices(l).map((f) => [f, app.label(f)])], entry.label || ""),
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

  /** A layer's single color: the reader's choice, else the catalog's, else the default. */
  const uniformOf = (l) =>
    app.state.stack.find((e) => e.id === l.id)?.style?.color || l.meta?.style?.color || UNIFORM_COLOR;

  /** One layer's features with __rumb_id and __rumb_color, and how they were classed. */
  function colorize(l, view) {
    const features = l.collection.features,
      category = view.category,
      measure = category ? "" : view.measure,
      data = features.map((f) => f.properties?.[measure]);
    const cuts = measure ? classify(data, view.count, view.classification) : [],
      colors = ramp(view.palette, cuts.length + 1);
    const cats = category ? categories(features.map((f) => f.properties?.[category])) : null;
    const clustered = view.mode === "cluster" && view.result;
    const { na, ns } = neutralColors();
    const clusterColor = (key) => (key === "NS" ? ns : key === "NA" ? na : clusters[key][1]);
    const uniform = uniformOf(l);
    const annotated = features.map((f) => {
      const id = featureId(f),
        v = f.properties?.[measure];
      let color = cats
        ? cats.colorOf(f.properties?.[category]) || na
        : !measure
          ? uniform
          : !Number.isFinite(v)
            ? na
            : colors[classOf(v, cuts)];
      if (clustered) color = clusterColor(view.result.byId[id]?.cluster ?? "NA");
      return { ...f, properties: { ...f.properties, __rumb_id: id, __rumb_color: color } };
    });
    return { annotated, data, cuts, colors, cats, measure, clustered, clusterColor, uniform, na };
  }

  /** A compact legend entry for a shown layer that is not the focus. */
  function otherSection(l, drawn) {
    const kind = app.kindOf(l);
    if (drawn.clustered)
      return { name: l.name, kind, colors: ["HH", "LL", "HL", "LH"].map(drawn.clusterColor), note: "clusters" };
    if (drawn.cats) return { name: l.name, kind, colors: drawn.cats.items.map((x) => x.color), note: "by category" };
    if (drawn.measure) return { name: l.name, kind, colors: drawn.colors, note: app.label(drawn.measure, l) };
    return { name: l.name, kind, colors: [drawn.uniform] };
  }

  /** Colors every stacked layer, redraws the map and the legend, then the inspector. */
  function draw() {
    const { state } = app;
    if (state.view === "compare") return;
    let focus = null;
    others = [];
    for (const e of state.stack) {
      const l = app.layerById(e.id);
      if (!l || !app.atlas.has(e.id)) continue;
      const drawn = colorize(l, viewOf(l));
      app.atlas.setData(e.id, drawn.annotated);
      if (e.id === state.active) focus = drawn;
      else if (e.visible) others.unshift({ ...otherSection(l, drawn), credit: l.meta?.credit });
    }
    const l = app.layer();
    values.clear();
    for (const f of l.collection.features) values.set(featureId(f), f);
    const { data, cuts, colors, cats, clustered, clusterColor, uniform, na } = focus || colorize(l, state);

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
    } else if (cats) {
      items = cats.items.map((x) => ({ color: x.color, text: x.value }));
      renderLegend(legend, { kind: "categories", title: app.label(state.category), items, action });
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
    renderOthers(legend, others);
    app.renderInspector();
  }

  return {
    renderControls,
    draw,
    values,
    /** Legend entries as drawn, for the PNG export. */
    legendItems: () => items,
    /** The other shown layers' legend entries, top first: { name, kind, colors, note, credit }. */
    legendOthers: () => others,
  };
}
