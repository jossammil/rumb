// The map's spatial filters against GEOS (sf) on the same display files:
// radius, buffer and polygon filters on points and polygons, in EPSG:3814.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyFilter, describeFilter, normalizeFilter, projectedIndex } from "../src/geo/filter.js";
import { transverseMercator } from "../src/geo/project.js";
import { geometryDistance, pointDistance, pointInPolygon } from "../src/geo/spatial.js";
import { mapGeometry } from "../src/geo/spatial.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const ref = read("./filter-reference.json");
const catalog = read("../public/data/ms/catalog.json");
const projection = transverseMercator(catalog.region.projection.tmerc);
const idOf = (f) => String(f.id);
const layer = (path) => read("../public/data/ms/" + path);
const stations = layer("layers/fire_stations_2020.geojson");
const tracts = layer("tracts.geojson");
const counties = layer("layers/chr_counties_2025.geojson");
const kept = (filter, collection, context = {}) =>
  [...applyFilter(filter, projectedIndex(collection, projection, idOf), { projection, ...context }).keys()].sort();

test("radius filters match GEOS for points and polygons", () => {
  const radius = (miles) => ({ kind: "radius", center: ref.center, miles });
  assert.deepEqual(kept(radius(25), stations), ref.stations25);
  assert.deepEqual(kept(radius(50), stations), ref.stations50);
  assert.deepEqual(kept(radius(10), tracts), ref.tracts10);
  // Distances come back in miles.
  const near = applyFilter(radius(25), projectedIndex(stations, projection, idOf), { projection });
  assert.ok([...near.values()].every((d) => d >= 0 && d <= 25));
});

test("polygon and buffer filters match GEOS", () => {
  const polygon = { kind: "polygon", ring: ref.ring };
  assert.deepEqual(kept(polygon, counties), ref.countiesInArea);
  assert.deepEqual(kept(polygon, stations), ref.stationsInArea);
  const hinds = counties.features.find((f) => f.id === "28049");
  const base = [mapGeometry(hinds.geometry, projection.forward)];
  assert.deepEqual(kept({ kind: "buffer", layer: "chr_counties_2025", ids: ["28049"], miles: 5 }, stations, { base }), ref.stationsNearHinds);
});

test("the selected areas widen a radius filter (map_pdo's rule)", () => {
  const hinds = counties.features.find((f) => f.id === "28049");
  const selectedAreas = [mapGeometry(hinds.geometry, projection.forward)];
  const tiny = { kind: "radius", center: [-88.6, 34.25], miles: 1, orSelection: true };
  const ids = kept(tiny, stations, { selectedAreas });
  const inHinds = stations.features.filter((f) =>
    pointInPolygon(projection.forward(f.geometry.coordinates), selectedAreas[0].coordinates[0] ? selectedAreas[0].coordinates : []),
  );
  assert.ok(ids.length >= inHinds.length && inHinds.length > 10);
});

test("plane geometry and filter checks", () => {
  const square = { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] };
  assert.equal(pointDistance([5, 5], square), 0);
  assert.equal(pointDistance([13, 14], square), 5);
  assert.equal(geometryDistance(square, { type: "Point", coordinates: [20, 5] }), 10);
  assert.equal(geometryDistance(square, { type: "LineString", coordinates: [[-5, 5], [15, 5]] }), 0);
  assert.equal(normalizeFilter({ kind: "radius", center: [-90, 32], miles: "25" }).miles, 25);
  assert.equal(normalizeFilter({ kind: "radius", center: [-90, 132], miles: 25 }), null);
  assert.equal(normalizeFilter({ kind: "polygon", ring: [[0, 0], [1, 1]] }), null);
  assert.equal(normalizeFilter({ kind: "buffer", layer: "x", ids: [], miles: 2 }), null);
  assert.equal(normalizeFilter({ kind: "nope" }), null);
  assert.equal(describeFilter({ kind: "radius", center: [-90.18, 32.3], miles: 25 }), "Within 25 mi of -90.18, 32.3");
});
