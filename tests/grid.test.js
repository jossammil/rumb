// The grid index against full scans: every search that goes through
// src/stats/grid.js must give exactly the result of visiting every point,
// ties and floating-point sums included, on random, duplicated, collinear,
// clustered and lattice points.
import test from "node:test";
import assert from "node:assert/strict";
import { randomGenerator } from "../src/stats/random.js";
import { pointGrid, within } from "../src/stats/grid.js";
import { band, connectingBand, knn } from "../src/stats/neighbors.js";
import { densityGrid, nearestDistances, quarticDensity, ripleyL } from "../src/stats/points.js";
import { accessMeasures } from "../src/stats/access.js";
import { windows } from "../src/stats/scan.js";

const MILE = 1609.344;

/** Point sets that stress the grid: n points over a box about `span` metres wide. */
function patterns(seed, n, span = 200000) {
  const random = randomGenerator(seed);
  const uniform = Array.from({ length: n }, () => [random() * span, random() * span]);
  // Whole-metre coordinates on a coarse lattice, so many distances tie exactly.
  const step = span / Math.ceil(Math.sqrt(n));
  const lattice = Array.from({ length: n }, (_, i) => [(i % Math.ceil(Math.sqrt(n))) * step, Math.floor(i / Math.ceil(Math.sqrt(n))) * step]);
  // A few dense clusters far apart, plus repeated points.
  const clustered = Array.from({ length: n }, (_, i) => {
    const c = i % 4;
    return [c * span + random() * 500, (c % 2) * span + random() * 500];
  });
  for (let i = 0; i < n; i += 7) clustered[i] = clustered[Math.floor(i / 2)].slice();
  // Every point on one line, and projected-plane magnitudes like Albers.
  const line = Array.from({ length: n }, () => [2.1e6 + random() * span, 1.4e6]);
  return { uniform, lattice, clustered, line };
}

const sets = Object.entries({ ...patterns(1, 300), ...Object.fromEntries(Object.entries(patterns(2, 90, 5000)).map(([k, v]) => [k + "Small", v])) });

test("grid candidates hold every point within the radius", () => {
  for (const [name, xy] of sets) {
    const g = pointGrid(xy);
    for (const r of [0, 1000, 25000, 1e9]) {
      for (let i = 0; i < xy.length; i += 17) {
        const js = new Set(within(g, xy[i][0], xy[i][1], r));
        xy.forEach((q, j) => {
          if (Math.hypot(q[0] - xy[i][0], q[1] - xy[i][1]) <= r) assert.ok(js.has(j), `${name} r=${r} ${i}→${j}`);
        });
      }
    }
  }
});

test("k nearest neighbors through the grid equal the full scan, ties included", () => {
  for (const [name, xy] of sets)
    for (const k of [1, 4, 6, 12]) assert.deepEqual(knn(xy, k, { grid: true }), knn(xy, k, { grid: false }), `${name} k=${k}`);
});

test("distance bands and the connecting band equal the full scan", () => {
  for (const [name, xy] of sets) {
    const auto = connectingBand(xy, { grid: false });
    assert.equal(connectingBand(xy, { grid: true }), auto, name);
    for (const metres of [auto, 2000, 30000, 5 * MILE])
      assert.deepEqual(band(xy, metres, { grid: true }), band(xy, metres, { grid: false }), `${name} ${metres}`);
  }
});

test("nearest distances and Ripley pair counts equal the full scan", () => {
  for (const [name, xy] of sets) {
    assert.deepEqual(nearestDistances(xy, { grid: true }), nearestDistances(xy, { grid: false }), name);
    const distances = [500, 2000, 10000, 40000, 120000];
    assert.deepEqual(ripleyL(xy, 4e10, distances, { grid: true }), ripleyL(xy, 4e10, distances, { grid: false }), name);
  }
});

test("kernel density sums through the grid are bit-identical", () => {
  const random = randomGenerator(9);
  for (const [name, xy] of sets) {
    const weights = xy.map(() => 1 + random() * 1000);
    const r = 15000;
    const g = pointGrid(xy, { cell: r });
    for (let i = 0; i < xy.length; i += 11) {
      const at = [xy[i][0] + 37.5, xy[i][1] - 12.25];
      assert.equal(quarticDensity(at, xy, weights, r, g), quarticDensity(at, xy, weights, r), `${name} ${i}`);
    }
    const outline = [[[[-1000, -1000], [9e5, -1000], [9e5, 3e5], [-1000, 3e5], [-1000, -1000]]]];
    if (name.startsWith("uniform"))
      assert.deepEqual(
        densityGrid(xy, weights, outline, { bandwidth: r, cell: 20000, grid: true }),
        densityGrid(xy, weights, outline, { bandwidth: r, cell: 20000, grid: false }),
        name,
      );
  }
});

test("access measures through the grid are bit-identical, facilities off the grid included", () => {
  const random = randomGenerator(4);
  for (const [name, xy] of sets) {
    const demand = {
      xy: xy.map((p, i) => (i % 13 === 5 ? null : [p[0] + 1500, p[1] - 800])),
      population: xy.map((_, i) => (i % 9 === 0 ? null : Math.round(random() * 8000))),
    };
    // Facilities: half the points, plus some far outside the demand's extent.
    const pts = xy.filter((_, i) => i % 2 === 0).concat([[-5e5, -5e5], [3e6, 2e5]]);
    const supply = { xy: pts, size: pts.map(() => 1 + Math.floor(random() * 50)) };
    for (const options of [{}, { kind: "step" }, { within: 1, catchment: 3 }, { within: 400, catchment: 600 }])
      assert.deepEqual(
        accessMeasures(demand, supply, { ...options, grid: true }),
        accessMeasures(demand, supply, { ...options, grid: false }),
        `${name} ${JSON.stringify(options)}`,
      );
  }
});

test("scan windows with a radius cap equal the full scan", () => {
  const random = randomGenerator(5);
  for (const [name, xy] of sets) {
    const population = xy.map(() => 100 + Math.floor(random() * 5000));
    for (const miles of [1, 5, 20])
      for (const maxPop of [0.05, 0.5]) {
        const got = windows(xy, population, { maxPop, maxMetres: miles * MILE, grid: true }),
          want = windows(xy, population, { maxPop, maxMetres: miles * MILE, grid: false });
        assert.deepEqual(got.starts, want.starts, `${name} ${miles} mi starts`);
        assert.deepEqual(got.order, want.order, `${name} ${miles} mi order`);
      }
  }
});
