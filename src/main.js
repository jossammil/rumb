// rumb: wires the catalog, workspace, map and panels together. The pieces live
// in core/ (state, data, commands, keys), map/, panels/ (each part of the
// screen) and ui/ (DOM helpers, palette, themes, status bar).
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/map.css";
import "./styles/panels.css";
import "./styles/themes.css";
import { fieldLabel, loadCatalog } from "./catalog/catalog.js";
import { number } from "./catalog/format.js";
import { bindCommands, COMMANDS } from "./core/commands.js";
import { featureId } from "./core/features.js";
import { SHORTCUTS, shortcutFor } from "./core/keys.js";
import { THEMES } from "./core/settings.js";
import { defaults, LAYER_VIEW_KEYS, layerViewDefaults } from "./core/state.js";
import { createStore } from "./core/store.js";
import { createWorkspace } from "./core/workspace.js";
import { exportMapImage } from "./map/export-png.js";
import { initMap } from "./map/map.js";
import { createAnalysis } from "./panels/analysis.js";
import { createCompare } from "./panels/compare.js";
import { createFiles } from "./panels/files.js";
import { findFeatures, openFind } from "./panels/find.js";
import { createInspector } from "./panels/inspector.js";
import { renderLayers } from "./panels/layers.js";
import { createStyle } from "./panels/style.js";
import { createWorkbench } from "./panels/workbench.js";
import { $, addIcons, on, report, toast } from "./ui/dom.js";
import { setupDrop } from "./ui/drop.js";
import { openHelp } from "./ui/help.js";
import { createPalette, rankItems } from "./ui/palette.js";
import { createStatusbar } from "./ui/statusbar.js";
import { applySettings, cycleTheme, getSettings, onSettings, openAppearance, update } from "./ui/themes.js";

