// Gi* hot spots, General G and Geary's C against spdep (localG on
// include.self weights, globalG.test, geary.test), and the permutation
// p-values against exhaustive enumeration on a small chain.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { binOf, gearyC, generalG, hotSpots } from "../src/stats/hotspots.js";
import { prepareUniverse } from "../src/stats/stats.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const ref = read("./stats-reference.json");
const hs = ref.hotspots,
  w = ref.weights;
const close = (got, want, tol, what) =>
  assert.ok(Math.abs(got - want) <= tol * Math.max(1, Math.abs(want)), `${what}: ${got} vs ${want}`);

const tracts = read("../public/data/ms/tracts.geojson").features;
const values = Object.fromEntries(tracts.map(({ properties: p }) => [p.GEOID, p.poverty_pct]));
const graphs = read("../public/data/ms/neighbors.json");
const points = Object.fromEntries(w.ids.map((id, i) => [id, w.xy[i]]));
const centerValues = Object.fromEntries(w.ids.map((id, i) => [id, w.values[i]]));

test("Gi* z-scores match spdep::localG for contiguity and distance weights", async () => {
  const queen = await hotSpots({ values, neighbors: graphs.queen, weights: { kind: "queen" }, permutations: 9 });
  assert.equal(queen.n, hs.queen.ids.length);
  hs.queen.ids.forEach((id, i) => close(queen.byId[id].gi, hs.queen.gi[i], 1e-10, "queen " + id));
  for (const [name, weights] of [
    ["knn6", { kind: "knn", k: 6 }],
    ["connected", { kind: "band" }],
    ["idw1", { kind: "idw" }],
  ]) {
    const result = await hotSpots({ values: centerValues, points, weights, permutations: 9 });
    w.ids.forEach((id, i) => close(result.byId[id].gi, hs[name].gi[i], 1e-10, name + " " + id));
  }
});

test("General G and Geary's C match spdep's randomization moments", () => {
  for (const [name, input] of [
    ["queen", { values, neighbors: graphs.queen, weights: { kind: "queen" } }],
    ["knn6", { values: centerValues, points, weights: { kind: "knn", k: 6 } }],
  ]) {
    const { ids, byId, rows, w: weights } = prepareUniverse(input);
    const x = ids.map((id) => byId[id].value);
    const G = generalG(x, rows, weights);
    close(G.G, hs[name].generalG.G, 1e-12, name + " G");
    close(G.expected, hs[name].generalG.expected, 1e-12, name + " E[G]");
    close(G.variance, hs[name].generalG.variance, 1e-9, name + " Var[G]");
    const C = gearyC(x, rows, weights);
    close(C.C, hs[name].geary.C, 1e-12, name + " C");
    close(C.variance, hs[name].geary.variance, 1e-9, name + " Var[C]");
  }
});

test("bins follow confidence levels, and FDR uses q", async () => {
  assert.equal(binOf(3, 0.002), "H99");
  assert.equal(binOf(2.1, 0.04), "H95");
  assert.equal(binOf(-1.7, 0.09), "C90");
  assert.equal(binOf(-1.2, 0.23), "NS");
  assert.equal(binOf(0, 0), "NS");
  const result = await hotSpots({ values, neighbors: graphs.queen, weights: { kind: "queen" }, fdr: true, permutations: 9 });
  const records = Object.values(result.byId).filter((r) => !r.reason);
  assert.ok(records.every((r) => r.cluster === binOf(r.gi, r.q)));
  assert.ok(records.some((r) => r.cluster === "H99") && records.some((r) => r.cluster.startsWith("C")));
  assert.ok(result.generalG && result.geary && result.generalG.p > 0 && result.geary.p > 0);
});

test("permutation p-values approach the exact conditional null", async () => {
  // A six-area chain; each area's neighbors are drawn from the other five values.
  const x = { a: 1, b: 2, c: 5, d: 9, e: 1, f: 0 };
  const chain = { a: ["b"], b: ["a", "c"], c: ["b", "d"], d: ["c", "e"], e: ["d", "f"], f: ["e"] };
  const result = await hotSpots({ values: x, neighbors: chain, inference: "permutation", permutations: 9999, seed: 7 });
  const ids = Object.keys(x),
    vals = ids.map((id) => x[id]),
    total = vals.reduce((s, v) => s + v, 0);
  const subsets = (arr, k) =>
    k === 0 ? [[]] : arr.flatMap((v, i) => subsets(arr.slice(i + 1), k - 1).map((rest) => [v, ...rest]));
  ids.forEach((id, i) => {
    const k = chain[id].length,
      others = vals.filter((_, j) => j !== i);
    const observed = vals[i] + chain[id].reduce((s, n) => s + x[n], 0);
    const expected = vals[i] + (k * (total - vals[i])) / (ids.length - 1);
    const all = subsets(others, k).map((sub) => vals[i] + sub.reduce((s, v) => s + v, 0));
    const exact = all.filter((sum) => Math.abs(sum - expected) >= Math.abs(observed - expected) - 1e-12).length / all.length;
    close(result.byId[id].p, exact, 0.02, "chain " + id);
  });
});
