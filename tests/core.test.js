import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { createStore } from "../src/core/store.js";
import { defaults, normalizeState, LAYER_VIEW_KEYS } from "../src/core/state.js";
import { featureId, groups, numericFields } from "../src/core/features.js";
import { classify, classOf, ramp, palettes } from "../src/map/classify.js";
import { csvCell, csvText } from "../src/data/csv.js";
import { ident, sqlString } from "../src/data/sql.js";
import {
  fieldLabel,
  fieldInfo,
  starterSQL,
  validateCatalog,
  validateLibrary,
  referenceLayer,
  layerMeta,
} from "../src/catalog/catalog.js";
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

test("the layer library matches the files it describes", () => {
  const library = read("../public/data/ms/" + catalog.library);
  validateLibrary(library, catalog);
  const size = (p) => statSync(new URL("../public/data/ms/" + p, import.meta.url)).size;
  // The catalog is read before the first map; the library only when needed.
  assert.ok(size("catalog.json") <= 40 * 1024, "catalog.json stays small");
  assert.ok(size(catalog.library) <= 100 * 1024, "library.json stays small");
  assert.equal(catalog.layers.length, 1, "add-on layers live in the library, not the catalog");
  const [west, south, east, north] = catalog.region.bounds.flat();
  const types = { point: ["Point"], polygon: ["Polygon", "MultiPolygon"], line: ["LineString", "MultiLineString"] };
  for (const layer of library.layers) {
    assert.ok(library.groups.includes(layer.group), layer.id);
    assert.ok(layer.file.startsWith("layers/"), layer.id);
    const text = readFileSync(new URL("../public/data/ms/" + layer.file, import.meta.url));
    const sha = (buf) => createHash("sha256").update(buf).digest("hex");
    const file = layer.file.slice("layers/".length);
    assert.equal(sha(text), layer.source.output[file], layer.id + " output checksum");
    const geo = JSON.parse(text);
    assert.equal(geo.features.length, layer.count, layer.id);
    const ids = new Set(geo.features.map((f) => String(f.id)));
    assert.equal(ids.size, layer.count, layer.id + " ids are unique");
    assert.ok(geo.features.every((f) => types[layer.geometry].includes(f.geometry?.type)), layer.id);
    const keys = new Set(geo.features.flatMap((f) => Object.keys(f.properties)));
    for (const field of Object.keys(layer.fields)) assert.ok(keys.has(field), layer.id + "." + field);
    for (const field of layer.measures)
      assert.ok(geo.features.some((f) => Number.isFinite(f.properties[field])), layer.id + "." + field);
    for (const info of Object.values(layer.fields))
      for (const key of ["numerator", "denominator", "flag"])
        if (info.pool?.[key]) assert.ok(keys.has(info.pool[key]), layer.id + " pool " + info.pool[key]);
    const [x0, y0, x1, y1] = layer.bbox;
    assert.ok(x0 >= west - 0.5 && y0 >= south - 0.5 && x1 <= east + 0.5 && y1 <= north + 0.5, layer.id + " bbox");
    if (layer.geometry === "polygon") {
      assert.ok(layer.neighbors, layer.id + " neighbors");
      const graph = read("../public/data/ms/" + layer.neighbors);
      for (const rule of ["queen", "rook"])
        assert.deepEqual(new Set(Object.keys(graph[rule])), ids, layer.id + " " + rule);
    }
    assert.equal(layerMeta(catalog, library, layer.id), layer);
  }
  assert.equal(layerMeta(catalog, library, "tracts"), referenceLayer(catalog));
  const chr = layerMeta(catalog, library, "chr_counties_2025");
  assert.equal(chr.count, 82);
  assert.equal(fieldInfo(catalog, "v085_rawvalue", chr).unit, "%");
  assert.equal(fieldLabel(catalog, "v085_rawvalue", chr), "Uninsured");
  assert.equal(fieldInfo(catalog, "poverty_pct").label, "Population below poverty");
  assert.throws(() => validateLibrary({ layers: [{ id: "tracts", name: "x", geometry: "point", file: "f" }] }, catalog));
  assert.throws(() => validateLibrary({ layers: [{ id: "a", name: "A", geometry: "blob", file: "f" }] }));
});

