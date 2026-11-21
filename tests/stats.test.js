import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { analyze, adjustFdr } from "../src/stats.js";
import { polygonNeighbors } from "../src/stats-weights.js";

const values = { a: 1, b: 2, c: 5, d: 9, e: 1, f: 0 };
const neighbors = {
  a: ["b"],
  b: ["a", "c"],
  c: ["b", "d"],
  d: ["c", "e"],
  e: ["d", "f"],
  f: ["e"],
};
const close = (actual, expected, tol = 1e-12) =>
  assert.ok(Math.abs(expected - actual) < tol, actual + " vs " + expected);

test("observed Moran matches R matrix algebra and seeded p-values approach the exhaustive null", async () => {
  const result = await analyze({ values, neighbors, permutations: 9999 });
  // R: as.vector(scale(x) * (W %*% scale(x))), W row-standardized.
  const reference = [5 / 29, 0, 25 / 58, 0, -15 / 58, 15 / 29];
  // Exact local p by enumerating all choose(n-1,k) neighbor sets; all 6! global shuffles.
  const expectedP = [1, 1, 0.1, 0.5, 0.7, 0.6];
  close(result.globalI, 5 / 29);
  close(result.globalP, 0.3, 0.02);
  Object.values(result.byId).forEach((row, i) => {
    close(row.localI, reference[i]);
    close(row.p, expectedP[i], 0.025);
    close(row.z * row.lag, reference[i]);
  });
  assert.deepEqual(
    result,
    await analyze({ values, neighbors, permutations: 9999 }),
  );
});

test("a study subset, missing estimates, zero denominators and islands stay distinct", async () => {
  const result = await analyze({
    values: { ...values, d: null, g: 0, missing: null },
    neighbors: { ...neighbors, g: [], missing: [] },
    studyIds: ["a", "b", "c", "d", "e", "g", "missing"],
    denominators: { g: 0 },
    permutations: 19,
  });
  assert.equal(result.n, 3);
  assert.equal(result.byId.e.reason, "No eligible neighbors");
  assert.equal(result.byId.f.reason, "Outside study area");
  assert.equal(result.byId.d.reason, "Missing estimate");
  assert.equal(result.byId.g.reason, "Zero denominator");
  assert.equal(result.byId.missing.reason, "Missing estimate");
  assert.deepEqual(result.byId.c.neighbors, ["b"]);
  await assert.rejects(
    analyze({
      values: { a: 8, b: 8, c: 8 },
      neighbors: { a: ["b"], b: ["a", "c"], c: ["b"] },
    }),
    /variation/,
  );
});

test("invariant permutations yield p=1, and FDR preserves tied adjusted values", async () => {
  const triangles = { a: ["b", "c"], b: ["a", "c"], c: ["a", "b"] };
  const result = await analyze({
    values: { a: 1, b: 2, c: 5 },
    neighbors: triangles,
    permutations: 99,
    fdr: true,
  });
  close(result.globalI, -0.5);
  assert.equal(result.globalP, 1);
  for (const area of Object.values(result.byId)) {
    assert.equal(area.p, 1);
    assert.equal(area.q, 1);
    assert.equal(area.cluster, "NS");
  }
  const adjusted = adjustFdr([0.04, 0.002, 0.03, 0.04]);
  [0.04, 0.008, 0.04, 0.04].forEach((p, i) => close(adjusted[i], p));
});

function rectangle(id, x, y, width, height) {
  return {
    id,
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [x, y],
          [x + width, y],
          [x + width, y + height],
          [x, y + height],
          [x, y],
        ],
      ],
    },
  };
}

test("custom weights distinguish corners, partial edges, islands and overlapping interiors", () => {
  const features = [
    rectangle("a", 0, 0, 2, 2),
    rectangle("b", 2, 0.5, 1, 1),
    rectangle("c", 2, 2, 1, 1),
    rectangle("d", 0.5, 0.5, 0.5, 0.5),
    rectangle("e", 8, 8, 1, 1),
  ];
  assert.deepEqual(polygonNeighbors(features, "queen"), {
    a: ["b", "c"],
    b: ["a"],
    c: ["a"],
    d: [],
    e: [],
  });
  assert.deepEqual(polygonNeighbors(features, "rook"), {
    a: ["b"],
    b: ["a"],
    c: [],
    d: [],
    e: [],
  });
});

test("hole boundaries count as rook neighbors even with different ring segmentation", () => {
  const outer = rectangle("a", 0, 0, 4, 4);
  outer.geometry.coordinates.push([
    [1, 1],
    [1, 2],
    [2, 2],
    [2, 1],
    [1, 1],
  ]);
  const inner = rectangle("b", 1, 1, 1, 1);
  inner.geometry.coordinates[0].splice(1, 0, [1.5, 1]);
  assert.deepEqual(polygonNeighbors([outer, inner], "rook"), {
    a: ["b"],
    b: ["a"],
  });
});

test("Mississippi poverty results agree with independent statewide R fixtures for both rules", async () => {
  const dataFile = async (name) =>
    JSON.parse(
      await readFile(
        new URL("../public/data/" + name, import.meta.url),
        "utf8",
      ),
    );
  const [display, weights, reference] = await Promise.all([
    dataFile("tracts.geojson"),
    dataFile("neighbors.json"),
    dataFile("reference.json"),
  ]);
  const values = Object.fromEntries(
    display.features.map(({ properties: p }) => [p.GEOID, p.poverty_pct]),
  );
  for (const rule of ["queen", "rook"]) {
    const result = await analyze({
      values,
      neighbors: weights[rule],
      permutations: 19,
    });
    assert.equal(result.n, reference[rule].n);
    close(result.globalI, reference[rule].globalI, 1e-10);
    for (const [id, value] of Object.entries(reference[rule].localI))
      close(result.byId[id].localI, value, 1e-9);
  }
});
