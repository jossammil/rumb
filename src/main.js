import "./style.css";
import "./compare.css";
import { comparisonWorkspace } from "./compare.js";
import { initMap } from "./map.js";
import { callStats, inspection } from "./analysis-view.js";
import { createWorkbench } from "./workbench.js";
import {
  node,
  icon,
  number,
  escape as e,
  colors,
  clusters,
  classify,
  ramp,
  saveBlob,
} from "./ui.js";

const MS = "tracts",
  primaryFields = ["poverty_pct", "child_poverty_pct"];
const fieldNames = {
  poverty_pct: "Population below poverty",
  child_poverty_pct: "Children below poverty",
  poverty_universe: "Poverty universe",
  child_poverty_universe: "Child poverty universe",
  poverty_count: "People below poverty",
  child_poverty_count: "Children below poverty (count)",
  poverty_moe: "Poverty margin of error",
  child_poverty_moe: "Child poverty margin of error",
};
const defaults = () => ({
  view: "map",
  active: MS,
  measure: "poverty_pct",
  palette: "Lagoon",
  classification: "quantile",
  count: 5,
  rule: "queen",
  study: "all",
  permutations: 999,
  seed: 12345,
  fdr: false,
  selected: null,
  result: null,
  mode: "value",
  inspector: false,
  sql: "SELECT GEOID, name, county, poverty_pct\nFROM tracts\nORDER BY poverty_pct DESC NULLS LAST",
  layers: [],
  layerViews: {},
  comparisons: {},
  compareLayer: null,
});
let state = defaults(),
  base,
  neighborData,
  baseBlobs = {},
  inputs = new Map(),
  databasePromise,
  runningStats,
  locked = false,
  toastTimer;
let currentColors = [],
  cuts = [],
  valueMap = new Map(),
  userGeometries = new Map(),
  ready = false;
let atlas, bench, comparison;
const timings = {};
const styleName = (f) => fieldNames[f] || f?.replaceAll("_", " ") || "Features";
const layer = () =>
  state.active === MS
    ? {
        id: MS,
        name: "Mississippi tracts",
        collection: base,
        tracts: true,
        baseMeasures: true,
      }
    : state.layers.find((l) => l.id === state.active);