const VERSION = __RUMB_VERSION__;
const STATE_LABEL = { ready: "READY", loading: "LOAD", running: "RUN", error: "ERR" };
const timings = {};
let locked = false,
  ready = false;

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
  const catalog = await loadCatalog(fetchJSON);
  $("brand-region").textContent = catalog.region.id.toUpperCase();
  const ws = createWorkspace(catalog, {
    status: (m) => status(m, "loading"),
    onDatabase: (s) => app.statusbar?.database(s),
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
    notify: (message, error = false) => toast(message, { error }),
    fail: report,
    status,
    label: (field) => fieldLabel(catalog, field),
    fieldList: (l) => ws.fieldList(l),
    allLayers: () => [ws.referenceView(), ...store.state.layers],
    layer() {
      const { active, layers } = store.state;
      return active === ws.ref.id ? ws.referenceView() : layers.find((l) => l.id === active);
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
    showLayer,
    selectFeature(id) {
      if (!app.values.has(String(id))) return;
      store.set({ selected: String(id), inspector: true });
      app.renderInspector();
    },
    setMeasure(field) {
      app.analysis.clearResults();
      store.set({ measure: field });
      renderAll();
    },
    /** Adds a mapped query result and shows it. */
    addLayer(layer, sql) {
      store.set({ layers: [...store.state.layers, layer], sql });
      showLayer(layer.id);
      app.notify("Added " + layer.name + " to the map.");
    },
  };

  function renderAll() {
    const l = app.layer(),
      fields = app.fieldList(l);
    renderLayers(app);
    app.style.renderControls(fields);
    app.analysis.renderControls(fields);
    const ref = ws.ref;
    app.setTitles(
      l.builtIn
        ? { title: ref.title, subtitle: ref.subtitle, credit: ref.credit, context: ref.context || ref.subtitle }
        : {
            title: l.name,
            subtitle:
              number(l.collection.features.length) + " features · " + (l.reference ? ref.name : "Local query layer"),
            credit: l.name,
            context: l.name,
          },
    );
    app.idleStatus();
    app.draw();
  }

  function setView(view, restoring = false) {
    if (!ready) return;
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

  /** Switches the active layer, remembering each layer's own view settings. */
  function showLayer(id, fit = true) {
    app.analysis.cancel();
    const { state } = app;
    const layerViews = {
      ...state.layerViews,
      [state.active]: Object.fromEntries(LAYER_VIEW_KEYS.map((key) => [key, state[key]])),
    };
    store.set({ active: id, compareLayer: id });
    const l = app.layer();
    const saved = layerViews[id] || layerViewDefaults(catalog, l.preferredMeasure || app.fieldList(l)[0] || "");
    delete layerViews[id];
    store.set({ ...saved, layerViews });
    setView("map");
    if (fit) app.atlas.fit(l.collection);
  }

  app.atlas = initMap({
    region: catalog.region,
    regionPath: catalog.path,
    onSelect: (id) => (store.state.view === "compare" ? app.compare.toggle(String(id)) : app.selectFeature(id)),
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
  onSettings(() => {
    app.atlas.retheme();
    if (store.state.view === "compare") app.setView("compare", true);
    else if (store.state.view === "map") app.draw();
  });
  ready = true;
  renderAll();
  app.atlas.map.once("idle", () => {
    if (app.atlas.map.queryRenderedFeatures({ layers: ["areas"] }).length) {
      performance.mark("rumb-first-map");
      timings.firstMap = Math.round(performance.now());
    }
  });
  wire(app);

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
  const runCommand = bindCommands({
    palette: () => palette.open(),
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
    fit: () => inMap() && $("fit").click(),
    "zoom-in": () => inMap() && app.atlas.map.zoomIn(),
    "zoom-out": () => inMap() && app.atlas.map.zoomOut(),
    "clear-selection": () => {
      store.set({ selected: null, inspector: !!app.state.result });
      app.renderInspector();
    },
    "run-analysis": () => {
      if (app.state.view !== "map") app.setView("map");
      if (!$("analyze").disabled) app.analysis.run();
    },
    "export-stats": () => app.state.result && app.analysis.exportStats(),
    import: () => $("file-picker").click(),
    open: () => $("project-picker").click(),
    save: () => app.perform($("save-project"), app.files.saveProject),
    export: () => inMap() && $("export-map").click(),
    offline: () => app.offline?.download(),
    "theme-next": () => {
      const s = cycleTheme();
      app.notify("Theme: " + THEMES.find((t) => t.id === s.theme).name);
    },
    appearance: openAppearance,
    coords: () => update({ coords: getSettings().coords === "dms" ? "dd" : "dms" }),
    help: () => openHelp(app.version),
  });
  app.runCommand = runCommand;

  // The palette lists commands, then layers, measures and themes; places
  // matching the query come last.
  const keyOf = Object.fromEntries(SHORTCUTS.map(([id, keys]) => [id, keys.split("  or  ")[0]]));
  const available = {
    "export-stats": () => !!app.state.result,
    "clear-selection": () => !!app.state.selected,
    offline: () => !!app.offline,
  };
  const palette = createPalette((query) => {
    const { state } = app;
    const items = COMMANDS.filter((c) => c.id !== "palette" && (available[c.id]?.() ?? true)).map((c) => ({
      group: c.group,
      label: c.label,
      keys: keyOf[c.id],
      run: () => runCommand(c.id),
    }));
    for (const l of app.allLayers())
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
    const ranked = rankItems(items, query, 40);
    if (query.trim().length < 2) return ranked;
    const ref = app.ref;
    const places = findFeatures(app.records(), query, ref, 8).map((f) => {
      const id = featureId(f),
        p = f.properties || {};
      return {
        group: "Place",
        label: String(p[ref.labelField] || id),
        hint: [p[ref.groupField], id].filter(Boolean).join(" · "),
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
  for (const id of ["open-palette", "sb-palette"]) on(id, "click", () => palette.open());
  for (const id of ["add-data", "import-data"]) on(id, "click", () => $("file-picker").click());
  on("find-feature", "click", () => openFind(app));
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
  on("measure", "change", (ev) => app.setMeasure(ev.target.value));
  const controls = [
    ["classification", "classification", String],
    ["class-count", "count", Number],
    ["rule", "rule", String],
    ["study", "study", String],
    ["permutations", "permutations", Number],
    ["seed", "seed", Number],
  ];
  for (const [id, key, cast] of controls)
    on(id, "change", (ev) => {
      // Classes only restyle the map; analysis settings invalidate a result.
      if (key !== "classification" && key !== "count") app.analysis.clearResults();
      store.set({ [key]: cast(ev.target.value) });
      app.renderAll();
    });
  on("fdr", "change", (ev) => {
    app.analysis.clearResults();
    store.set({ fdr: ev.target.checked });
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
      const clustered = state.result && state.mode === "cluster";
      return exportMapImage(app.atlas.map, {
        title: $("map-title").textContent,
        subtitle:
          (state.mode === "cluster" ? "Local Moran clusters · " : "") +
          app.label(state.measure) +
          " · " +
          $("map-subtitle").textContent,
        legend: app.style.legendItems(),
        notes:
          (clustered
            ? state.result.studyName + " · " + state.rule + " · " + (state.fdr ? "FDR q" : "p") + " ≤ 0.05 · "
            : "") + app.catalog.region.credit,
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
