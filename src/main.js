// rumb: wires the catalog, workspace, map and panels together. The pieces live
// in core/ (state and data), map/, panels/ (each part of the screen) and ui/.
import "./styles/app.css";
import "./styles/compare.css";
import { fieldLabel, loadCatalog } from "./catalog/catalog.js";
import { number } from "./catalog/format.js";
import { defaults, LAYER_VIEW_KEYS, layerViewDefaults } from "./core/state.js";
import { createStore } from "./core/store.js";
import { createWorkspace } from "./core/workspace.js";
import { initMap } from "./map/map.js";
import { exportMapImage } from "./map/export-png.js";
import { createAnalysis } from "./panels/analysis.js";
import { createCompare } from "./panels/compare.js";
import { createFiles } from "./panels/files.js";
import { openFind } from "./panels/find.js";
import { createInspector } from "./panels/inspector.js";
import { renderLayers } from "./panels/layers.js";
import { createStyle } from "./panels/style.js";
import { createWorkbench } from "./panels/workbench.js";
import { $, addIcons, h, icon, on, report, toast } from "./ui/dom.js";

const timings = {};
let locked = false,
  ready = false;

function status(message, kind = "ready") {
  $("foot-status").textContent = message;
  document.documentElement.dataset.status = kind;
}

async function fetchJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error("Unable to read " + path + " (" + res.status + ").");
  return res.json();
}

async function start() {
  addIcons();
  const catalog = await loadCatalog(fetchJSON);
  const ws = createWorkspace(catalog, { status: (m) => status(m, "loading") });
  const store = createStore(defaults(catalog));

  const app = {
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
        report(error);
      } finally {
        locked = false;
        if (button) button.disabled = false;
        if (ready && !app.analysis.running) app.idleStatus();
      }
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
              number(l.collection.features.length) +
              " features · " +
              (l.reference ? ref.name : "Local query layer"),
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
    const saved =
      layerViews[id] || layerViewDefaults(catalog, l.preferredMeasure || app.fieldList(l)[0] || "");
    delete layerViews[id];
    store.set({ ...saved, layerViews });
    setView("map");
    if (fit) app.atlas.fit(l.collection);
  }

  app.atlas = initMap({
    region: catalog.region,
    regionPath: catalog.path,
    onSelect: (id) =>
      store.state.view === "compare" ? app.compare.toggle(String(id)) : app.selectFeature(id),
  });
  await Promise.all([app.atlas.ready, ws.loadDisplay()]);
  app.style = createStyle(app);
  app.values = app.style.values;
  app.inspector = createInspector(app);
  app.analysis = createAnalysis(app);
  app.bench = createWorkbench(app);
  app.compare = createCompare(app);
  app.files = createFiles(app);
  ready = true;
  renderAll();
  app.atlas.map.once("idle", () => {
    if (app.atlas.map.queryRenderedFeatures({ layers: ["areas"] }).length) {
      performance.mark("rumb-first-map");
      timings.firstMap = Math.round(performance.now());
    }
  });

  // For debugging in the console, the e2e checks and scripts/benchmark-browser.mjs.
  window.rumb = {
    version: __RUMB_VERSION__,
    timings,
    app,
    map: app.atlas.map,
    get state() {
      return store.state;
    },
    /** A separate DuckDB with the reference layer registered (for benchmarks). */
    openDatabase: async (options) => {
      const { openDatabase } = await import("./data/database.js");
      return openDatabase(options || { reference: await ws.reference() });
    },
  };

  wire(app);
}

function wire(app) {
  const { store } = app;
  const find = h(
    "button",
    { id: "find-feature", "aria-label": "Find a feature", title: "Find a feature", onclick: () => openFind(app) },
    icon("inspect"),
  );
  $("fit").after(find);
  for (const b of document.querySelectorAll("#nav button")) on(b, "click", () => app.setView(b.dataset.view));
  for (const id of ["add-data", "import-data"]) on(id, "click", () => $("file-picker").click());
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
    app.analysis.clearResults();
    store.set({ measure: ev.target.value });
    app.renderAll();
  });
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
            ? state.result.studyName +
              " · " +
              state.rule +
              " · " +
              (state.fdr ? "FDR q" : "p") +
              " ≤ 0.05 · "
            : "") + app.catalog.region.credit,
      });
    }),
  );
  on("mobile-settings", "click", () => $("settings").classList.add("open"));
  on("close-side", "click", () => $("settings").classList.remove("open"));
  document.addEventListener("dragover", (ev) => {
    if (ev.dataTransfer?.types.includes("Files")) ev.preventDefault();
  });
  document.addEventListener("drop", (ev) => {
    if (!ev.dataTransfer?.files.length) return;
    ev.preventDefault();
    const files = [...ev.dataTransfer.files];
    app.perform(null, () =>
      files.length === 1 && /\.(rumb|bgis)$/i.test(files[0].name)
        ? app.files.restoreProject(files[0])
        : app.files.importFiles(files),
    );
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") $("settings").classList.remove("open");
  });
}

start().catch((err) => {
  status("Map could not open", "error");
  toast("Unable to open the map. " + err.message, { error: true });
  console.error(err);
});
