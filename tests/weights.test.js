// Distance weights and Moran's I on them, against spdep on the same projected
// tract centers of population (tests/stats-reference.json from
// scripts/reference-stats.R), plus polygon centroids against GEOS.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transverseMercator } from "../src/geo/project.js";
import { mapGeometry } from "../src/geo/spatial.js";
import {
  band,
  centroid,
  connectingBand,
  describeWeights,
  distanceWeights,
  graphKey,
  knn,
  summaryText,
  symmetrize,
  weightsSpec,
  weightsSummary,
} from "../src/stats/neighbors.js";
import { analyze } from "../src/stats/stats.js";
import { modelSpec } from "../src/core/derived.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const ref = read("./stats-reference.json");
const w = ref.weights;
const catalog = read("../public/data/ms/catalog.json");
const projection = transverseMercator(catalog.region.projection.tmerc);
const sorted = (rows) => rows.map((r) => [...r].sort((a, b) => a - b));

test("nearest neighbors and distance bands match spdep exactly", () => {
  assert.deepEqual(sorted(knn(w.xy, 6)), w.knn6);
  assert.deepEqual(symmetrize(knn(w.xy, 6)), w.knn6sym);
  const threshold = connectingBand(w.xy);
  assert.ok(Math.abs(threshold / w.threshold - 1) < 1e-12, threshold + " vs " + w.threshold);
  assert.deepEqual(band(w.xy, threshold), w.connected);
  assert.deepEqual(
    band(w.xy, 25 * 1609.344).map((r) => r.length),
    w.band25cards,
  );
  const built = distanceWeights({ kind: "idw", power: 2 }, w.xy);
  assert.equal(built.rows.length, w.ids.length);
  assert.ok(built.w.every((row, i) => row.length === built.rows[i].length && row.every((x) => x > 0)));
});

test("Moran's I on distance weights matches spdep for every kind", async () => {
  const values = Object.fromEntries(w.ids.map((id, i) => [id, w.values[i]]));
  const points = Object.fromEntries(w.ids.map((id, i) => [id, w.xy[i]]));
  const cases = {
    knn6: { kind: "knn", k: 6 },
    knn6sym: { kind: "knn", k: 6, symmetric: true },
    connected: { kind: "band" },
    band25: { kind: "band", miles: 25 },
    idw1: { kind: "idw" },
    idw2: { kind: "idw", power: 2 },
    idw25: { kind: "idw", miles: 25 },
  };
  for (const [name, weights] of Object.entries(cases)) {
    const result = await analyze({ values, points, weights, permutations: 9 });
    assert.equal(result.n, w.ids.length, name);
    assert.ok(Math.abs(result.globalI - w.moran[name]) < 1e-10, `${name}: ${result.globalI} vs ${w.moran[name]}`);
    // Local statistics are z times the weighted mean of the neighbors' z.
    const first = result.byId[w.ids[0]];
    assert.ok(Math.abs(first.localI - first.z * first.lag) < 1e-12, name);
  }
});

test("contiguity results stay bit-identical", async () => {
  const data = (name) => read("../public/data/ms/" + name);
  const display = data("tracts.geojson"),
    graphs = data("neighbors.json");
  const values = Object.fromEntries(display.features.map(({ properties: p }) => [p.GEOID, p.poverty_pct]));
  const pinned = { queen: 0.27677627221266465, rook: 0.28457241216772966 };
  for (const rule of ["queen", "rook"]) {
    const result = await analyze({ values, neighbors: graphs[rule], weights: { kind: rule }, permutations: 19 });
    assert.equal(result.globalI, pinned[rule], rule);
    assert.equal(result.weights.label, rule === "queen" ? "Shared edge or corner (queen)" : "Shared edge only (rook)");
  }
});

