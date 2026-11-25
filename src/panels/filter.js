// The spatial filter panel: keep the features of every layer on the map that
// lie within a radius of a point, within a distance of the selection (a
// buffer), or inside a drawn area; dim or hide the rest. Counts per layer and
// the focus layer's nearest features follow. The geometry is in geo/filter.js.
import { number, plural } from "../catalog/format.js";
import { featureId } from "../core/features.js";
import { formatPosition } from "../core/settings.js";
import { applyFilter, describeFilter, normalizeFilter, projectedIndex } from "../geo/filter.js";
import { mapGeometry } from "../geo/spatial.js";
import { callStats } from "../stats/client.js";
import { $, fill, h } from "../ui/dom.js";
import { getSettings } from "../ui/themes.js";

const KINDS = [
  ["radius", "Radius"],
  ["buffer", "Buffer"],
  ["polygon", "Area"],
];

export function createFilter(app) {
  const projection = app.tools.projection;
  // The settings being edited, before (and while) a filter is on the map.
  const draft = { kind: "radius", miles: 25, bufferMiles: 5, orSelection: false };
  const cache = new Map();
  let shapeToken = 0;

  const index = (l) => projectedIndex(l.collection, projection, featureId);
  const where = ([lon, lat]) => formatPosition(lat, lon, getSettings().coords);
  const current = () => normalizeFilter(app.state.filter);

  /** The focus layer's selected areas (projected polygons), for "or in the selected areas". */
  function selectedAreas() {
    const { state } = app,
      l = app.layer();
    if (!l || app.kindOf(l) === "point") return [];
    const ids = new Set([state.selected, ...(state.picks || [])].filter(Boolean).map(String));
    return index(l)
      .filter((f) => ids.has(f.id))
      .map((f) => f.geometry);
  }
  /** The buffered features, projected. */
  function base(filter) {
    const l = app.layerById(filter.layer);
    if (!l) return [];
    const ids = new Set(filter.ids);
    return index(l)
      .filter((f) => ids.has(f.id))
      .map((f) => f.geometry);
  }

  /** Map(id → miles) of a layer's kept features, or null with no filter. Cached per layer. */
  function keptFor(l) {
    const filter = current();
    // A tile layer has no shapes here to filter (core/scope.js): it stays as it is.
    if (!filter || l.meta?.tiled) return null;
    const sig = JSON.stringify([filter, filter.orSelection ? [app.state.selected, app.state.picks, app.state.active] : 0]);
    const hit = cache.get(l.id);
    if (hit && hit.sig === sig && hit.collection === l.collection) return hit.kept;
    const kept = applyFilter(filter, index(l), {
      projection,
      base: filter.kind === "buffer" ? base(filter) : [],
      selectedAreas: filter.kind === "radius" && filter.orSelection ? selectedAreas() : [],
    });
    cache.set(l.id, { sig, collection: l.collection, kept });
    return kept;
  }

  /** Puts a filter on the map (or takes it off with null) and redraws. */
  function set(filter) {
    app.store.set({ filter: normalizeFilter(filter) });
    drawShape();
    app.renderAll();
  }

  /** The filter's outline: a circle, the drawn area, or the buffer (from the worker). */
  function drawShape() {
    const filter = current(),
      token = ++shapeToken;
    if (!filter) return app.atlas.setFilterShape([]);
    if (filter.kind === "radius") {
      const [cx, cy] = projection.forward(filter.center),
        r = filter.miles * 1609.344;
      const ring = Array.from({ length: 97 }, (_, i) => {
        const t = (2 * Math.PI * (i % 96)) / 96;
        return projection.inverse([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
      });
      app.atlas.setFilterShape([
        { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } },
        { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: filter.center } },
      ]);
    } else if (filter.kind === "polygon")
      app.atlas.setFilterShape([
        { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...filter.ring, filter.ring[0]]] } },
      ]);
    else {
      app.atlas.setFilterShape([]);
      callStats({ type: "buffer", geometries: base(filter), metres: Math.max(filter.miles, 0.01) * 1609.344 })
        .then((outline) => {
          if (token !== shapeToken) return;
          app.atlas.setFilterShape([
            { type: "Feature", properties: {}, geometry: mapGeometry(outline, projection.inverse) },
          ]);
        })
        .catch(app.fail);
    }
  }

  // ---- actions -------------------------------------------------------------
  function pickCenter() {
    if (app.state.view !== "map") app.setView("map");
    app.tools.pick("Radius filter", "Click the map to set the center · Esc to cancel", (lonlat) =>
      set({ kind: "radius", center: lonlat, miles: draft.miles, orSelection: draft.orSelection }),
    );
  }
  function centerOn(lonlat) {
    set({ kind: "radius", center: lonlat, miles: draft.miles, orSelection: draft.orSelection });
  }
  async function centerOnMe() {
    const me = app.tools.located || (await app.tools.locate());
    if (me) centerOn(me.lonlat);
  }
  function centerOnSelection() {
    const f = app.values.get(String(app.state.selected));
    if (!f) throw new Error("Select a feature on the focus layer first.");
    const g = index(app.layer()).find((x) => x.id === String(app.state.selected));
    const [x0, y0, x1, y1] = g.box;
    centerOn(projection.inverse([(x0 + x1) / 2, (y0 + y1) / 2]));
  }
  function bufferSelection() {
    const { state } = app;
    const ids = [...new Set([state.selected, ...(state.picks || [])].filter(Boolean).map(String))];
    if (!ids.length) throw new Error("Select one or more features on the focus layer, then buffer them.");
    draft.kind = "buffer";
    set({ kind: "buffer", layer: state.active, ids, miles: draft.bufferMiles });
  }
  function drawArea() {
    if (app.state.view !== "map") app.setView("map");
    draft.kind = "polygon";
    render();
    app.tools.drawArea((ring) => (ring.length >= 3 ? set({ kind: "polygon", ring }) : app.notify("An area needs three points or more.")));
  }
  const clear = () => set(null);

  // ---- the panel ---------------------------------------------------------
  function slider(id, label, value, min, max, step, onInput) {
    const out = h("output", { for: id, text: value + " mi" });
    return h(
      "div",
      { class: "filter-slider" },
      h("label", { for: id, text: label }),
      h("input", {
        id,
        type: "range",
        min,
        max,
        step,
        value,
        oninput: (ev) => {
          out.textContent = ev.target.value + " mi";
          onInput(Number(ev.target.value));
        },
      }),
      out,
    );
  }
  function body() {
    const filter = current(),
      kind = draft.kind;
    if (kind === "radius")
      return [
        slider("filter-miles", "Distance", filter?.kind === "radius" ? filter.miles : draft.miles, 5, 100, 5, (miles) => {
          draft.miles = miles;
          if (current()?.kind === "radius") set({ ...current(), miles });
        }),
        h("p", {
          class: "subtle",
          id: "filter-center",
          text: filter?.kind === "radius" ? "Center " + where(filter.center) : "Choose a center:",
        }),
        h(
          "div",
          { class: "filter-actions" },
          h("button", { class: "small-btn", id: "filter-pick", text: "Click the map", onclick: pickCenter }),
          h("button", { class: "small-btn", text: "My location", onclick: () => app.perform(null, centerOnMe) }),
          h("button", {
            class: "small-btn",
            text: "Selected feature",
            disabled: !app.state.selected,
            onclick: () => app.perform(null, async () => centerOnSelection()),
          }),
        ),
        h(
          "label",
          { class: "checkbox" },
          h("input", {
            type: "checkbox",
            id: "filter-or",
            checked: filter?.kind === "radius" ? filter.orSelection : draft.orSelection,
            onchange: (ev) => {
              draft.orSelection = ev.target.checked;
              if (current()?.kind === "radius") set({ ...current(), orSelection: draft.orSelection });
            },
          }),
          "Also keep what lies in the selected areas",
        ),
      ];
    if (kind === "buffer")
      return [
        slider("filter-buffer", "Distance", filter?.kind === "buffer" ? filter.miles : draft.bufferMiles, 0.5, 50, 0.5, (miles) => {
          draft.bufferMiles = miles;
          if (current()?.kind === "buffer") set({ ...current(), miles });
        }),
        h("p", {
          class: "subtle",
          text:
            filter?.kind === "buffer"
              ? "Around " + plural(filter.ids.length, "selected feature") + " of " + (app.layerById(filter.layer)?.name || "a layer")
              : "Select features on the focus layer (Shift-click adds more), then buffer them.",
        }),
        h("div", { class: "filter-actions" }, h("button", { class: "small-btn", id: "filter-buffer-go", text: "Buffer the selection", onclick: () => app.perform(null, async () => bufferSelection()) })),
      ];
    return [
      h("p", {
        class: "subtle",
        text: filter?.kind === "polygon" ? "Inside an area of " + filter.ring.length + " points." : "Draw an area on the map: click its corners, then Enter.",
      }),
      h("div", { class: "filter-actions" }, h("button", { class: "small-btn", id: "filter-draw", text: filter?.kind === "polygon" ? "Draw again" : "Draw an area", onclick: drawArea })),
    ];
  }
  function render() {
    const filter = current();
    if (filter && filter.kind !== draft.kind && !app.tools.active) draft.kind = filter.kind;
    fill(
      $("filter-kind"),
      KINDS.map(([kind, label]) =>
        h("button", {
          "data-kind": kind,
          class: draft.kind === kind ? "active" : "",
          "aria-pressed": String(draft.kind === kind),
          text: label,
          onclick: () => {
            draft.kind = kind;
            render();
          },
        }),
      ),
    );
    fill($("filter-body"), body());
    $("filter-hide").checked = app.state.filterMode === "hide";
    $("filter-clear").disabled = !filter;
    renderSummary();
  }

  /** Kept counts for each shown layer, and the focus layer's nearest kept features. */
  function renderSummary() {
    const filter = current(),
      out = $("filter-summary");
    if (!filter) return fill(out);
    const rows = [],
      { state } = app;
    for (const e of [...state.stack].reverse()) {
      const l = app.layerById(e.id);
      if (!l || !e.visible || l.meta?.tiled) continue;
      const kept = keptFor(l);
      rows.push(
        h(
          "div",
          { "data-count": e.id },
          h("dt", { text: l.name }),
          h("dd", { text: number(kept.size, 0) + " of " + number(l.collection.features.length, 0) }),
        ),
      );
    }
    const l = app.layer(),
      kept = keptFor(l),
      fields = app.searchFields(l);
    const nearest = [...(kept || [])]
      .sort((a, b) => a[1] - b[1])
      .slice(0, 8)
      .map(([id, miles]) => {
        const f = app.values.get(id);
        const name = f?.properties?.[fields.labelField] ?? f?.properties?.name ?? id;
        return h(
          "button",
          {
            class: "nearest",
            "data-near": id,
            onclick: () => {
              app.selectFeature(id);
              if (f) app.atlas.fit({ features: [f] });
            },
          },
          h("span", { text: String(name) }),
          filter.kind !== "polygon" && h("small", { text: miles < 0.05 ? "inside" : number(miles, 1) + " mi" }),
        );
      });
    fill(
      out,
      h("p", { class: "filter-what", text: describeFilter(filter, where) }),
      h("dl", { class: "metrics" }, rows),
      kept?.size > 0 &&
        h("button", {
          class: "small-btn",
          id: "filter-select",
          text: "Select these " + number(kept.size, 0) + " in " + l.name,
          onclick: () => app.selectMany([...kept].sort((a, b) => a[1] - b[1]).map(([id]) => id)),
        }),
      nearest.length && h("p", { class: "stack-note", text: filter.kind === "polygon" ? "In the area: " + l.name : "Nearest: " + l.name }),
      nearest,
    );
  }

  return { keptFor, set, clear, render, renderSummary, drawShape, pickCenter, bufferSelection, drawArea, current };
}
