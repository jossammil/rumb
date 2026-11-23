// Spatial analysis: the method menu and its controls, running the chosen
// method in the statistics worker, and the statistics CSV. What each method's
// result means is in stats/methods.js.
import { featureId, groups, isPolygon } from "../core/features.js";
import { csvText } from "../data/csv.js";
import { projectedIndex } from "../geo/filter.js";
import { callStats } from "../stats/client.js";
import { METHOD_LIST, methodId, methodOf } from "../stats/methods.js";
import { centroid, DISTANCE_KINDS, summaryText } from "../stats/neighbors.js";
import { $, icon, options, saveBlob } from "../ui/dom.js";


// Controls a method adds below the menu, each loaded the first time its
// method is chosen: id → () => import(...), whose module exports render(app, mount).
const PANELS = {
  gistar: () => import("./methods/gistar.js"),
};

export function createAnalysis(app) {
  let running = null;
  const button = $("analyze");
  const idle = () => button.replaceChildren(icon("cluster"), "Run");

  function cancel() {
    running?.abort();
    running = null;
    button.disabled = false;
    idle();
  }
  /** Settings that invalidate a result clear it; the selection stays inspectable. */
  function clearResults() {
    cancel();
    app.store.set({ result: null, mode: "value", inspector: !!app.state.selected });
    renderWeights();
  }

  /** Fills the study-area list and syncs the controls with the state. */
  function renderControls(fields) {
    const { state, ref } = app,
      l = app.layer(),
      records = app.records(),
      { groupField } = app.searchFields(l);
    $("study").replaceChildren(
      ...options([
        ["all", l.id === ref.id ? ref.studyAll || "Entire layer" : "Entire layer"],
        ["extent", "Current map extent on run"],
        ...groups(records, groupField).map((g) => [groupField + ":" + g, g]),
      ]),
    );
    $("method").replaceChildren(...options(METHOD_LIST.map((m) => [m.id, m.label])));
    $("method").value = methodId(state.method);
    renderMethodControls();
    for (const [id, value] of Object.entries({
      rule: state.rule,
      study: state.study,
      permutations: state.permutations,
      seed: state.seed,
    }))
      $(id).value = String(value);
    $("fdr").checked = state.fdr;
    renderWeights();
    // Contiguity needs polygons; distance weights work between any features.
    const byDistance = DISTANCE_KINDS.has(state.rule);
    button.disabled =
      !fields.length ||
      !state.measure ||
      !!state.category ||
      running != null ||
      (!byDistance && !records.every(isPolygon));
    button.title = button.disabled
      ? byDistance
        ? "Choose a numeric measure."
        : "Choose a polygon layer with a numeric measure, or distance-based neighbors."
      : "";
  }

  /** The chosen method's own controls, loaded on first use. */
  let panelToken = 0;
  function renderMethodControls() {
    const mount = $("method-controls"),
      load = PANELS[methodId(app.state.method)];
    if (!load) return mount.replaceChildren();
    const token = ++panelToken;
    load().then((panel) => token === panelToken && panel.render(app, mount), app.fail);
  }

  /** The weights inputs for the chosen kind, and what the last run's weights were like. */
  function renderWeights() {
    const { state } = app,
      rule = state.rule;
    $("weights-params").hidden = !DISTANCE_KINDS.has(rule);
    $("k-field").hidden = rule !== "knn";
    $("symmetric-field").hidden = rule !== "knn";
    $("band-field").hidden = rule !== "band" && rule !== "idw";
    $("power-field").hidden = rule !== "idw";
    $("k").value = String(state.k);
    $("band").value = state.band == null ? "" : String(state.band);
    $("power").value = String(state.power);
    $("symmetric").checked = state.symmetric;
    const w = state.result?.weights;
    $("weights-note").textContent = w
      ? w.label + " · " + summaryText(w.summary) + (w.from ? " · from " + w.from : "")
      : DISTANCE_KINDS.has(rule)
        ? "Distances run between centers of population where the data has them, otherwise area centroids, in the region's projection."
        : "";
  }

  /**
   * Each feature's location in the region's projected plane: 2020 centers of
   * population for layers that ship them, otherwise area-weighted centroids.
   */
  async function locations(l, items) {
    const projection = app.tools.projection;
    const centers = l.reference || l.library ? await app.ws.centers(l.id).catch(() => null) : null;
    const points = {};
    if (centers) centers.ids.forEach((id, i) => (points[id] = projection.forward([centers.lon[i], centers.lat[i]])));
    for (const f of projectedIndex(l.collection, projection, featureId))
      if (!points[f.id]) points[f.id] = centroid(f.geometry);
    return { points, from: centers ? "2020 centers of population" : "area centroids" };
  }

  async function run() {
    if (running) return;
    const control = new AbortController();
    running = control;
    button.disabled = true;
    button.textContent = "Calculating…";
    app.status("Running spatial permutations…", "running");
    const started = performance.now();
    try {
      const { state, ref } = app,
        l = app.layer(),
        items = app.records(),
        cacheKey = l.id + "-" + state.rule;
      const weights = { kind: state.rule, k: state.k, miles: state.band, power: state.power, symmetric: state.symmetric };
      const ids = new Set(items.map(featureId));
      let neighbors, points, from;
      if (DISTANCE_KINDS.has(state.rule)) ({ points, from } = await locations(l, items));
      else {
        // Reference and library polygons ship their neighbors; other layers compute them once.
        let graph = l.reference
          ? (await app.ws.neighbors())[state.rule]
          : l.library && l.meta.neighbors
            ? (await app.ws.loadLayerNeighbors(l.id))[state.rule]
            : app.ws.graphs.get(cacheKey);
        if (!graph) {
          graph = await callStats({ type: "weights", features: items, rule: state.rule }, control.signal);
          app.ws.graphs.set(cacheKey, graph);
        }
        neighbors = Object.fromEntries(
          items.map((f) => [featureId(f), (graph[featureId(f)] || []).filter((id) => ids.has(id))]),
        );
      }
      const values = Object.fromEntries(items.map((f) => [featureId(f), f.properties[state.measure]]));
      let studyIds,
        studyName = $("study").selectedOptions[0].textContent;
      const { groupField } = app.searchFields(l);
      const group = groupField + ":";
      if (groupField && state.study.startsWith(group))
        studyIds = items
          .filter((f) => f.properties[groupField] === state.study.slice(group.length))
          .map(featureId);
      if (state.study === "extent") {
        studyIds = app.atlas.visibleIds(state.active);
        studyName = "Selected map extent";
      }
      // Rates with a zero denominator are excluded rather than read as zero.
      const universe = app.fieldMeta(l, state.measure)?.universe;
      const denominators = universe
        ? Object.fromEntries(items.map((f) => [featureId(f), f.properties[universe]]))
        : undefined;
      const res = await callStats(
        {
          type: methodOf({ method: state.method }).request,
          values,
          neighbors,
          points,
          weights,
          inference: state.inference,
          denominators,
          studyIds,
          permutations: state.permutations,
          seed: state.seed,
          fdr: state.fdr,
        },
        control.signal,
      );
      if (control.signal.aborted) return;
      app.timings.lastAnalysis = Math.round(performance.now() - started);
      app.timings.lastMethod = res.method === "gistar" ? "gi*" : res.method;
      app.statusbar?.timing();
      if (from) res.weights.from = from;
      app.store.set({ result: { ...res, studyName }, mode: "cluster", inspector: true });
      renderWeights();
      $("settings").classList.remove("open");
      app.draw();
    } catch (err) {
      if (err.name !== "AbortError") app.fail(err);
    } finally {
      if (running === control) {
        running = null;
        app.idleStatus();
        idle();
        button.disabled = false;
      }
    }
  }

  function exportStats() {
    const { state } = app,
      a = state.result,
      method = methodOf(a);
    const rows = Object.entries(a.byId).map(([id, r]) => method.csvRow(id, r, a, state));
    saveBlob(
      new Blob([csvText([method.csvFields, ...rows])], { type: "text/csv;charset=utf-8" }),
      method.file,
    );
  }

  return {
    run,
    cancel,
    clearResults,
    renderControls,
    exportStats,
    get running() {
      return running != null;
    },
  };
}

