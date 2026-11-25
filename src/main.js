// rumb: wires the catalog, workspace, map and panels together. The pieces live
// in core/ (state, data, commands, keys), map/, panels/ (each part of the
// screen) and ui/ (DOM helpers, palette, themes, status bar).
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/map.css";
import "./styles/panels.css";
import "./styles/themes.css";
import "./styles/print.css";
import { fieldInfo, fieldLabel, loadCatalog } from "./catalog/catalog.js";
import { number } from "./catalog/format.js";
import { featureTitle, popupRows } from "./catalog/popup.js";
import { bindCommands, COMMANDS } from "./core/commands.js";
import { featureId } from "./core/features.js";
import { drawnIds, moveLayer, setVisible, stackEntry, withLayer, withoutLayer } from "./core/stack.js";
import { isTyping, SHORTCUTS, shortcutFor } from "./core/keys.js";
import { THEMES } from "./core/settings.js";
import { defaults, LAYER_VIEW_KEYS, layerViewDefaults, stateFields } from "./core/state.js";
import { callStats } from "./stats/client.js";
import { poolOf } from "./stats/pool.js";
import { RATE_METHODS, rateFields } from "./stats/rates.js";
import { accessFields, densityId, densitySpec, derivedSpec, modelFields } from "./core/derived.js";
import { mapGeometry } from "./geo/spatial.js";
import { accessMeasures } from "./stats/access.js";
import { createStore } from "./core/store.js";
import { cameraFromSearch, chooseRegion, listed, projectRegion, regionHref, unknownRegion } from "./core/regions.js";
import { commandAllowed, layerScope } from "./core/scope.js";
import { load as loadPref, save as savePref } from "./core/storage.js";
import { createWorkspace } from "./core/workspace.js";
import { createOffline } from "./data/offline.js";
import { exportMapImage } from "./map/export-png.js";
import { parseBreaks } from "./map/classify.js";
import { entryStyle, kindOf } from "./map/layer-specs.js";
import { initMap } from "./map/map.js";
import { createAnalysis } from "./panels/analysis.js";
import { basisOf, methodOf } from "./stats/methods.js";
import { createCompare } from "./panels/compare.js";
import { createFiles } from "./panels/files.js";
import { findFeatures, openFind } from "./panels/find.js";
import { openRegions } from "./panels/regions.js";
import { renderScope } from "./panels/scope.js";
import { createInspector } from "./panels/inspector.js";
import { describeLayer, openLibrary, renderLayers } from "./panels/layers.js";
import { createStyle } from "./panels/style.js";
import { createTools } from "./panels/tools.js";
import { createFilter } from "./panels/filter.js";

import { parseCoordinate } from "./geo/coords.js";
import { countPoints } from "./geo/counts.js";
import { projectedIndex } from "./geo/filter.js";
import { formatPosition } from "./core/settings.js";
import { createWorkbench } from "./panels/workbench.js";
import { $, addIcons, h, on, report, toast } from "./ui/dom.js";
import { setupDrop } from "./ui/drop.js";
import { openHelp } from "./ui/help.js";
import { createPalette, rankItems } from "./ui/palette.js";
import { createStatusbar } from "./ui/statusbar.js";
import { applySettings, cycleTheme, getSettings, onSettings, openAppearance, update } from "./ui/themes.js";

const VERSION = __RUMB_VERSION__;
const STATE_LABEL = { ready: "READY", loading: "LOAD", running: "RUN", error: "ERR" };
const timings = {};
let locked = false,
  ready = false,
  tableIndex = null;

function status(message, kind = "ready") {
  $("foot-status").textContent = message;
  $("sb-state").textContent = STATE_LABEL[kind] || "READY";
  document.documentElement.dataset.status = kind;
}

async function fetchJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error("Unable to read " + path + " (" + res.status + ").");
  return res.json();
}