test("the layer stack keeps order, visibility and its focus layer", async () => {
  const { withLayer, withoutLayer, moveLayer, setVisible, normalizeStack, drawnIds, stackEntry } = await import(
    "../src/core/stack.js"
  );
  let stack = [stackEntry("tracts")];
  stack = withLayer(withLayer(stack, "fire"), "chr");
  assert.deepEqual(drawnIds(stack), ["tracts", "fire", "chr"]);
  assert.equal(withLayer(stack, "fire"), stack);
  stack = moveLayer(stack, "chr", -1);
  assert.deepEqual(drawnIds(stack), ["tracts", "chr", "fire"]);
  assert.equal(moveLayer(stack, "tracts", -1), stack);
  stack = setVisible(stack, "chr", false);
  assert.deepEqual(drawnIds(stack), ["tracts", "fire"]);
  assert.deepEqual(drawnIds(withoutLayer(stack, "fire")), ["tracts"]);
  // Saved stacks: duplicates and unknown layers go; the focus is always shown.
  const saved = [{ id: "a", visible: false }, "b", { id: "a" }, { id: "gone" }, { nope: 1 }];
  const fixed = normalizeStack(saved, "a", (id) => id !== "gone");
  assert.deepEqual(fixed, [{ id: "a", visible: true }, { id: "b", visible: true }]);
  assert.deepEqual(normalizeStack(undefined, "tracts"), [{ id: "tracts", visible: true }]);
  // Projects saved before stacking draw just their active layer.
  const old = normalizeState({ active: "q", layers: [{ id: "q", name: "Q", collection: { features: [] } }] }, catalog);
  assert.deepEqual(old.stack, [{ id: "q", visible: true }]);
  assert.deepEqual(normalizeState({}, catalog).stack, [{ id: "tracts", visible: true }]);
});

test("map layers for a stacked layer, by kind and band", async () => {
  const { layerSpecs, kindOf, orderMapLayers, sourceId } = await import("../src/map/layer-specs.js");
  const colors = { outline: "#000", pointStroke: "#fff" };
  const ids = (kind) => layerSpecs("x", kind, colors).map((s) => [s.id, s.band, s.interactive]);
  assert.deepEqual(ids("polygon"), [["lyr-x-fill", "area", true], ["lyr-x-outline", "area", false]]);
  assert.deepEqual(ids("point"), [["lyr-x-point", "point", true]]);
  assert.deepEqual(ids("line"), [["lyr-x-line", "area", true]]);
  assert.equal(ids("mixed").length, 4);
  assert.ok(layerSpecs("x", "mixed", colors).every((s) => s.spec.filter && s.spec.source === sourceId("x")));
  assert.ok(layerSpecs("x", "polygon", colors).every((s) => !s.spec.filter));
  const fill = layerSpecs("x", "polygon", colors, { fillOpacity: 0.5 })[0].spec.paint;
  // Opacity fades for features a filter leaves out; the last value is the normal one.
  assert.equal(fill["fill-opacity"].at(-1), 0.5);
  assert.equal(layerSpecs("x", "point", colors)[0].spec.paint["circle-stroke-color"], "#fff");
  const g = (type) => ({ geometry: { type } });
  assert.equal(kindOf([g("Polygon"), g("MultiPolygon")]), "polygon");
  assert.equal(kindOf([g("Point")]), "point");
  assert.equal(kindOf([g("Point"), g("Polygon")]), "mixed");
  assert.equal(kindOf([]), "mixed");
  const specs = { a: layerSpecs("a", "polygon", colors), b: layerSpecs("b", "point", colors), c: layerSpecs("c", "polygon", colors) };
  // Points draw above every polygon; polygons follow the stack.
  assert.deepEqual(orderMapLayers(["a", "b", "c"], (id) => specs[id]), [
    "lyr-a-fill", "lyr-a-outline", "lyr-c-fill", "lyr-c-outline", "lyr-b-point",
  ]);
});