const getID = (f) => String(f.id ?? f.properties?.GEOID);
const records = () => layer().collection.features;
const fieldList = (l) => {
  if (l.id === MS) return primaryFields;
  const set = new Set();
  for (const f of l.collection.features)
    for (const [k, v] of Object.entries(f.properties ?? {}))
      if (
        typeof v === "number" &&
        Number.isFinite(v) &&
        !/^(__atlas_|ogc_fid$|fid$|geoid$)/i.test(k)
      )
        set.add(k);
  return [...set];
};
function notify(message, error = false) {
  clearTimeout(toastTimer);
  const el = node("toast");
  el.classList.toggle("error", error);
  el.textContent = message;
  el.hidden = false;
  toastTimer = setTimeout(() => (el.hidden = true), error ? 11000 : 5200);
}
function status(message) {
  node("foot-status").textContent = message;
}
function idleStatus() {
  if (state.view === "compare") {
    status(node("cmp-count").textContent);
    return;
  }
  status(number(records().length, 0) + " features · " + layer().name);
}
async function perform(button, operation) {
  if (locked) {
    notify("Another file or query operation is still running.");
    return;
  }
  locked = true;
  if (button) button.disabled = true;
  try {
    await operation();
  } catch (error) {
    console.error(error);
    notify(error.message || String(error), true);
  } finally {
    locked = false;
    if (button) button.disabled = false;
    if (ready && !runningStats) idleStatus();
  }
}
async function asset(name) {
  const cache = baseBlobs;
  if (cache[name]) return cache[name];
  const res = await fetch("./data/" + name);
  if (!res.ok)
    throw new Error("Unable to read " + name + " (" + res.status + ").");
  return (cache[name] = await res.blob());
}
async function getNeighbors() {
  if (!neighborData)
    neighborData = JSON.parse(await (await asset("neighbors.json")).text());
  return neighborData;
}
async function db() {
  if (!databasePromise) {
    status("Opening browser database…");
    databasePromise = (async () => {
      const { openDatabase } = await import("./database.js");
      const engine = await openDatabase({
        tractsFile: new File([await asset("tracts.parquet")], "tracts.parquet"),
        tractDisplay: base,
      });
      try {
        for (const [name, file] of inputs) await engine.importFile(file, name);
      } catch (err) {
        await engine.close();
        throw err;
      }
      return engine;
    })().catch((err) => {
      databasePromise = null;
      throw err;
    });
  }
  return databasePromise;
}
function setView(view, restoring = false) {
  if (!ready) return;
  const previous = state.view,
    comparing = view === "compare",
    mapped = comparing || view === "map";
  if (comparing && previous === "map") state.mapCamera = atlas.camera();
  comparison.leave();
  state.view = view;
  node("map-view").hidden = !mapped;
  node("work-view").hidden = mapped;
  node("map-view").classList.toggle("comparing", comparing);
  node("cmp-split").hidden = node("cmp-panel").hidden = !comparing;
  node("settings").hidden = comparing;
  document.querySelectorAll("#nav button").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === view);
    b.setAttribute("aria-current", b.dataset.view === view ? "page" : "false");
  });
  node("settings").classList.remove("open");
  bench.render(mapped ? "map" : view);
  if (mapped) atlas.map.resize();
  if (comparing) {
    const id = state.compareLayer || state.active;
    comparison.open(id, !restoring && id !== state.active);
  } else if (view === "map") {
    renderAll();
    if (state.mapCamera && !restoring) atlas.map.jumpTo(state.mapCamera);
    delete state.mapCamera;
  }
}
function cancelAnalysis() {
  runningStats?.abort();
  runningStats = null;
  node("analyze").disabled = false;
  node("analyze").innerHTML = icon("cluster") + "Find clusters";
}
function clearResults() {
  cancelAnalysis();
  state.result = null;
  state.mode = "value";
  state.inspector = !!state.selected;
}
function selectFeature(id) {
  if (!valueMap.has(String(id))) return;
  state.selected = String(id);
  state.inspector = true;
  renderInspector();
}
function showLayer(id, fit = true) {
  cancelAnalysis();
  const keys = [
    "measure",
    "palette",
    "classification",
    "count",
    "rule",
    "study",
    "permutations",
    "seed",
    "fdr",
    "selected",
    "result",
    "mode",
    "inspector",
  ];
  state.layerViews[state.active] = Object.fromEntries(
    keys.map((key) => [key, state[key]]),
  );
  state.active = id;
  state.compareLayer = id;
  const l = layer();
  const fallback = defaults();
  fallback.measure = l.preferredMeasure || fieldList(l)[0] || "";
  const saved = state.layerViews[id] || fallback;
  for (const key of keys) state[key] = saved[key];
  delete state.layerViews[id];
  setView("map");
  if (fit) atlas.fit(l.collection);
}
function applyNeighbors() {
  const id = state.selected;
  if (!id) {
    atlas.select(null, []);
    return null;
  }
  const l = layer(),
    graph = l.tracts
      ? neighborData?.[state.rule]
      : userGeometries.get(l.id + "-" + state.rule);
  const adjacent = state.result?.byId?.[id]?.neighbors ?? graph?.[id];
  atlas.select(id, adjacent || []);
  return adjacent;
}
function renderInspector() {
  if (state.view === "compare") return;
  const pane = node("inspect-panel"),
    adjacent = applyNeighbors();
  if (!state.inspector || (!state.selected && !state.result)) {
    pane.hidden = true;
    return;
  }
  pane.hidden = false;
  pane.innerHTML = inspection({
    feature: valueMap.get(state.selected),
    id: state.selected,
    measure: state.measure,
    label: styleName(state.measure),
    result: state.result,
    selectedMode: state.mode,
    rule: state.rule,
    study: state.result?.studyName,
    baseMeasures: layer().baseMeasures,
    eligibleNeighbors: adjacent,
  });
  node("dismiss-inspect").onclick = () => {
    state.selected = null;
    state.inspector = false;
    renderInspector();
  };
  pane
    .querySelectorAll("[data-point]")
    .forEach((dot) => (dot.onclick = () => selectFeature(dot.dataset.point)));
  pane.querySelectorAll("[data-mode]").forEach(
    (button) =>
      (button.onclick = () => {
        state.mode = button.dataset.mode;
        draw();
      }),
  );
  if (node("save-results")) node("save-results").onclick = exportStats;
  if (state.selected && !neighborData && layer().tracts)
    getNeighbors()
      .then(() => {
        if (state.selected && state.inspector) renderInspector();
      })
      .catch((err) => notify(err.message, true));
}
const csvCell = (v) => '"' + String(v ?? "").replaceAll('"', '""') + '"';
function exportStats() {
  const a = state.result;
  const fields = [
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
  const data = [
    fields,
    ...Object.entries(a.byId).map(([id, r]) => [
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
    ]),
  ];
  saveBlob(
    new Blob([data.map((row) => row.map(csvCell).join(",")).join("\r\n")], {
      type: "text/csv;charset=utf-8",
    }),
    "spatial-clusters.csv",
  );
}
function legendItems() {
  if (state.mode === "cluster" && state.result)
    return Object.values(clusters).map(([text, color]) => ({ text, color }));
  if (!state.measure) return [{ color: "#397d70", text: "Features" }];
  const fmt = (v) => number(v, 2);
  return currentColors
    .map((color, i) => ({
      color,
      text:
        currentColors.length === 1
          ? "All values"
          : i === 0
            ? "< " + fmt(cuts[0])
            : i === cuts.length
              ? "≥ " + fmt(cuts.at(-1))
              : fmt(cuts[i - 1]) + "–<" + fmt(cuts[i]),
    }))
    .concat({ color: "#b6bdb5", text: "Unavailable" });
}
function draw() {
  if (state.view === "compare") return;
  const l = layer(),
    features = l.collection.features,
    values = features.map((f) => f.properties?.[state.measure]);
  cuts = classify(values, state.count, state.classification);
  currentColors = ramp(state.palette, cuts.length + 1);
  const clustered = state.mode === "cluster" && state.result;
  const annotated = features.map((f) => {
    const id = getID(f),
      v = f.properties?.[state.measure];
    let color = !state.measure
      ? "#397d70"
      : !Number.isFinite(v)
        ? "#b6bdb5"
        : currentColors[cuts.filter((c) => v >= c).length];
    if (clustered) color = clusters[state.result.byId[id]?.cluster ?? "NA"][1];
    return {
      ...f,
      properties: { ...f.properties, __atlas_id: id, __atlas_color: color },
    };
  });
  valueMap = new Map(features.map((f) => [getID(f), f]));
  atlas.draw(annotated);
  const title = clustered ? "Local Moran clusters" : styleName(state.measure);
  const list = legendItems(),
    legend = node("legend");
  if (clustered)
    legend.innerHTML =
      '<div class="legend-title">' +
      title +
      '</div><div class="legend-cats">' +
      list
        .map(
          (x) =>
            '<span><i class="chip" style="background:' +
            x.color +
            '"></i>' +
            e(x.text) +
            "</span>",
        )
        .join("") +
      "</div>";
  else {
    const valid = values.filter(Number.isFinite),
      unit = l.baseMeasures && primaryFields.includes(state.measure) ? "%" : "";
    const limits = valid.reduce(
      ([lo, hi], v) => [Math.min(lo, v), Math.max(hi, v)],
      [Infinity, -Infinity],
    );
    legend.innerHTML =
      '<div class="legend-title">' +
      e(title) +
      '</div><div class="legend-bar">' +
      list
        .filter((x) => x.text !== "Unavailable")
        .map(
          (x) =>
            '<i title="' +
            e(x.text) +
            '" style="background:' +
            x.color +
            '"></i>',
        )
        .join("") +
      "</div>" +
      (valid.length
        ? '<div class="legend-extents"><span>' +
          number(limits[0]) +
          unit +
          "</span><span>" +
          number(limits[1]) +
          unit +
          "</span></div>"
        : "") +
      (state.measure
        ? '<div class="legend-note"><i class="chip" style="background:#b6bdb5"></i>' +
          number(values.length - valid.length) +
          " unavailable</div>"
        : "");
  }
  if (!clustered && state.measure) {
    const details = document.createElement("details");
    details.className = "breaks";
    details.innerHTML =
      "<summary>Class breaks</summary>" +
      list
        .filter((x) => x.text !== "Unavailable")
        .map(
          (x) =>
            '<div><i class="chip" style="background:' +
            x.color +
            '"></i>' +
            e(x.text) +
            "</div>",
        )
        .join("");
    legend.append(details);
  }
  if (state.result) {
    const b = document.createElement("button");
    b.className = "plain-btn";
    b.textContent = "View analysis";
    b.onclick = () => {
      state.inspector = true;
      renderInspector();
    };
    legend.append(b);
  }
  renderInspector();
}
function renderAll() {
  const l = layer();
  const entry = (id, name, desc) =>
    '<button class="layer ' +
    (id === state.active ? "active" : "") +
    '" data-layer="' +
    e(id) +
    '"><span class="layer-icon">' +
    icon("layers", 18) +
    '</span><span class="layer-text"><strong>' +
    e(name) +
    "</strong><small>" +
    e(desc) +
    "</small></span>" +
    (id === state.active
      ? '<span class="tick">' + icon("check") + "</span>"
      : "") +
    "</button>";
  node("layer-list").innerHTML =
    entry(
      MS,
      "Mississippi tracts",
      number(base.features.length) + " census tracts",
    ) +
    state.layers
      .map((x) =>
        entry(x.id, x.name, number(x.collection.features.length) + " features"),
      )
      .join("");
  node("layer-list")
    .querySelectorAll("button")
    .forEach(
      (b) =>
        (b.onclick = () => {
          if (b.dataset.layer !== state.active) showLayer(b.dataset.layer);
        }),
    );
  if (l.sql) {
    const inspectSQL = document.createElement("button");
    inspectSQL.className = "plain-btn";
    inspectSQL.textContent = "Inspect layer SQL";
    inspectSQL.onclick = () => {
      state.sql = l.sql;
      setView("sql");
    };
    node("layer-list").append(inspectSQL);
  }
  const fields = fieldList(l);
  node("measure").innerHTML = fields.length
    ? fields
        .map(
          (f) =>
            '<option value="' + e(f) + '">' + e(styleName(f)) + "</option>",
        )
        .join("")
    : '<option value="">Uniform style</option>';
  node("measure").value = state.measure;
  node("measure").disabled = !fields.length;
  const counties = [
    ...new Set(
      records()
        .map((f) => f.properties?.county)
        .filter((x) => typeof x === "string"),
    ),
  ].sort();
  node("study").innerHTML =
    '<option value="all">' +
    (l.tracts ? "All Mississippi tracts" : "Entire layer") +
    '</option><option value="extent">Current map extent on run</option>' +
    counties
      .map(
        (c) => '<option value="' + e("county:" + c) + '">' + e(c) + "</option>",
      )
      .join("");
  for (const [id, val] of Object.entries({
    classification: state.classification,
    "class-count": state.count,
    study: state.study,
    rule: state.rule,
    permutations: state.permutations,
    seed: state.seed,
  }))
    node(id).value = String(val);
  node("fdr").checked = state.fdr;
  node("analyze").disabled =
    !fields.length ||
    runningStats != null ||
    !records().every((f) =>
      ["Polygon", "MultiPolygon"].includes(f.geometry?.type),
    );
  node("analyze").title = node("analyze").disabled
    ? "Choose a polygon layer with a numeric measure."
    : "";
  node("palettes").innerHTML = Object.entries(colors)
    .map(
      ([name, r]) =>
        '<button aria-label="' +
        name +
        ' palette" title="' +
        name +
        '" aria-pressed="' +
        (state.palette === name) +
        '" data-palette="' +
        name +
        '">' +
        r.map((c) => '<span style="background:' + c + '"></span>').join("") +
        "</button>",
    )
    .join("");
  node("palettes")
    .querySelectorAll("button")
    .forEach(
      (b) =>
        (b.onclick = () => {
          state.palette = b.dataset.palette;
          renderAll();
        }),
    );
  node("map-credit").textContent =
    l.id === MS ? "Boundaries & estimates · U.S. Census Bureau" : l.name;
  node("map-title").textContent = l.id === MS ? "Mississippi" : l.name;
  node("map-subtitle").textContent =
    l.id === MS
      ? "Census tracts · ACS 2020–2024"
      : number(l.collection.features.length) +
        " features · " +
        (l.tracts ? "Mississippi tracts" : "Local query layer");
  node("foot-context").textContent =
    l.id === MS ? "ACS 2020–2024 · U.S. Census Bureau" : l.name;
  idleStatus();
  draw();
}
async function analyze() {
  if (runningStats) return;
  const control = new AbortController();
  runningStats = control;
  const b = node("analyze");
  b.disabled = true;
  b.textContent = "Calculating…";
  status("Running spatial permutations…");
  try {
    const l = layer(),
      items = records(),
      cacheKey = l.id + "-" + state.rule;
    let graph = l.tracts
      ? (await getNeighbors())[state.rule]
      : userGeometries.get(cacheKey);
    if (!graph) {
      graph = await callStats(
        { type: "weights", features: items, rule: state.rule },
        control.signal,
      );
      userGeometries.set(cacheKey, graph);
    }
    const ids = new Set(items.map(getID));
    const neighbors = Object.fromEntries(
      items.map((f) => [
        getID(f),
        (graph[getID(f)] || []).filter((id) => ids.has(id)),
      ]),
    );
    const values = Object.fromEntries(
      items.map((f) => [getID(f), f.properties[state.measure]]),
    );
    let studyIds,
      studyName = node("study").selectedOptions[0].textContent;
    if (state.study.startsWith("county:"))
      studyIds = items
        .filter((f) => f.properties.county === state.study.slice(7))
        .map(getID);
    if (state.study === "extent") {
      studyIds = [
        ...new Set(
          atlas.map
            .queryRenderedFeatures({ layers: ["areas"] })
            .map((f) => f.properties.__atlas_id),
        ),
      ];
      studyName = "Selected map extent";
    }
    const prefix =
      state.measure === "child_poverty_pct" ? "child_poverty" : "poverty";
    const denominators =
      l.baseMeasures && primaryFields.includes(state.measure)
        ? Object.fromEntries(
            items.map((f) => [getID(f), f.properties[prefix + "_universe"]]),
          )
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
    state.result = { ...res, studyName };
    state.mode = "cluster";
    state.inspector = true;
    node("settings").classList.remove("open");
    draw();
  } catch (err) {
    if (err.name !== "AbortError") notify(err.message, true);
  } finally {
    if (runningStats === control) {
      runningStats = null;
      idleStatus();
      b.innerHTML = icon("cluster") + "Find clusters";
      b.disabled = false;
    }
  }
}
async function mapSQL(sql, name, opts = {}) {
  const engine = await db();
  status("Preparing map layer…");
  const preview = await engine.query(sql, { limit: 1 });
  const hasGeom = preview.columns.some((c) =>
    /^(GEOMETRY|WKB_BLOB)/.test(c.type),
  );
  const isTracts =
    !!opts.tractJoined ||
    (!hasGeom && preview.columns.some((c) => c.name.toLowerCase() === "geoid"));
  const mapSQL =
    opts.tractJoined && hasGeom
      ? "SELECT * EXCLUDE (geometry) FROM (" +
        sql.replace(/;+\s*$/, "") +
        ") AS joined"
      : sql;
  const { collection, truncated } = await engine.mapQuery(mapSQL);
  if (truncated)
    throw new Error(
      "This result exceeds the map preview budget. Filter or aggregate it in SQL, then add the complete result to the map.",
    );
  if (!collection.features.length)
    throw new Error("There are no matching geometries to map.");
  if (isTracts) {
    // Key variants in SQL (e.g. geoid) should still index canonical tract weights.
    const used = new Set();
    for (const f of collection.features) {
      const key = Object.keys(f.properties).find(
        (k) => k.toLowerCase() === "geoid",
      );
      const geoid = String(f.properties[key]).trim();
      if (used.has(geoid))
        throw new Error(
          "The query has multiple rows per tract. Group by GEOID before mapping it.",
        );
      used.add(geoid);
      f.id = geoid;
    }
  }
  const id = crypto.randomUUID(),
    l = {
      id,
      name,
      sql,
      collection,
      tracts: isTracts,
      baseMeasures: !!opts.tractJoined,
    };
  const fields = fieldList(l);
  l.preferredMeasure =
    (opts.preferred || []).find((f) => fields.includes(f)) ||
    fields.find((f) => !Object.hasOwn(fieldNames, f)) ||
    fields[0] ||
    "";
  state.layers.push(l);
  state.sql = sql;
  showLayer(id);
  notify("Added " + name + " to the map.");
}
async function importFiles(files) {
  if (!files?.length) return;
  const engine = await db();
  let last,
    errorMessages = [];
  for (const file of files) {
    try {
      status("Importing " + file.name + "…");
      const info = await engine.importFile(file);
      inputs.set(info.name, file);
      last = info.name;
    } catch (err) {
      errorMessages.push(file.name + " — " + err.message);
    }
  }
  if (last) {
    bench.select(last);
    setView("data");
  }
  if (errorMessages.length) throw new Error(errorMessages.join("\n"));
  notify(
    "Imported " +
      files.length +
      " file" +
      (files.length === 1 ? "" : "s") +
      " on this device.",
  );
}
async function saveProject() {
  status("Packaging project…");
  const { packProject } = await import("./project.js");
  const files = {};
  for (const name of [
    "tracts.geojson",
    "tracts.parquet",
    "neighbors.json",
    "sources.json",
  ])
    files[name] = await asset(name);
  if (
    state.comparisons.tracts ||
    (state.view === "compare" && state.compareLayer === MS)
  )
    files["places-2025.json"] = await asset("places-2025.json");
  const saved = { ...state, camera: atlas.camera() };
  const blob = await packProject(saved, inputs, files);
  saveBlob(blob, "project.rumb");
  notify("Project exported with its source data and settings.");
}
async function restore(file) {
  if (!file) return;
  status("Opening project…");
  const { unpackProject } = await import("./project.js");
  const next = await unpackProject(file);
  const s = next.state,
    b = JSON.parse(await next.base["tracts.geojson"].text()),
    weights = JSON.parse(await next.base["neighbors.json"].text());
  if (
    !Array.isArray(b.features) ||
    !Array.isArray(s.layers) ||
    s.layers.some((l) => !Array.isArray(l.collection?.features)) ||
    !(s.active === MS || s.layers.some((l) => l.id === s.active)) ||
    !colors[s.palette] ||
    !weights.queen ||
    !weights.rook
  )
    throw new Error("Project contains invalid layer or style definitions.");
  // Stage imported tables before replacing the open workspace so a bad archive is recoverable.
  let staged;
  if (next.inputs.size) {
    const { openDatabase } = await import("./database.js");
    staged = await openDatabase({
      tractsFile: new File([next.base["tracts.parquet"]], "tracts.parquet"),
      tractDisplay: b,
    });
    try {
      for (const [name, input] of next.inputs)
        await staged.importFile(input, name);
    } catch (error) {
      await staged.close();
      throw error;
    }
  }
  const previous = databasePromise;
  cancelAnalysis();
  userGeometries.clear();
  base = b;
  neighborData = weights;
  baseBlobs = next.base;
  inputs = next.inputs;
  state = { ...defaults(), ...s };
  databasePromise = staged ? Promise.resolve(staged) : null;
  if (previous) previous.then((old) => old.close()).catch(() => {});
  bench.reset();
  renderAll();
  setView(state.view, true);
  if (s.camera) atlas.map.jumpTo(s.camera);
  notify("Project restored.");
}
function findFeature() {
  const page = node("dialog-content"),
    dlg = node("dialog"),
    items = records();
  page.innerHTML =
    '<div class="dialog-body"><h2>Find a feature</h2><label for="find-term">Name, county or feature ID</label><input id="find-term" type="search" autocomplete="off"><div id="find-results"></div></div>';
  function search() {
    const term = node("find-term").value.trim().toLowerCase();
    const matches = items
      .filter((f) =>
        [getID(f), f.properties.name, f.properties.county]
          .join(" ")
          .toLowerCase()
          .includes(term),
      )
      .slice(0, 12);
    node("find-results").innerHTML =
      matches
        .map(
          (f) =>
            '<button class="layer" data-find="' +
            e(getID(f)) +
            '"><span class="layer-text"><strong>' +
            e(f.properties.name || getID(f)) +
            "</strong><small>" +
            e([f.properties.county, getID(f)].filter(Boolean).join(" · ")) +
            "</small></span></button>",
        )
        .join("") || "<p>No matches.</p>";
    node("find-results")
      .querySelectorAll("button")
      .forEach(
        (b) =>
          (b.onclick = () => {
            dlg.close();
            selectFeature(b.dataset.find);
            atlas.fit({ features: [valueMap.get(b.dataset.find)] });
          }),
      );
  }
  node("find-term").oninput = search;
  search();
  dlg.showModal();
  node("find-term").focus();
}
async function start() {
  document
    .querySelectorAll("[data-icon]")
    .forEach((el) => (el.innerHTML = icon(el.dataset.icon)));
  const find = document.createElement("button");
  find.id = "find-feature";
  find.setAttribute("aria-label", "Find a feature");
  find.title = "Find a feature";
  find.innerHTML = icon("inspect");
  node("fit").after(find);
  find.onclick = findFeature;
  atlas = initMap((id) =>
    state.view === "compare"
      ? comparison.toggle(String(id))
      : selectFeature(id),
  );
  await Promise.all([
    atlas.ready,
    asset("tracts.geojson").then(async (blob) => {
      base = JSON.parse(await blob.text());
    }),
  ]);
  bench = createWorkbench({
    perform,
    state: () => state,
    db,
    inputs: () => inputs,
    setView,
    mapSQL,
    showBase: () => showLayer(MS),
  });
  comparison = comparisonWorkspace({
    atlas,
    state: () => state,
    layers: () => [
      { id: MS, name: "Mississippi tracts", collection: base },
      ...state.layers,
    ],
    fieldList,
    asset,
    status,
  });
  ready = true;
  renderAll();
  atlas.map.once("idle", () => {
    if (atlas.map.queryRenderedFeatures({ layers: ["areas"] }).length) {
      performance.mark("rumb-first-map");
      timings.firstMap = Math.round(performance.now());
    }
  });
  // For debugging in the console, the e2e checks and scripts/benchmark-browser.mjs.
  window.rumb = {
    version: __RUMB_VERSION__,
    timings,
    map: atlas.map,
    get state() {
      return state;
    },
    openDatabase: (options) =>
      import("./database.js").then((m) => m.openDatabase(options)),
  };
  for (const b of document.querySelectorAll("#nav button"))
    b.onclick = () => setView(b.dataset.view);
  for (const id of ["add-data", "import-data"])
    node(id).onclick = () => node("file-picker").click();
  node("file-picker").onchange = (event) => {
    const files = [...event.target.files];
    event.target.value = "";
    perform(null, () => importFiles(files));
  };
  node("open-project").onclick = () => node("project-picker").click();
  node("project-picker").onchange = (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    perform(node("open-project"), () => restore(file));
  };
  node("save-project").onclick = () =>
    perform(node("save-project"), saveProject);
  node("analyze").onclick = analyze;
  node("measure").onchange = (ev) => {
    clearResults();
    state.measure = ev.target.value;
    renderAll();
  };
  for (const [id, prop] of [
    ["classification", "classification"],
    ["class-count", "count"],
    ["rule", "rule"],
    ["study", "study"],
    ["permutations", "permutations"],
    ["seed", "seed"],
    ["fdr", "fdr"],
  ]) {
    node(id).onchange = (ev) => {
      if (!["classification", "count"].includes(prop)) clearResults();
      state[prop] =
        prop === "fdr"
          ? ev.target.checked
          : ["count", "permutations", "seed"].includes(prop)
            ? Number(ev.target.value)
            : ev.target.value;
      renderAll();
    };
  }
  node("zoom-in").onclick = () => atlas.map.zoomIn();
  node("zoom-out").onclick = () => atlas.map.zoomOut();
  node("fit").onclick = () =>
    atlas.fit(
      (state.view === "compare" && comparison.collection()) ||
        layer().collection,
    );
  node("export-map").onclick = () =>
    perform(node("export-map"), () =>
      state.view === "compare"
        ? comparison.image()
        : atlas.image(
            node("map-title").textContent,
            (state.mode === "cluster" ? "Local Moran clusters · " : "") +
              styleName(state.measure) +
              " · " +
              node("map-subtitle").textContent,
            legendItems(),
            (state.result && state.mode === "cluster"
              ? state.result.studyName +
                " · " +
                state.rule +
                " · " +
                (state.fdr ? "FDR q" : "p") +
                " ≤ 0.05 · "
              : "") + "U.S. Census Bureau · Natural Earth",
          ),
    );
  node("mobile-settings").onclick = () =>
    node("settings").classList.add("open");
  node("close-side").onclick = () => node("settings").classList.remove("open");
  document.addEventListener("dragover", (ev) => {
    if (ev.dataTransfer?.types.includes("Files")) ev.preventDefault();
  });
  document.addEventListener("drop", (ev) => {
    if (!ev.dataTransfer?.files.length) return;
    ev.preventDefault();
    const files = [...ev.dataTransfer.files];
    perform(null, () =>
      files.length === 1 && /\.(rumb|bgis)$/i.test(files[0].name)
        ? restore(files[0])
        : importFiles(files),
    );
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      node("settings").classList.remove("open");
    }
  });
}
start().catch((err) => {
  status("Map could not open");
  notify("Unable to open the map. " + err.message, true);
  console.error(err);
});
