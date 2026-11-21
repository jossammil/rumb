import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compareAreas, comparisonCSV } from "../src/compare-score.js";
const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const components = (...fields) =>
  fields.map((field, i) => ({
    field,
    weight: fields.length === 2 ? 50 : [30, 30, 40][i],
    direction: "higher",
  }));
test("all 870 paired tract scores, ranks and quadrants match R", () => {
  const cdc = read("../public/data/places-2025.json").byId;
  const features = read("../public/data/tracts.geojson").features.map((f) => ({
    ...f,
    properties: { ...f.properties, ...cdc[f.id] },
  }));
  const result = compareAreas(
    features,
    components("poverty_pct", "transportation_barrier_pct"),
  );
  assert.equal(result.rows.length, 878);
  assert.equal(result.eligibleCount, 870);
  for (const { id, score, rank, quadrant } of read(
    "./comparison-reference.json",
  )) {
    const row = result.byId.get(id);
    assert.deepEqual(
      [row.score, row.rank, row.quadrant],
      [score, rank, quadrant],
    );
  }
});
test("complete cases, tied values, lower direction, constant and singleton fields", () => {
  const features = [
    [1, 1, 0],
    [1, 1, 2],
    [3, 1, 4],
    [10, 2, null],
  ].map(([x, y, z], id) => ({ id, properties: { x, y, z } }));
  const parts = components("x", "y", "z");
  parts[2].direction = "lower";
  const result = compareAreas(features, parts);
  assert.deepEqual(result.medians, [1, 1]);
  assert.deepEqual(result.rows[0].percentiles, [0, 0.5, 0]);
  assert.deepEqual(
    result.rows.map((r) => r.score),
    [55, 35, 45, null],
  );
  assert.match(comparisonCSV(result), /Unavailable: z/);
  assert.equal(compareAreas(features.slice(0, 1), parts).rows[0].score, 50);
  assert.throws(
    () => compareAreas(features, [{ ...parts[0], weight: 0 }, parts[1]]),
    /weight/i,
  );
});