test("popups list a layer's catalog fields, formatted", async () => {
  const { popupRows, formatValue, featureTitle } = await import("../src/catalog/popup.js");
  const meta = {
    labelField: "name",
    popupFields: ["name", "rate", "income", "beds", "site", "phone", "empty"],
    fields: {
      name: { label: "Name" },
      rate: { label: "Uninsured", format: "percent", unit: "%" },
      income: { label: "Income", format: "currency" },
      beds: { label: "Beds", format: "integer" },
      site: { label: "Website", format: "url" },
      phone: { label: "Phone", format: "phone" },
      empty: { label: "Empty" },
    },
  };
  const props = { name: "A", rate: 15.4056, income: 44385, beds: 120, site: "http://x.org", phone: "(601) 555-1234", empty: null };
  const rows = popupRows(meta, props, { skip: ["name"] });
  assert.deepEqual(
    rows.map((r) => [r.label, r.text, r.href]),
    [
      ["Uninsured", "15.4%", null],
      ["Income", "$44,385", null],
      ["Beds", "120", null],
      ["Website", "http://x.org", "http://x.org"],
      ["Phone", "(601) 555-1234", "tel:6015551234"],
    ],
  );
  // Layers without popup fields list their first fields, skipping bookkeeping.
  assert.deepEqual(
    popupRows(null, { __rumb_id: "1", a_b: 2, c: "x" }).map((r) => r.label),
    ["a b", "c"],
  );
  assert.equal(formatValue(NaN), null);
  assert.equal(featureTitle({ NAME: "B" }, "7", "name"), "B");
  assert.equal(featureTitle({}, "7", "name"), "Feature 7");
});

test("category colors and the fields that can carry them", async () => {
  const { categories, categoryFields, OTHER_COLOR, QUALITATIVE } = await import("../src/map/classify.js");
  const c = categories(["b", "a", "b", "c", null, "b", "a"]);
  assert.deepEqual(c.items.map((x) => [x.value, x.count]), [["b", 3], ["a", 2], ["c", 1]]);
  assert.equal(c.colorOf("b"), QUALITATIVE[0]);
  assert.equal(c.colorOf(null), null);
  const many = categories("abcdefghij".split(""));
  assert.equal(many.items.length, 8);
  assert.deepEqual(many.items.at(-1), { value: "Other", color: OTHER_COLOR, count: 3, other: true });
  assert.equal(many.colorOf("j"), OTHER_COLOR);
  const features = [
    { properties: { type: "x", name: "1", n: 1 } },
    { properties: { type: "y", name: "2", n: 2 } },
    { properties: { type: "x", name: "3", n: 3 } },
  ];
  assert.deepEqual(categoryFields(features, 2), ["type"]);
});

test("point shapes are distance fields centred in their image", async () => {
  const { shapeDistance, shapeImage, SHAPES, SIZE } = await import("../src/map/shapes.js");
  for (const shape of SHAPES) {
    assert.ok(shapeDistance(shape, 0, 0) < 0, shape + " centre is inside");
    for (const [x, y] of [[11, 0], [-11, 0], [0, 11], [0, -11]])
      assert.ok(shapeDistance(shape, x, y) > 0, `${shape} (${x}, ${y}) is outside`);
    const img = shapeImage(shape);
    assert.equal(img.data.length, (SIZE * 2) ** 2 * 4);
    const alpha = (col, row) => img.data[(row * SIZE * 2 + col) * 4 + 3];
    assert.ok(alpha(SIZE, SIZE) > 191 && alpha(0, 0) < 191, shape);
  }
});

test("a layer's look becomes MapLibre paint, shapes and labels", async () => {
  const { entryStyle, layerSpecs, specShape } = await import("../src/map/layer-specs.js");
  const colors = { outline: "#000", pointStroke: "#fff", label: "#ccc", halo: "#111" };
  const entry = { id: "x", style: { opacity: 0.5, size: 9, shape: "triangle", outline: 2 }, label: "name" };
  const points = layerSpecs("x", "point", colors, entryStyle(entry, "point"));
  assert.deepEqual(points.map((s) => s.id + ":" + s.spec.type), ["lyr-x-shape:symbol", "lyr-x-label:symbol"]);
  assert.equal(points[0].spec.layout["icon-size"], 9 / 8);
  assert.equal(points[0].spec.paint["icon-opacity"].at(-1), 0.5);
  assert.equal(points[1].band, "label");
  const areas = layerSpecs("x", "polygon", colors, entryStyle(entry, "polygon"));
  assert.equal(areas[0].spec.paint["fill-opacity"].at(-1), 0.5);
  assert.equal(areas[1].spec.paint["line-width"], 2);
  // Changing only a number keeps the layers; a shape or label rebuilds them.
  const plain = layerSpecs("x", "point", colors, entryStyle({ style: { size: 4 } }, "point"));
  assert.equal(specShape(plain), specShape(layerSpecs("x", "point", colors)));
  assert.notEqual(specShape(plain), specShape(points));
});