test("projected centers agree with PROJ, and centroids with GEOS", () => {
  const centers = read("../public/data/ms/tables/tracts-centers.json");
  const at = new Map(centers.ids.map((id, i) => [id, [centers.lon[i], centers.lat[i]]]));
  w.ids.forEach((id, i) => {
    const [x, y] = projection.forward(at.get(id));
    assert.ok(Math.hypot(x - w.xy[i][0], y - w.xy[i][1]) < 1e-3, id);
  });
  for (const [file, expected] of [
    ["layers/chr_counties_2025.geojson", ref.centroids.counties],
    ["tracts.geojson", ref.centroids.tracts],
  ]) {
    const features = read("../public/data/ms/" + file).features;
    expected.forEach(([x, y], i) => {
      const [cx, cy] = centroid(mapGeometry(features[i].geometry, projection.forward));
      assert.ok(Math.hypot(cx - x, cy - y) < 2e-3, file + " " + i + ": " + [cx, cy] + " vs " + [x, y]);
    });
  }
  assert.deepEqual(centroid({ type: "MultiPoint", coordinates: [[0, 0], [2, 4]] }), [1, 2]);
  // A square with a square hole off-centre pulls the centroid away from the hole.
  const holed = centroid({
    type: "Polygon",
    coordinates: [
      [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
      [[2, 2], [3, 2], [3, 3], [2, 3], [2, 2]],
    ],
  });
  assert.ok(Math.abs(holed[0] - (16 * 2 - 1 * 2.5) / 15) < 1e-12 && Math.abs(holed[1] - holed[0]) < 1e-12);
});

test("weights specs are made safe and described", () => {
  assert.deepEqual(weightsSpec({ kind: "knn", k: 99, miles: -1, power: 3 }), {
    kind: "knn",
    k: 30,
    miles: null,
    power: 1,
    symmetric: false,
    land: false,
  });
  assert.equal(weightsSpec({ kind: "nope" }).kind, "queen");
  // Leaving out links across water applies to contiguity only.
  assert.equal(weightsSpec({ kind: "rook", land: true }).land, true);
  assert.equal(weightsSpec({ kind: "knn", land: true }).land, false);
  assert.equal(graphKey({ kind: "queen", land: true }), "queenShore");
  assert.equal(graphKey({ kind: "rook" }), "rook");
  assert.equal(graphKey({ kind: "band", land: true }), "band");
  assert.equal(describeWeights({ kind: "queen", land: true }), "Shared edge or corner (queen), not across water");
  assert.equal(describeWeights({ kind: "rook" }), "Shared edge only (rook)");
  assert.equal(describeWeights({ kind: "knn", k: 6, symmetric: true }), "6 nearest neighbors, made symmetric");
  assert.equal(describeWeights({ kind: "band" }, 1609.344 * 14.75), "Every area within 14.8 mi");
  assert.equal(describeWeights({ kind: "idw", power: 2, miles: 25 }), "Inverse distance squared, within 25.0 mi");
  const summary = weightsSummary([[1], [0, 2], [1], []]);
  assert.deepEqual(summary, { n: 4, min: 0, mean: 1, max: 2, islands: 1, histogram: [[0, 1], [1, 2], [2, 1]] });
  assert.equal(summaryText(summary), "0–2 neighbors, 1.0 on average · 1 without neighbors");
  assert.equal(summaryText(weightsSummary([[1], [0]])), "1 neighbor each · no islands");
});

test("a model spec keeps land only when it is set, so older specs stay the same", () => {
  const base = { kind: "model", type: "lag", y: "poverty_pct", xs: ["acs_bachelors_pct"] };
  assert.deepEqual(modelSpec({ ...base, weights: { kind: "queen" } }).weights, { kind: "queen", k: 6, miles: null, power: 1, symmetric: false });
  assert.equal(modelSpec({ ...base, weights: { kind: "queen", land: true } }).weights.land, true);
  assert.equal(modelSpec({ ...base, weights: { kind: "knn", land: true } }).weights.land, undefined);
});
