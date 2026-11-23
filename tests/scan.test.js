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

test("windows match a comparison sort on (distance, index), ties included", () => {
  // Points on a coarse grid, so many distances tie.
  let s = 7;
  const random = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const xy = Array.from({ length: 300 }, () => [Math.floor(random() * 12) * 1000, Math.floor(random() * 12) * 1000]);
  const population = xy.map(() => 1 + Math.floor(random() * 50));
  const total = population.reduce((a, b) => a + b, 0);
  for (const [maxPop, maxMetres] of [[0.5, Infinity], [0.1, Infinity], [0.5, 3500]]) {
    const z = windows(xy, population, { maxPop, maxMetres });
    assert.ok(z.order instanceof Int32Array && z.starts instanceof Int32Array);
    xy.forEach(([x0, y0], i) => {
      const d = xy.map(([x, y], j) => [(x - x0) ** 2 + (y - y0) ** 2, j]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const want = [];
      let pop = 0;
      for (const [d2, j] of d) {
        if (Math.sqrt(d2) > maxMetres) break;
        pop += population[j];
        if (pop > maxPop * total) break;
        want.push(j);
      }
      assert.deepEqual(Array.from(z.order.slice(z.starts[i], z.starts[i + 1])), want, `center ${i} at ${maxPop}, ${maxMetres}`);
    });
  }
});

test("a scan past the work budget suggests a radius or 99 replicates instead of running", () => {
  const c = ref.chr;
  const base = { ids: c.ids, cases: c.cases, population: c.population, points: c.xy, maxPop: 0.5 };
  const { order } = windows(c.xy, c.population, { maxPop: 0.5 });
  const entries = order.length;
  // A budget between 99 and 999 replicates' worth.
  const tight = scan({ ...base, budget: entries * 500 });
  assert.ok(tight.advice && !tight.clusters, "no clusters past the budget");
  assert.equal(tight.advice.entries, entries);
  assert.equal(tight.advice.fewerReplicates, 99);
  assert.equal(scan({ ...base, replicates: 9999, budget: entries * 1000 }).advice.fewerReplicates, 999, "999 when it fits");
  assert.match(tight.advice.message, /99 replicates/);
  const miles = tight.advice.miles;
  assert.ok(miles >= 1 && miles <= 300, "a radius in whole miles");
  const capped = windows(c.xy, c.population, { maxPop: 0.5, maxMetres: miles * 1609.344 }).order.length;
  const wider = windows(c.xy, c.population, { maxPop: 0.5, maxMetres: (miles + 1) * 1609.344 }).order.length;
  assert.ok(capped * 999 <= entries * 500, "the suggested radius fits");
  assert.ok(miles === 300 || wider * 999 > entries * 500, "and is the widest that does");
  const run = scan({ ...base, maxMiles: miles, budget: entries * 500, alpha: 1 });
  assert.ok(run.clusters.length > 0, "the suggested radius runs");
  assert.ok(scan({ ...base, replicates: 99, budget: entries * 500 }).clusters.length > 0, "and so do 99 replicates");
  // Reported radii are the distance to each window's last member.
  const k = scan({ ...base, alpha: 1, clusters: 2 }).clusters[0];
  const at = new Map(c.ids.map((id, i) => [id, c.xy[i]]));
  const center = at.get(k.center);
  assert.ok(k.members.every((id) => Math.hypot(at.get(id)[0] - center[0], at.get(id)[1] - center[1]) <= k.radius * (1 + 1e-12)));
  const area = scanAreas({
    cases: Object.fromEntries(c.ids.map((id, i) => [id, c.cases[i]])),
    population: Object.fromEntries(c.ids.map((id, i) => [id, c.population[i]])),
    points: Object.fromEntries(c.ids.map((id, i) => [id, c.xy[i]])),
    maxPop: 0.5,
    budget: 10,
  });
  assert.equal(area.method, "scan");
  assert.ok(area.advice && !area.byId, "scanAreas passes the advice on");
});
