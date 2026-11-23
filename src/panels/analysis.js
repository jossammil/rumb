// Spatial analysis: the Find clusters controls, running Moran's I and LISA in
// the statistics worker, and the statistics CSV.
import { featureId, groups, isPolygon } from "../core/features.js";
import { csvText } from "../data/csv.js";
import { callStats } from "../stats/client.js";
import { $, icon, options, saveBlob } from "../ui/dom.js";

const CSV_FIELDS = [
  "GEOID_or_feature_ID",
  "measure",
  "value",
  "z",
  "neighbor_mean_z",
  "local_I",
  "permutation_p",
  "FDR_q",
  "cluster",
  "eligible_neighbors",
  "reason",
  "study_area",
  "neighbor_rule",
  "global_I",
  "global_p",
  "permutations",
  "seed",
  "alpha",
  "FDR_applied",
  "method",
];

export function createAnalysis(app) {
  let running = null;
  const button = $("analyze");
  const idle = () => button.replaceChildren(icon("cluster"), "Find clusters");

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
    for (const [id, value] of Object.entries({
      rule: state.rule,
      study: state.study,
      permutations: state.permutations,
      seed: state.seed,
    }))
      $(id).value = String(value);
    $("fdr").checked = state.fdr;
    button.disabled =
      !fields.length || !state.measure || !!state.category || running != null || !records.every(isPolygon);
    button.title = button.disabled ? "Choose a polygon layer with a numeric measure." : "";
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
      const ids = new Set(items.map(featureId));
      const neighbors = Object.fromEntries(
        items.map((f) => [featureId(f), (graph[featureId(f)] || []).filter((id) => ids.has(id))]),
      );
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
          type: "analyze",
          values,
          neighbors,
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
      app.statusbar?.timing();
      app.store.set({ result: { ...res, studyName }, mode: "cluster", inspector: true });
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
      a = state.result;
    const rows = Object.entries(a.byId).map(([id, r]) => [
      id,
      state.measure,
      r.value,
      r.z,
      r.lag,
      r.localI,
      r.p,
      r.q,
      r.cluster,
      r.neighbors.join(" "),
      r.reason,
      a.studyName,
      state.rule,
      a.globalI,
      a.globalP,
      a.permutations,
      a.seed,
      a.alpha,
      a.fdr,
      a.method,
    ]);
    saveBlob(
      new Blob([csvText([CSV_FIELDS, ...rows])], { type: "text/csv;charset=utf-8" }),
      "spatial-clusters.csv",
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

