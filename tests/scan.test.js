// Kulldorff's spatial scan against smerc::scan.test: the same windows,
// members and log-likelihood ratios, with p-values within Monte Carlo error.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { llr, scan, scanAreas, windows } from "../src/stats/scan.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const reference = read("./stats-reference.json");
const ref = reference.scan;
const sorted = (a) => [...a].sort();

test("clusters of drug overdose deaths by county match smerc", () => {
  const c = ref.chr;
  const result = scan({ ids: c.ids, cases: c.cases, population: c.population, points: c.xy, maxPop: 0.5, alpha: 1, clusters: 5 });
  assert.equal(result.clusters.length, c.clusters.length);
  result.clusters.forEach((k, i) => {
    const want = c.clusters[i];
    assert.deepEqual(sorted(k.members), sorted(want.members), "members " + (i + 1));
    assert.ok(Math.abs(k.llr - want.llr) < 1e-9 * Math.max(1, want.llr), `LLR ${k.llr} vs ${want.llr}`);
    assert.ok(Math.abs(k.expected - want.expected) < 1e-9 * want.expected, "expected " + (i + 1));
    assert.equal(k.cases, want.cases);
    // Both sides draw 999 replicates; p differs only by Monte Carlo error.
    const se = Math.sqrt((want.p * (1 - want.p)) / 999);
    assert.ok(Math.abs(k.p - want.p) <= 4 * se + 0.01, `p ${k.p} vs ${want.p}`);
  });
  assert.equal(result.clusters[0].p, 0.001, "the most likely cluster beats every replicate");
});

test("tract poverty windows up to 10% of the population match smerc", () => {
  const w = reference.weights;
  const tracts = new Map(read("../public/data/ms/tracts.geojson").features.map((f) => [f.properties.GEOID, f.properties]));
  const at = new Map(w.ids.map((id, i) => [id, w.xy[i]]));
  const ids = ref.tracts.ids;
  const result = scan({
    ids,
    cases: ids.map((id) => tracts.get(id).poverty_count),
    population: ids.map((id) => tracts.get(id).poverty_universe),
    points: ids.map((id) => at.get(id)),
    maxPop: 0.1,
    replicates: 99,
    alpha: 1,
    clusters: 3,
  });
  result.clusters.forEach((k, i) => {
    assert.deepEqual(sorted(k.members), sorted(ref.tracts.clusters[i].members), "members " + (i + 1));
    assert.ok(Math.abs(k.llr - ref.tracts.clusters[i].llr) < 1e-9 * ref.tracts.clusters[i].llr, "LLR " + (i + 1));
  });
});

test("the likelihood ratio, windows and directions behave", () => {
  assert.equal(llr(5, 5, 100), 0);
  assert.equal(llr(2, 5, 100, "high"), 0, "a deficit is not a high-rate cluster");
  assert.ok(llr(2, 5, 100, "low") > 0 && llr(2, 5, 100, "both") === llr(2, 5, 100, "low"));
  assert.ok(Math.abs(llr(10, 4, 100) - (10 * Math.log(10 / 4) + 90 * Math.log(90 / 96))) < 1e-12);
  // Four points on a line with equal populations: half the population is two areas.
  const z = windows([[0, 0], [1, 0], [3, 0], [6, 0]], [1, 1, 1, 1], { maxPop: 0.5 });
  assert.deepEqual(Array.from(z.order.slice(z.starts[0], z.starts[1])), [0, 1]);
  assert.deepEqual(Array.from(z.order.slice(z.starts[3], z.starts[4])), [3, 2]);
  const capped = windows([[0, 0], [1, 0], [3, 0], [6, 0]], [1, 1, 1, 1], { maxPop: 0.5, maxMetres: 1.5 });
  assert.deepEqual(Array.from(capped.order.slice(capped.starts[3], capped.starts[4])), [3]);
});

test("areas without counts, population or location stay out and say why", () => {
  const result = scanAreas({
    cases: { a: 30, b: 2, c: 3, d: null, e: 4, f: 1 },
    population: { a: 1000, b: 1000, c: 1000, d: null, e: 0, f: 1000 },
    points: { a: [0, 0], b: [1000, 0], c: [2000, 0], d: [3000, 0], e: [4000, 0] },
    permutations: 99,
    maxPop: 0.5,
  });
  assert.equal(result.byId.d.reason, "Missing count");
  assert.equal(result.byId.e.reason, "No population");
  assert.equal(result.byId.f.reason, "No location");
  assert.equal(result.missing, 1);
  assert.equal(result.n, 3);
  assert.equal(result.byId.a.cluster, "K1");
  assert.ok(Math.abs(result.byId.a.expected - 35 / 3) < 1e-12);
});