async function start() {
  applySettings();
  addIcons();
  status("Opening map…", "loading");
  const catalog = await loadCatalog(fetchJSON, (index) =>
    chooseRegion(index, { search: location.search, stored: loadPref("region") }),
  );
  savePref("region", catalog.region.id);
  $("brand-region").textContent = catalog.region.id.toUpperCase();
  $("brand-region").setAttribute("aria-label", catalog.region.name + ": change state");
  const ws = createWorkspace(catalog, {
    status: (m) => status(m, "loading"),
    onDatabase: (s) => app.statusbar?.database(s),
    // Tile layers need the PMTiles reader, a lazy chunk.
    onTiles: () => import("./map/tiles.js").then((m) => m.registerTiles(app.atlas.addProtocol)),
  });
  const store = createStore(defaults(catalog));

  const app = {
    version: VERSION,
    store,
    ws,
    catalog,
    ref: ws.ref,
    timings,
    get state() {
      return store.state;
    },
    notify: (message, options = {}) => toast(message, options === true ? { error: true } : options),
    /** Whether the data index lists a region. */
    hasRegion: (id) => listed(catalog.index, id),
    /** Reloads the app in another region, with an optional #fragment and query additions. */
    openRegion(id, { hash = "", extra } = {}) {
      location.assign(regionHref(location.href, id, { index: catalog.index, hash, extra }));
    },
    projectRegion,
    fail: report,
    status,
    /** A field's label on the focus layer (or another layer). */
    label: (field, l = app.layer()) =>
      l?.extraFields?.[field]?.label ||
      (l?.referenceFields && ws.tableField(field)?.label) ||
      fieldLabel(catalog, field, l?.meta),
    /** Catalog metadata for a field of a layer: library fields, or the reference's own. */
    fieldMeta(l, field) {
      if (l?.extraFields?.[field]) return l.extraFields[field];
      if (l?.meta) return l.meta.fields?.[field];
      return l?.referenceFields ? fieldInfo(catalog, field) || ws.tableField(field) : undefined;
    },
    /**
     * A layer's fields in the measure picker's groups: its own (and point
     * counts) under "Measure", then one group per attribute table.
     */
    fieldGroups(l) {
      const own = [...(l.id === ws.ref.id ? ws.ref.measures : ws.fieldList(l)), ...(l?.countFields || [])];
      const groups = [{ label: "Measure", fields: own }];
      if (l.id === ws.ref.id)
        for (const t of app.tableList()) groups.push({ label: t.group || t.name, fields: t.measures });
      groups.push({ label: "Derived", fields: l?.derivedFields || [] });
      return groups.filter((g) => g.fields.length);
    },
    /** The reference layer's attribute tables, once their index is read. */
    tableList: () => tableIndex?.tables || [],
    /** Loads the tables any field in the state comes from (after a restore or a shared link). */
    async ensureTables(state = store.state) {
      if (!ws.ref.tables) return;
      tableIndex = await ws.tables().catch(() => null);
      await ws.ensureFields(stateFields(state));
    },
    /** Fields that name, group and identify a layer's features (search, inspector, study areas). */
    searchFields(l) {
      if (l?.meta) return { labelField: l.meta.labelField, groupField: l.meta.placeField, idField: null };
      return { labelField: ws.ref.labelField, groupField: ws.ref.groupField, idField: ws.ref.idField };
    },
    fieldList: (l) => [...ws.fieldList(l), ...(l?.countFields || []), ...(l?.derivedFields || [])],
    allLayers: () => [ws.referenceView(), ...store.state.layers],
    /**
     * A layer by id: the reference layer, a query layer or a loaded library
     * layer, with point counts added when its stack entry asks for them.
     */
    layerById(id) {
      const counted = countedLayer(id),
        derived = store.state.stack.find((e) => e.id === id)?.derived;
      return counted && derived?.length ? withDerived(counted, derived) : counted;
    },
    /**
     * Builds a density surface (a generated layer of square cells inside the
     * region's outline) from a spec; quartic kernel in the worker.
     */
    async generateDensity(raw) {
      const spec = densitySpec(raw);
      if (!spec) throw new Error("That is not a density surface.");
      const source = app.layerById(spec.source) || (await ws.loadLayer(spec.source).then(() => baseLayer(spec.source)));
      if (!source || app.kindOf(source) !== "point") throw new Error("A density surface needs a point layer.");
      const projection = app.tools.projection;
      const outline = await ws.outline();
      const polygons = outline.features
        .map((f) => mapGeometry(f.geometry, projection.forward))
        .flatMap((g) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates));
      const points = source.collection.features.filter((f) => f.geometry?.type === "Point");
      const grid = await callStats({
        type: "density",
        xy: points.map((f) => projection.forward(f.geometry.coordinates)),
        weights: spec.weight ? points.map((f) => Math.max(0, Number(f.properties?.[spec.weight]) || 0)) : null,
        polygons,
        bandwidth: spec.bandwidth ? spec.bandwidth * 1609.344 : null,
        cell: spec.cell ? spec.cell * 1609.344 : null,
      });
      const half = grid.cell / 2;
      const features = grid.cells.map(([x, y, v], i) => ({
        type: "Feature",
        id: "c" + i,
        properties: { cell: "c" + i, density: v },
        geometry: {
          type: "Polygon",
          coordinates: [
            [[x - half, y - half], [x + half, y - half], [x + half, y + half], [x - half, y + half], [x - half, y - half]].map(projection.inverse),
          ],
        },
      }));
      const by = spec.weight ? " (" + app.label(spec.weight, source).toLowerCase() + ")" : "";
      return {
        id: densityId(spec),
        name: "Density of " + source.name.toLowerCase(),
        collection: { type: "FeatureCollection", features },
        generated: spec,
        preferredMeasure: "density",
        extraFields: {
          density: {
            label: source.name + by + " per sq mi (quartic kernel, " + (grid.bandwidth / 1609.344).toFixed(1) + " mi)",
            format: "number",
          },
        },
      };
    },
    /** Puts a generated layer on the map (replacing one with its id) and focuses it. */
    showGenerated(layer) {
      store.set({ layers: [...store.state.layers.filter((l) => l.id !== layer.id), layer] });
      focusLayer(layer.id, { fit: true });
      // A surface reads as one field of color: no cell outlines.
      app.setLook({ style: { outline: 0 } });
    },
    /**
     * Computes the derived rate fields the stack asks for that are not ready
     * yet (they may need a table or the neighbor graph), then redraws.
     */
    async ensureDerived() {
      let changed = false;
      for (const e of store.state.stack)
        for (const raw of e.derived || []) {
          const spec = derivedSpec(raw);
          if (!spec) continue;
          if (spec.kind === "model" || spec.kind === "access") {
            const key = e.id + JSON.stringify(spec);
            if (failedDerived.has(key)) continue;
            try {
              changed = (await (spec.kind === "model" ? deriveModel : deriveAccess)(e.id, spec)) || changed;
            } catch (error) {
              failedDerived.add(key);
              throw error;
            }
            continue;
          }
          await ws.ensureFields([spec.measure]);
          const view = countedLayer(e.id);
          if (!view || derivedOf(view, spec)) continue;
          const info = app.fieldMeta(view, spec.measure),
            pool = poolOf(info);
          if (!pool?.denominator) continue;
          await ws.ensureFields([pool.numerator, pool.denominator]);
          const fresh = countedLayer(e.id);
          const spatial = spec.methods.some((m) => RATE_METHODS[m].spatial) && app.kindOf(fresh) !== "point";
          const rows = spatial ? await contiguityRows(fresh) : null;
          derivedStore(fresh.collection).set(JSON.stringify(spec), rateFields(fresh.collection.features, spec, {
            info,
            pool,
            label: app.label(spec.measure, fresh),
            rows,
          }));
          changed = true;
        }
      if (changed && ready) renderAll();
    },
    /** The focus layer: the one the style panel, inspector and analysis act on. */
    layer: () => app.layerById(store.state.active),
    /** A layer's geometry kind: "polygon", "point", "line" or "mixed". */
    kindOf: (l) => l.meta?.geometry || (l.id === ws.ref.id ? "polygon" : kindOf(l.collection.features)),
    /** Changes the focus layer's stack entry (its look or label) and redraws. */
    setLook(patch) {
      const { stack, active } = store.state;
      store.set({
        stack: stack.map((e) =>
          e.id === active
            ? { ...e, ...("label" in patch ? { label: patch.label } : {}), style: { ...e.style, ...patch.style } }
            : e,
        ),
      });
      renderAll();
    },
    /** Makes the map's layers match state.stack (sources, order, visibility). */
    syncMap() {
      const { stack } = store.state;
      for (const id of app.mapped) if (!stack.some((e) => e.id === id)) app.atlas.removeLayer(id);
      app.mapped = new Set();
      for (const e of stack) {
        const l = app.layerById(e.id);
        if (!l) continue;
        const kind = app.kindOf(l),
          style = { ...entryStyle(e, kind), faded: !!store.state.filter && store.state.filterMode !== "hide" };
        if (!app.atlas.has(e.id)) app.atlas.addLayer(e.id, kind, style, tileSource(l));
        else if (JSON.stringify(app.atlas.styleOf(e.id)) !== JSON.stringify(style)) app.atlas.setStyle(e.id, style);
        app.atlas.setVisible(e.id, e.visible);
        app.mapped.add(e.id);
      }
      app.atlas.syncStack(drawnIds(stack));
      app.atlas.setRoads(store.state.roads);
    },
    mapped: new Set(),
    /** Reads the library layers a stack needs (after a restore); drops any that are gone. */
    async loadStack() {
      const missing = [];
      for (const e of store.state.stack)
        if (!app.layerById(e.id))
          await ws.loadLayer(e.id).catch(() => missing.push(e.id));
      if (missing.length) {
        let { stack, active } = store.state;
        for (const id of missing) stack = withoutLayer(stack, id);
        if (missing.includes(active)) active = stack[0]?.id || ws.ref.id;
        store.set({ stack: stack.length ? stack : [stackEntry(ws.ref.id)], active });
        app.notify("Some layers in this project are not available: " + missing.join(", ") + ".");
      }
    },
    /** Reads a library layer, puts it on top of the map and makes it the focus. */
    async addLibraryLayer(id) {
      const { meta } = await ws.loadLayer(id);
      focusLayer(id);
      app.notify("Added " + meta.name + " to the map.");
    },
    /** Takes a layer off the map. The focus moves to the layer below, or above. */
    removeFromStack(id) {
      const { stack, active } = store.state;
      if (stack.length < 2) return app.notify("The map needs at least one layer.");
      const i = stack.findIndex((e) => e.id === id);
      const next = withoutLayer(stack, id);
      if (id === active) {
        store.set({ stack: next });
        focusLayer(next[Math.max(0, i - 1)].id);
      } else {
        store.set({ stack: next });
        renderAll();
      }
    },
    moveInStack(id, delta) {
      store.set({ stack: moveLayer(store.state.stack, id, delta) });
      renderAll();
    },
    toggleLayer(id) {
      const e = store.state.stack.find((x) => x.id === id);
      if (!e || id === store.state.active) return;
      store.set({ stack: setVisible(store.state.stack, id, !e.visible) });
      renderAll();
    },
    records: () => app.layer().collection.features,
    idleStatus() {
      if (store.state.view === "compare") status($("cmp-count").textContent);
      else status(number(app.records().length, 0) + " features · " + app.layer().name);
    },
    /** Runs one file or query operation at a time, reporting its error. */
    async perform(button, operation) {
      if (locked) {
        app.notify("Another file or query operation is still running.");
        return;
      }
      locked = true;
      if (button) button.disabled = true;
      try {
        await operation();
      } catch (error) {
        status(error.message || String(error), "error");
        report(error);
        return;
      } finally {
        locked = false;
        if (button) button.disabled = false;
      }
      if (ready && !app.analysis.running) app.idleStatus();
    },
    setTitles({ title, subtitle, credit, context }) {
      if (title != null) $("map-title").textContent = title;
      if (subtitle != null) $("map-subtitle").textContent = subtitle;
      if (credit != null) $("map-credit").textContent = credit;
      if (context != null) $("foot-context").textContent = context;
    },
    renderAll,
    draw: () => app.style.draw(),
    renderInspector: () => app.inspector.render(),
    setView,
    focusLayer,
    showLayer: (id) => focusLayer(id, { fit: true }),
    selectFeature(id) {
      if (!app.values.has(String(id))) return;
      store.set({ selected: String(id), picks: [], inspector: true });
      app.renderInspector();
      app.filter?.render();
    },
    /** Adds a feature to the selection, or takes it out (Shift-click). */
    togglePick(id) {
      id = String(id);
      if (!app.values.has(id)) return;
      const { selected, picks } = store.state;
      const all = [...new Set([selected, ...picks].filter(Boolean))];
      const next = all.includes(id) ? all.filter((x) => x !== id) : [...all, id];
      store.set({ selected: next.at(-1) || null, picks: next, inspector: true });
      app.renderAll();
    },
    /** Selects many features of the focus layer at once (those a filter keeps, say). */
    selectMany(ids) {
      const list = [...ids].map(String).filter((id) => app.values.has(id)).slice(0, 2000);
      store.set({ selected: list[0] || null, picks: list, inspector: true });
      app.renderAll();
    },
    /** Maps a field, first reading the table it comes from when needed. */
    async setMeasure(field) {
      if (ws.missingFields([field]).length) {
        status("Reading " + (ws.tableOf(field)?.name || app.layer()?.name || "values") + "…", "loading");
        await ws.ensureFields([field]).catch(report);
      }
      app.analysis.clearResults();
      store.set({ measure: field });
      renderAll();
    },
    /** Adds a mapped query result and shows it. */
    addLayer(layer, sql) {
      store.set({ layers: [...store.state.layers, layer], sql });
      focusLayer(layer.id, { fit: true });
      app.notify("Added " + layer.name + " to the map.");
    },
  };

  function renderAll() {
    const l = app.layer(),
      fields = app.fieldList(l);
    // A table field picked before its table was read (a layer's saved view, say).
    if (ws.missingFields([store.state.measure]).length)
      ws.ensureFields([store.state.measure]).then(renderAll, report);
    // Derived rates the stack names that are not computed yet.
    if (store.state.stack.some((e) => (e.derived || []).some((d) => derivedSpec(d) && !derivedOf(countedLayer(e.id) || {}, derivedSpec(d)))))
      app.ensureDerived().catch(report);
    renderLayers(app);
    app.style.renderControls(fields);
    app.filter.render();
    app.analysis.renderControls(fields);
    renderScope(app);
    const ref = ws.ref;
    app.syncMap();
    app.setTitles(
      l.id === ref.id
        ? { title: ref.title, subtitle: ref.subtitle, credit: ref.credit, context: ref.context || ref.subtitle }
        : l.meta
          ? {
              title: l.name,
              subtitle: describeLayer(l, ref) + " · " + l.meta.group,
              credit: l.meta.credit,
              context: l.meta.credit,
            }
          : {
            title: l.name,
            subtitle:
              number(l.collection.features.length) +
              (l.generated ? " cells · kernel density surface" : " features · " + (l.reference ? ref.name : "Local query layer")),
            credit: l.name,
            context: l.name,
          },
    );
    app.idleStatus();
    app.draw();
  }

  function setView(view, restoring = false) {
    if (!ready) return;
    // Compare needs the whole layer in memory; a tile layer is for viewing.
    if (view === "compare" && !commandAllowed("view-compare", app.layer())) return app.notify(layerScope(app.layer()).reason);
    const { state } = app,
      previous = state.view,
      comparing = view === "compare",
      mapped = comparing || view === "map";
    if (comparing && previous === "map") app.mapCamera = app.atlas.camera();
    app.compare.leave();
    store.set({ view });
    $("map-view").hidden = !mapped;
    $("work-view").hidden = mapped;
    $("map-view").classList.toggle("comparing", comparing);
    $("cmp-split").hidden = $("cmp-panel").hidden = !comparing;
    $("settings").hidden = comparing;
    for (const b of document.querySelectorAll("#nav button")) {
      b.classList.toggle("active", b.dataset.view === view);
      b.setAttribute("aria-current", b.dataset.view === view ? "page" : "false");
    }
    $("settings").classList.remove("open");
    if (!comparing) app.atlas.setCompare(null);
    app.bench.render(mapped ? "map" : view);
    if (mapped) app.atlas.map.resize();
    if (comparing) {
      const id = state.compareLayer || state.active;
      app.compare.open(id, !restoring && id !== state.active);
    } else if (view === "map") {
      renderAll();
      if (app.mapCamera && !restoring) app.atlas.map.jumpTo(app.mapCamera);
      app.mapCamera = null;
    }
  }

  /**
   * Makes a layer the focus (adding it on top of the stack if needed),
   * remembering each layer's own view settings.
   */
  function focusLayer(id, { fit = false } = {}) {
    app.analysis.cancel();
    const { state } = app;
    const layerViews = { ...state.layerViews };
    if (id !== state.active)
      layerViews[state.active] = Object.fromEntries(LAYER_VIEW_KEYS.map((key) => [key, state[key]]));
    const l = app.layerById(id);
    const saved =
      id === state.active
        ? {}
        : layerViews[id] || layerViewDefaults(catalog, l.preferredMeasure || app.fieldList(l)[0] || "");
    delete layerViews[id];
    store.set({ active: id, compareLayer: id, stack: withLayer(state.stack, id), ...saved, layerViews });
    setView("map");
    if (fit) app.atlas.fit(l.collection);
  }
  const libraryViews = new Map();
  /** A layer with its point counts, without derived rates. */
  function countedLayer(id) {
    const base = baseLayer(id),
      counts = store.state.stack.find((e) => e.id === id)?.counts;
    return base && counts?.length ? withCounts(base, counts) : base;
  }
  // Derived rate fields (stats/rates.js) by collection and spec; computed by
  // ensureDerived, read here synchronously.
  const derivedValues = new WeakMap(),
    derivedViews = new Map(),
    failedDerived = new Set();
  const derivedStore = (collection) => {
    if (!derivedValues.has(collection)) derivedValues.set(collection, new Map());
    return derivedValues.get(collection);
  };
  const derivedOf = (view, spec) => derivedValues.get(view.collection)?.get(JSON.stringify(spec));
  /** A layer with the derived fields its stack entry asks for, once computed. */
  function withDerived(view, specs) {
    const parts = specs.map(derivedSpec).filter(Boolean).map((s) => derivedOf(view, s)).filter(Boolean);
    if (!parts.length) return view;
    const key = JSON.stringify(specs),
      hit = derivedViews.get(view.id);
    if (hit && hit.base === view.collection && hit.key === key && hit.parts.every((p, i) => p === parts[i])) return hit.view;
    const fields = parts.flatMap((p) => p.fields);
    const collection = {
      type: "FeatureCollection",
      features: view.collection.features.map((f, i) => ({
        ...f,
        properties: { ...f.properties, ...Object.fromEntries(parts.flatMap((p) => p.fields.map((n) => [n, p.values[n][i]]))) },
      })),
    };
    const extraFields = Object.assign({}, view.extraFields, ...parts.map((p) => p.extraFields));
    const derived = { ...view, collection, extraFields, derivedFields: fields };
    derivedViews.set(view.id, { base: view.collection, key, parts, view: derived });
    return derived;
  }
  /** Fits a model spec in the worker and keeps its predictions and residuals as fields. */
  async function deriveModel(id, spec) {
    const view = countedLayer(id);
    if (!view || derivedOf(view, spec)) return false;
    const request = await app.analysis.modelRequest(view, spec);
    const fresh = countedLayer(id);
    const result = await callStats(request);
    const [fit, res, sres] = modelFields(spec);
    const info = app.fieldMeta(fresh, spec.y) || {},
      label = app.label(spec.y, fresh);
    const values = (key) => fresh.collection.features.map((f) => result.byId[featureId(f)]?.[key] ?? null);
    derivedStore(fresh.collection).set(JSON.stringify(spec), {
      fields: [fit, res, sres],
      extraFields: {
        [fit]: { label: label + ": predicted by the regression", format: info.format, unit: info.unit, smoothed: true },
        [res]: { label: label + ": regression residual", format: "number", smoothed: true },
        [sres]: { label: label + ": standardized residual", format: "number", smoothed: true },
      },
      values: { [fit]: values("fitted"), [res]: values("residual"), [sres]: values("standardized") },
    });
    return true;
  }
  /** Measures access from each area's center to a point layer's facilities, as fields. */
  async function deriveAccess(id, spec) {
    const view = countedLayer(id);
    if (!view || derivedOf(view, spec)) return false;
    await ws.ensureFields([spec.population]);
    const facilities = app.layerById(spec.layer) || (await ws.loadLayer(spec.layer).then(() => baseLayer(spec.layer)));
    if (!facilities) throw new Error("The facility layer " + spec.layer + " is not available.");
    const fresh = countedLayer(id);
    const { points } = await app.analysis.locations(fresh, fresh.collection.features);
    const projection = app.tools.projection;
    const supply = facilities.collection.features.filter((f) => f.geometry?.type === "Point");
    const ids = fresh.collection.features.map(featureId);
    const out = accessMeasures(
      { xy: ids.map((i) => points[i] || null), population: fresh.collection.features.map((f) => f.properties?.[spec.population]) },
      {
        xy: supply.map((f) => projection.forward(f.geometry.coordinates)),
        size: supply.map((f) => (spec.size ? Number(f.properties?.[spec.size]) || 0 : 1)),
      },
      { within: spec.within, catchment: spec.catchment, kind: spec.decay },
    );
    const [near, within, ratio] = accessFields(spec);
    const name = facilities.name || spec.layer,
      unit = spec.size ? app.label(spec.size, facilities).toLowerCase() : name.toLowerCase();
    derivedStore(fresh.collection).set(JSON.stringify(spec), {
      fields: [near, within, ratio],
      extraFields: {
        [near]: { label: "Miles to the nearest of " + name, format: "number", unit: " mi", smoothed: true },
        [within]: { label: name + " within " + spec.within + " miles", format: "integer", smoothed: true },
        [ratio]: {
          label: name + " access (E2SFCA, " + unit + " per 10,000 people)",
          format: "number",
          smoothed: true,
        },
      },
      values: { [near]: out.nearest, [within]: out.count, [ratio]: out.ratio },
    });
    return true;
  }
  /** Queen contiguity as neighbor indices by feature, for spatial smoothing. */
  async function contiguityRows(view) {
    const graph = view.reference
      ? (await ws.neighbors()).queen
      : view.library && view.meta?.neighbors
        ? (await ws.loadLayerNeighbors(view.id)).queen
        : ws.graphs.get(view.id + "-queen") ||
          (await callStats({ type: "weights", features: view.collection.features, rule: "queen" }).then((g) => {
            ws.graphs.set(view.id + "-queen", g);
            return g;
          }));
    const index = new Map(view.collection.features.map((f, i) => [featureId(f), i]));
    return view.collection.features.map((f) =>
      (graph[featureId(f)] || []).filter((id) => index.has(id)).map((id) => index.get(id)),
    );
  }
  /** Where a tile layer's tiles are, for the map; null for other layers. */
  function tileSource(l) {
    const meta = l?.meta;
    if (!meta?.tiled) return null;
    return {
      url: "pmtiles://" + new URL(catalog.path + meta.tiles, location.href).href,
      sourceLayer: meta.sourceLayer,
      idField: meta.idField,
      minzoom: meta.minzoom,
      maxzoom: meta.maxzoom,
    };
  }
  /** A layer without point counts. */
  function baseLayer(id) {
    if (id === ws.ref.id) return ws.referenceView();
    const query = store.state.layers.find((l) => l.id === id);
    if (query) return query;
    const meta = ws.meta(id),
      collection = ws.layerCollection(id);
    if (!meta || !collection) return undefined;
    if (libraryViews.get(id)?.collection !== collection)
      libraryViews.set(id, { id, name: meta.name, collection, library: true, meta });
    return libraryViews.get(id);
  }
  /**
   * A polygon layer with fields counting the points of other layers inside
   * each area (count_<layer>), and rates per 10,000 people when the layer has
   * a population field (rate_<layer>). Cached until the inputs change.
   */
  const countViews = new Map();
  function withCounts(view, pointIds) {
    const points = pointIds.map(baseLayer).filter((p) => p && app.kindOf(p) === "point");
    if (!points.length || app.kindOf(view) === "point") return view;
    const hit = countViews.get(view.id);
    if (hit && hit.base === view.collection && hit.points.length === points.length && hit.points.every((p, i) => p === points[i].collection))
      return hit.view;
    const index = (c) => projectedIndex(c, app.tools.projection, featureId);
    const population = view.meta?.populationField;
    const extraFields = {},
      countFields = [],
      perArea = view.collection.features.map(() => ({}));
    const ids = view.collection.features.map(featureId);
    for (const p of points) {
      const counts = countPoints(index(view.collection), index(p.collection));
      const field = "count_" + p.id;
      extraFields[field] = { label: p.name + " (count)", format: "integer", pool: { kind: "count", numerator: field } };
      countFields.push(field);
      ids.forEach((id, i) => (perArea[i][field] = counts.get(id) ?? 0));
      if (population) {
        const rate = "rate_" + p.id;
        extraFields[rate] = {
          label: p.name + " per 10,000 people",
          format: "rate",
          pool: { kind: "ratio", numerator: field, denominator: population, scale: 10000 },
        };
        countFields.push(rate);
        view.collection.features.forEach((f, i) => {
          const pop = f.properties?.[population];
          perArea[i][rate] = pop > 0 ? (perArea[i][field] / pop) * 10000 : null;
        });
      }
    }
    if (points.length > 1) {
      extraFields.count_points = { label: "All counted points", format: "integer", pool: { kind: "count", numerator: "count_points" } };
      countFields.push("count_points");
      perArea.forEach((x) => (x.count_points = points.reduce((n, p) => n + x["count_" + p.id], 0)));
    }
    const collection = {
      type: "FeatureCollection",
      features: view.collection.features.map((f, i) => ({ ...f, properties: { ...f.properties, ...perArea[i] } })),
    };
    const counted = { ...view, collection, extraFields, countFields, countedFrom: points.map((p) => p.name) };
    countViews.set(view.id, { base: view.collection, points: points.map((p) => p.collection), view: counted });
    return counted;
  }

  /** A popup for a feature of a layer that is not the focus, with a way to focus it. */
  function showPopup(layerId, id, lngLat) {
    const l = app.layerById(layerId);
    const f = l?.collection.features.find((x) => featureId(x) === id);
    if (!f) return;
    const fields = app.searchFields(l),
      props = f.properties || {};
    const meta = l.meta || (l.id === ws.ref.id || l.referenceFields ? ws.ref : null);
    const rows = popupRows(meta, props, { skip: [fields.labelField] });
    app.atlas.popup(
      lngLat,
      h(
        "div",
        { class: "map-popup", "data-popup": layerId },
        h("h3", { text: featureTitle(props, id, fields.labelField) }),
        h("p", { class: "subtle", text: [l.name, l.meta?.vintage].filter(Boolean).join(" · ") }),
        rows.length &&
          h(
            "dl",
            null,
            rows.map((r) => [
              h("dt", { text: r.label }),
              h("dd", null, r.href ? h("a", { href: r.href, target: "_blank", rel: "noopener", text: r.text }) : r.text),
            ]),
          ),
        h("button", {
          class: "plain-btn",
          text: "Focus this layer",
          onclick: () => {
            app.atlas.closePopup();
            focusLayer(layerId);
            app.selectFeature(id);
          },
        }),
      ),
    );
  }

  app.atlas = initMap({
    region: catalog.region,
    regionPath: catalog.path,
    onSelect: ({ layer, id, lngLat, additive }) => {
      if (layer === "cmp") return app.compare.toggle(id);
      // The topmost feature wins: the focus layer's opens the inspector; any other a popup.
      app.atlas.closePopup();
      if (layer !== store.state.active) showPopup(layer, id, lngLat);
      else if (additive) app.togglePick(id);
      else app.selectFeature(id);
    },
    onPointer: (lngLat) => app.statusbar?.position(lngLat),
  });
  await Promise.all([app.atlas.ready, ws.loadDisplay()]);
  app.style = createStyle(app);
  app.values = app.style.values;
  app.inspector = createInspector(app);
  app.analysis = createAnalysis(app);
  app.bench = createWorkbench(app);
  app.compare = createCompare(app);
  app.files = createFiles(app);
  app.statusbar = createStatusbar(app);
  app.tools = createTools(app);
  app.filter = createFilter(app);
  // Sharing loads when used, or when the address holds a shared map.
  const share = () => import("./panels/share.js").then((m) => (app.share ??= m.createShare(app)));
  if (/^#state=/.test(location.hash)) share();
  window.addEventListener("hashchange", () => /^#state=/.test(location.hash) && share().then((s) => s.fromAddress()));
  app.loadShare = share;
  const offline = createOffline({
    region: catalog.region.id,
    status,
    notify: app.notify,
    onState: (state) =>
      app.statusbar.network({ partial: "cached", ready: "offline ready" }[state] || "online", state === "ready"),
  });
  if (offline.supported) app.offline = offline;
  offline.register(__RUMB_DEV__);
  onSettings(() => {
    app.atlas.retheme();
    if (store.state.view === "compare") app.setView("compare", true);
    else if (store.state.view === "map") app.draw();
  });
  ready = true;
  store.subscribe((state, keys) => {
    if (keys.has("graticule")) app.atlas.graticule(state.graticule);
  });
  renderAll();
  app.atlas.map.once("idle", () => {
    if (app.atlas.drawn(ws.ref.id)) {
      performance.mark("rumb-first-map");
      timings.firstMap = Math.round(performance.now());
    }
    // The table index (field names and labels, not values) follows the first map.
    if (ws.ref.tables)
      ws.tables().then((index) => {
        tableIndex = index;
        if (store.state.view === "map" && app.layer().id === ws.ref.id) app.style.renderControls(app.fieldList(app.layer()));
      }, () => {});
  });
  wire(app);
  const missing = unknownRegion(catalog.index, location.search);
  if (missing) app.notify("No data for the region “" + missing + "” here; opened " + catalog.region.name + ".");
  // A link with #state= opens its shared map once the first map is up, and a
  // project opened in another region waits in the pending cache for this one.
  if (/^#state=/.test(location.hash)) app.loadShare().then((s) => s.fromAddress());
  if (new URLSearchParams(location.search).has("restore")) app.files.restorePending().catch(report);
  // ?at=lon,lat,zoom (the national tract map's "Open <state>") keeps the place
  // on the map; it is dropped from the address once used.
  const at = cameraFromSearch(location.search);
  if (at) {
    app.atlas.map.jumpTo(at);
    const url = new URL(location.href);
    url.searchParams.delete("at");
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  }

  // For debugging in the console, the e2e checks and scripts/benchmark-browser.mjs.
  window.rumb = {
    version: VERSION,
    timings,
    app,
    map: app.atlas.map,
    runCommand: app.runCommand,
    /** Appearance settings: rumb.appearance({ theme: "hud" }). */
    appearance: update,
    get state() {
      return store.state;
    },
    /** A separate DuckDB with the reference layer registered (for benchmarks). */
    openDatabase: async (options) => {
      const { openDatabase } = await import("./data/database.js");
      return openDatabase(options || { reference: await ws.reference() });
    },
  };
}

/** Counts the map's shown point layers in each area of the focus layer, or stops counting. */
function toggleCounts(app) {
  const { state } = app,
    entry = state.stack.find((e) => e.id === state.active);
  if (app.kindOf(app.layer()) === "point") throw new Error("Make a polygon layer the focus to count points in its areas.");
  if (entry?.counts?.length) {
    app.store.set({ stack: state.stack.map((e) => (e.id === state.active ? { ...e, counts: [] } : e)) });
    if (/^(count|rate)_/.test(state.measure)) app.store.set({ measure: app.fieldList(app.layer())[0] || "" });
    return app.renderAll();
  }
  const points = state.stack.filter((e) => e.visible && e.id !== state.active && app.kindOf(app.layerById(e.id)) === "point");
  if (!points.length) throw new Error("Add a point layer to the map first (N), then count its points here.");
  app.store.set({ stack: state.stack.map((e) => (e.id === state.active ? { ...e, counts: points.map((p) => p.id) } : e)) });
  app.setMeasure("count_" + points.at(-1).id);
  app.notify("Counted " + points.map((p) => app.layerById(p.id).name).join(", ") + " in each area.");
}

/** Moves the focus to the next shown layer below (-1) or above (+1) in the stack. */
function stepFocus(app, delta) {
  const shown = app.state.stack.filter((e) => e.visible);
  const i = shown.findIndex((e) => e.id === app.state.active);
  const next = shown[i + delta];
  if (next) app.focusLayer(next.id);
}

/** Shows a sidebar section (layers, style, analyze) and focuses its first control. */
function focusSection(app, name) {
  if (app.state.view !== "map") app.setView("map");
  const side = $("settings");
  side.classList.add("open");
  const section = $("sec-" + name);
  section.scrollIntoView({ block: "nearest" });
  section.querySelector("select, button, input")?.focus();
}

function wire(app) {
  const { store } = app;
  const inMap = () => app.state.view === "map" || app.state.view === "compare";
  const commands = bindCommands({
    palette: () => {
      // The library loads in the background so its layers can be offered.
      app.ws.library().then((lib) => (library = lib), () => {});
      palette.open();
    },
    "view-map": () => app.setView("map"),
    "view-compare": () => app.setView("compare"),
    "view-data": () => app.setView("data"),
    "view-sql": () => app.setView("sql"),
    layers: () => focusSection(app, "layers"),
    style: () => focusSection(app, "style"),
    analyze: () => focusSection(app, "analyze"),
    find: () => {
      if (app.state.view !== "map") app.setView("map");
      openFind(app);
    },
    regions: () => openRegions(app),
    fit: () => inMap() && $("fit").click(),
    "zoom-in": () => inMap() && app.atlas.map.zoomIn(),
    "zoom-out": () => inMap() && app.atlas.map.zoomOut(),
    "clear-selection": () => {
      store.set({ selected: null, picks: [], inspector: !!app.state.result });
      app.renderAll();
    },
    "run-analysis": () => {
      if (app.state.view !== "map") app.setView("map");
      if (!$("analyze").disabled) app.analysis.run();
    },
    density: () => {
      if (app.state.view !== "map") app.setView("map");
      import("./panels/density.js").then((m) => m.openDensity(app), report);
    },
    access: () => {
      if (app.state.view !== "map") app.setView("map");
      import("./panels/access.js").then((m) => m.openAccess(app), report);
    },
    "smooth-rate": () => {
      if (app.state.view !== "map") app.setView("map");
      import("./panels/smooth.js").then((m) => m.openSmooth(app), report);
    },
    "hot-spots": () => {
      if (app.state.view !== "map") app.setView("map");
      if (app.state.method !== "gistar") {
        app.analysis.clearResults();
        store.set({ method: "gistar" });
        app.renderAll();
      }
      if (!$("analyze").disabled) app.analysis.run();
    },
    "export-stats": () => app.state.result && app.analysis.exportStats(),
    import: () => $("file-picker").click(),
    open: () => $("project-picker").click(),
    save: () => app.perform($("save-project"), app.files.saveProject),
    export: () => inMap() && $("export-map").click(),
    offline: () => app.offline && app.perform(null, app.offline.download),
    "theme-next": () => {
      const s = cycleTheme();
      app.notify("Theme: " + THEMES.find((t) => t.id === s.theme).name);
    },
    appearance: openAppearance,
    coords: () => update({ coords: getSettings().coords === "dms" ? "dd" : "dms" }),
    help: () => openHelp(app.version),
    graticule: () => store.set({ graticule: !app.state.graticule }),
    "add-layer": () => openLibrary(app),
    "roads-position": () => {
      store.set({ roads: app.state.roads === "below" ? "above" : "below" });
      app.renderAll();
    },
    measure: () => {
      if (app.state.view !== "map" && app.state.view !== "compare") app.setView("map");
      app.tools.measure();
    },
    locate: () => {
      if (app.state.view !== "map") app.setView("map");
      return app.tools.locate();
    },
    "filter-radius": () => {
      focusSection(app, "filter");
      app.filter.pickCenter();
    },
    "filter-buffer": () => {
      focusSection(app, "filter");
      return app.perform(null, async () => app.filter.bufferSelection());
    },
    "filter-draw": () => {
      focusSection(app, "filter");
      app.filter.drawArea();
    },
    "filter-clear": () => app.filter.clear(),
    "count-points": () => toggleCounts(app),
    share: () => app.perform(null, async () => (await app.loadShare()).copyLink()),
    "export-data": () => import("./panels/exports.js").then((m) => m.openExport(app)),
    report: () =>
      app.perform(null, async () => {
        if (app.state.view !== "map") app.setView("map");
        const { openReport } = await import("./report/report.js");
        openReport(app);
      }),
    "layer-down": () => stepFocus(app, -1),
    "layer-up": () => stepFocus(app, 1),
  });
  // A tile layer turns off the commands that need its shapes (core/scope.js).
  const runCommand = (id) =>
    commandAllowed(id, app.layer()) ? commands(id) : app.notify(layerScope(app.layer()).reason);
  app.runCommand = runCommand;

  // The palette lists commands, then layers, measures and themes; places
  // matching the query come last.
  const keyOf = Object.fromEntries(SHORTCUTS.map(([id, keys]) => [id, keys.split("  or  ")[0]]));
  const available = {
    "filter-clear": () => !!app.state.filter,
    "filter-buffer": () => !!app.state.selected,
    "export-stats": () => !!app.state.result,
    "clear-selection": () => !!app.state.selected,
    offline: () => !!app.offline,
  };
  let library = null;
  const palette = createPalette((query) => {
    const { state } = app;
    const items = COMMANDS.filter(
      (c) => c.id !== "palette" && (available[c.id]?.() ?? true) && commandAllowed(c.id, app.layer()),
    ).map((c) => ({
      group: c.group,
      label: c.label,
      keys: keyOf[c.id],
      run: () => runCommand(c.id),
    }));
    for (const l of [...app.allLayers(), ...state.stack.map((e) => app.layerById(e.id)).filter((l) => l?.library)])
      items.push({
        group: "Layer",
        label: l.name,
        hint: l.id === state.active ? "showing" : "",
        run: () => (l.id === app.state.active ? app.setView("map") : app.showLayer(l.id)),
      });
    for (const f of app.fieldList(app.layer()))
      items.push({
        group: "Measure",
        label: app.label(f),
        hint: f === state.measure ? "showing" : "",
        run: () => {
          if (app.state.view !== "map") app.setView("map");
          app.setMeasure(f);
        },
      });
    for (const t of THEMES)
      items.push({ group: "Theme", label: t.name, hint: t.note, run: () => update({ theme: t.id }) });
    for (const meta of library?.layers || [])
      if (!state.stack.some((e) => e.id === meta.id))
        items.push({
          group: "Add layer",
          label: meta.name,
          hint: meta.group,
          run: () => app.perform(null, () => app.addLibraryLayer(meta.id)),
        });
    const ranked = rankItems(items, query, 40);
    // A typed coordinate offers to go there.
    const at = parseCoordinate(query);
    if (at)
      ranked.unshift({
        group: "Go to",
        label: formatPosition(at[1], at[0], getSettings().coords),
        run: () => {
          if (app.state.view !== "map") app.setView("map");
          app.tools.goto(at);
        },
      });
    if (query.trim().length < 2) return ranked;
    const fields = app.searchFields(app.layer());
    const places = findFeatures(app.records(), query, fields, 8).map((f) => {
      const id = featureId(f),
        p = f.properties || {};
      return {
        group: "Place",
        label: String(p[fields.labelField] || id),
        hint: [p[fields.groupField], id].filter(Boolean).join(" · "),
        run: () => {
          if (app.state.view !== "map") app.setView("map");
          app.selectFeature(id);
          app.atlas.fit({ features: [app.values.get(id)] });
        },
      };
    });
    return [...ranked, ...places];
  });

  for (const b of document.querySelectorAll("#nav button")) on(b, "click", () => app.setView(b.dataset.view));
  for (const b of document.querySelectorAll(".rail [data-tool]")) on(b, "click", () => runCommand(b.dataset.tool));
  for (const id of ["open-palette", "sb-palette"]) on(id, "click", () => runCommand("palette"));
  for (const id of ["add-data", "import-data"]) on(id, "click", () => $("file-picker").click());
  on("add-layer", "click", () => openLibrary(app));
  on("roads-above", "change", (ev) => {
    store.set({ roads: ev.target.checked ? "above" : "below" });
    app.renderAll();
  });
  on("find-feature", "click", () => openFind(app));
  on("brand-region", "click", () => openRegions(app));
  on("file-picker", "change", (event) => {
    const files = [...event.target.files];
    event.target.value = "";
    app.perform(null, () => app.files.importFiles(files));
  });
  on("open-project", "click", () => $("project-picker").click());
  on("project-picker", "change", (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    app.perform($("open-project"), () => app.files.restoreProject(file));
  });
  on("save-project", "click", () => app.perform($("save-project"), app.files.saveProject));
  on("analyze", "click", () => app.analysis.run());
  on("measure", "change", (ev) => {
    const value = ev.target.value;
    if (value.startsWith("category:")) {
      app.analysis.clearResults();
      store.set({ category: value.slice("category:".length) });
      app.renderAll();
    } else {
      store.set({ category: null });
      app.setMeasure(value);
    }
  });
  // The focus layer's look; a color applies to single-color layers.
  const look = (id, key, cast = (v) => v) =>
    on(id, "change", (ev) => app.setLook({ style: { [key]: cast(ev.target.value) } }));
  look("look-color", "color");
  look("look-opacity", "opacity", Number);
  look("look-size", "size", Number);
  look("look-shape", "shape");
  look("look-outline", "outline", Number);
  look("look-outline-color", "outlineColor");
  on("look-label", "change", (ev) => app.setLook({ label: ev.target.value || null }));
  on("filter-hide", "change", (ev) => {
    store.set({ filterMode: ev.target.checked ? "hide" : "dim" });
    app.renderAll();
  });
  on("filter-clear", "click", () => app.filter.clear());
  on("count-points", "click", () => runCommand("count-points"));
  on("smooth-rate", "click", () => runCommand("smooth-rate"));
  on("access-tool", "click", () => runCommand("access"));
  on("density-tool", "click", () => runCommand("density"));
  on("look-hatch", "change", (ev) => app.setLook({ style: { hatch: ev.target.checked || undefined } }));
  on("share-map", "click", () => runCommand("share"));
  on("look-reset", "click", () => {
    const { stack, active } = store.state;
    store.set({ stack: stack.map((e) => (e.id === active ? { id: e.id, visible: e.visible } : e)) });
    app.renderAll();
  });
  const controls = [
    ["classification", "classification", String],
    ["class-count", "count", Number],
    ["method", "method", String],
    ["rule", "rule", String],
    ["k", "k", (v) => Math.min(30, Math.max(1, Math.round(Number(v) || 6)))],
    ["band", "band", (v) => (Number(v) >= 0.1 ? Math.min(200, Number(v)) : null)],
    ["power", "power", Number],
    ["study", "study", String],
    ["permutations", "permutations", Number],
    ["seed", "seed", Number],
  ];
  for (const [id, key, cast] of controls)
    on(id, "change", (ev) => {
      // Read the control first: clearing a result redraws the analysis controls.
      const value = cast(ev.target.value);
      // Classes only restyle the map; analysis settings invalidate a result.
      if (key !== "classification" && key !== "count") app.analysis.clearResults();
      // Manual breaks start from the breaks on the map, rounded.
      if (key === "classification" && ev.target.value === "manual" && !app.state.breaks?.length)
        store.set({ breaks: app.style.cuts().map((c) => Number(c.toPrecision(3))) });
      store.set({ [key]: value });
      app.renderAll();
    });
  on("manual-breaks", "change", (ev) => {
    const breaks = parseBreaks(ev.target.value);
    if (!breaks) throw new Error("Type the class breaks as numbers separated by commas, such as 10, 20, 30.");
    store.set({ breaks });
    app.renderAll();
  });
  on("fdr", "change", (ev) => {
    const fdr = ev.target.checked;
    app.analysis.clearResults();
    store.set({ fdr });
    app.renderAll();
  });
  on("symmetric", "change", (ev) => {
    const symmetric = ev.target.checked;
    app.analysis.clearResults();
    store.set({ symmetric });
    app.renderAll();
  });
  on("zoom-in", "click", () => app.atlas.map.zoomIn());
  on("zoom-out", "click", () => app.atlas.map.zoomOut());
  on("fit", "click", () =>
    app.atlas.fit((app.state.view === "compare" && app.compare.collection()) || app.layer().collection),
  );
  on("export-map", "click", () =>
    app.perform($("export-map"), () => {
      const { state } = app;
      if (state.view === "compare") return app.compare.image();
      const clustered = state.result && state.mode === "cluster",
        method = methodOf(state.result);
      return exportMapImage(app.atlas.map, {
        title: $("map-title").textContent,
        subtitle:
          (clustered ? method.legendTitle + " · " : "") +
          (state.category ? app.label(state.category) : state.measure ? app.label(state.measure) : app.layer().name) +
          " · " +
          $("map-subtitle").textContent,
        legend: app.style.legendItems(),
        others: app.style.legendOthers(),
        notes:
          (clustered
            ? state.result.studyName + " · " + basisOf(state.result, state.rule) + " · " + method.rule(state.result) + " · "
            : "") +
          [app.layer().meta?.credit, ...app.style.legendOthers().map((o) => o.credit), app.catalog.region.credit]
            .filter((c, i, all) => c && all.indexOf(c) === i)
            .join(" · "),
      });
    }),
  );
  // A closed dialog keeps no focus, so single-letter keys work right away.
  $("dialog").addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    document.activeElement?.blur();
    $("dialog").close();
  });
  $("dialog").addEventListener("close", () => {
    // A late close event must not blur a dialog that has opened again.
    if ($("dialog").open) return;
    if ($("dialog").contains(document.activeElement)) document.activeElement.blur();
  });
  on("mobile-settings", "click", () => $("settings").classList.add("open"));
  on("close-side", "click", () => $("settings").classList.remove("open"));
  setupDrop((files) =>
    app.perform(null, () =>
      files.length === 1 && /\.(rumb|bgis)$/i.test(files[0].name)
        ? app.files.restoreProject(files[0])
        : app.files.importFiles(files),
    ),
  );
  document.addEventListener("keydown", (e) => {
    // A drawing tool takes Enter, Backspace and Esc first.
    if (!$("dialog").open && !palette.isOpen && !isTyping(e.target) && app.tools.key(e)) {
      e.preventDefault();
      return;
    }
    if (e.key === "Escape") {
      // Dialogs close themselves; otherwise close the drawer and leave any text box.
      if ($("dialog").open || palette.isOpen) return;
      $("settings").classList.remove("open");
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
      return;
    }
    if ($("dialog").open || palette.isOpen) return;
    const id = shortcutFor(e);
    if (!id) return;
    e.preventDefault();
    Promise.resolve()
      .then(() => runCommand(id))
      .catch(report);
  });
}

start().catch((err) => {
  status("Map could not open", "error");
  toast("Unable to open the map. " + err.message, { error: true });
  console.error(err);
});
