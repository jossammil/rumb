import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createStore } from "../src/core/store.js";
import { defaults, normalizeState, LAYER_VIEW_KEYS } from "../src/core/state.js";
import { featureId, groups, numericFields } from "../src/core/features.js";
import { classify, classOf, ramp, palettes } from "../src/map/classify.js";
import { csvCell, csvText } from "../src/data/csv.js";
import { ident, sqlString } from "../src/data/sql.js";
import { fieldLabel, starterSQL, validateCatalog, referenceLayer } from "../src/catalog/catalog.js";
import { findFeatures } from "../src/panels/find.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const catalog = read("../public/data/ms/catalog.json");

test("the store merges patches and reports only keys that changed", () => {
  const store = createStore({ view: "map", count: 5 });
  const heard = [];
  store.subscribe((_, keys) => heard.push([...keys]));
  store.set({ view: "map", count: 6 });
  store.set({ view: "map" });
  store.touch("comparisons");
  store.replace({ view: "sql" });
  assert.deepEqual(heard, [["count"], ["comparisons"], ["view"]]);
  assert.equal(store.state.view, "sql");
});

test("saved states from Field Atlas projects come up to date", () => {
  const legacy = {
    measure: "child_poverty_pct",
    camera: { zoom: 7 },
    mapCamera: { zoom: 8 },
    layers: [{ id: "q", name: "Q", collection: { features: [] }, tracts: true, baseMeasures: false }],
  };
  const state = normalizeState(legacy, catalog);
  assert.equal(state.measure, "child_poverty_pct");
  assert.equal(state.camera, undefined);
  assert.equal(state.mapCamera, undefined);
  assert.equal(state.layers[0].reference, true);
  assert.equal(state.layers[0].referenceFields, false);
  assert.equal("tracts" in state.layers[0], false);
  assert.equal(state.palette, "Lagoon");
  for (const key of LAYER_VIEW_KEYS) assert.ok(key in defaults(catalog), key);
});

test("class breaks, class lookup and palette ramps", () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, NaN, null];
  const q = classify(values, 5, "quantile");
  assert.deepEqual(q, [2.8, 4.6, 6.4, 8.2]);
  assert.deepEqual(classify(values, 4, "equal"), [3.25, 5.5, 7.75]);
  assert.deepEqual(classify([3, 3, 3], 5, "quantile"), []);
  assert.deepEqual([1, 2.8, 5, 10].map((v) => classOf(v, q)), [0, 1, 2, 4]);
  for (const name of Object.keys(palettes)) {
    assert.equal(palettes[name].length, 7, name);
    assert.equal(ramp(name, 3).length, 3);
  }
  assert.deepEqual(ramp("Lagoon", 2), [palettes.Lagoon[0], palettes.Lagoon[6]]);
});

test("CSV and SQL quoting", () => {
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell(null), "");
  assert.equal(csvText([["a", "b"], [1, "x\ny"]]), 'a,b\r\n1,"x\ny"');
  assert.equal(sqlString("O'Brien"), "'O''Brien'");
  assert.equal(ident('my "col"'), '"my ""col"""');
});

test("feature helpers", () => {
  const features = [
    { id: 7, properties: { a: 1, b: "x", county: "Hinds" } },
    { properties: { GEOID: "28", a: 2, c: Infinity, __rumb_color: 3, county: "Adams" } },
  ];
  assert.deepEqual(features.map(featureId), ["7", "28"]);
  assert.deepEqual(numericFields(features), ["a"]);
  assert.deepEqual(groups(features, "county"), ["Adams", "Hinds"]);
  assert.deepEqual(groups(features, null), []);
});

test("the Mississippi catalog matches the data files it describes", () => {
  validateCatalog(catalog);
  const ref = referenceLayer(catalog);
  const index = read("../public/data/index.json");
  assert.ok(index.regions.some((r) => r.id === catalog.region.id));
  const display = read("../public/data/ms/" + ref.files.display);
  assert.equal(display.features.length, 878);
  const props = display.features[0].properties;
  for (const field of [ref.idField, ref.labelField, ref.groupField, ...ref.measures])
    assert.ok(field in props, field);
  for (const [field, info] of Object.entries(ref.fields)) {
    assert.ok(field in props, field);
    for (const key of ["moe", "count", "universe"]) if (info[key]) assert.ok(info[key] in props, info[key]);
  }
  const ids = new Set(display.features.map((f) => String(f.properties[ref.idField])));
  assert.equal(ids.size, 878);
  const neighbors = read("../public/data/ms/" + ref.files.neighbors);
  assert.ok(Object.keys(neighbors.queen).every((id) => ids.has(id)));
  const places = read("../public/data/ms/" + ref.compare.reference);
  for (const field of ref.compare.lead)
    assert.ok(ref.measures.includes(field) || field in places.measures, field);
  assert.equal(fieldLabel(catalog, "poverty_pct"), "Population below poverty");
  assert.equal(fieldLabel(catalog, "service_rate"), "service rate");
  assert.equal(
    starterSQL(ref),
    "SELECT GEOID, name, county, poverty_pct\nFROM tracts\nORDER BY poverty_pct DESC NULLS LAST",
  );
});

test("finding features by name, group or ID", () => {
  const features = read("../public/data/ms/tracts.geojson").features;
  const ref = referenceLayer(catalog);
  assert.equal(findFeatures(features, "28001000101", ref)[0].properties.GEOID, "28001000101");
  assert.ok(findFeatures(features, "adams county", ref).length > 1);
  assert.equal(findFeatures(features, "zzz", ref).length, 0);
  assert.equal(findFeatures(features, "", ref).length, 12);
});
