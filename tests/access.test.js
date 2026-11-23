// Access to facilities against R: nearest distance, facilities within a
// distance, and E2SFCA ratios (Gaussian and step), from tract centers of
// population to pharmacies and to nursing-home beds.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transverseMercator } from "../src/geo/project.js";
import { accessMeasures, decay } from "../src/stats/access.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const ref = read("./models-reference.json").access;
const catalog = read("../public/data/ms/catalog.json");
const projection = transverseMercator(catalog.region.projection.tmerc);
const supply = (layer, field) => {
  const features = read("../public/data/ms/layers/" + layer + ".geojson").features;
  return {
    xy: features.map((f) => projection.forward(f.geometry.coordinates)),
    size: features.map((f) => (field ? f.properties[field] : 1)),
  };
};
const demand = { xy: ref.xy, population: ref.population };
const close = (got, want, tol, what) =>
  assert.ok(Math.abs(got - want) <= tol * Math.max(1, Math.abs(want)), `${what}: ${got} vs ${want}`);

for (const [name, layer, field, options] of [
  ["pharmacies", "pharmacies_2010", null, {}],
  ["pharmaciesStep", "pharmacies_2010", null, { kind: "step" }],
  ["nursingBeds", "nursing_homes_2024", "beds", { within: 15, catchment: 20 }],
]) {
  test(`access to ${name} matches R`, () => {
    const got = accessMeasures(demand, supply(layer, field), options);
    const want = ref[name];
    got.nearest.forEach((v, i) => close(v, want.nearest[i], 1e-7, "nearest " + ref.ids[i]));
    assert.deepEqual(got.count, want.count, "facilities within the distance");
    got.ratio.forEach((v, i) => close(v, want.ratio[i], 1e-6, "ratio " + ref.ids[i]));
  });
}

test("the Gaussian decay runs from 1 at the center to 0 at the catchment's edge", () => {
  assert.equal(decay(0, 30), 1);
  assert.ok(Math.abs(decay(30, 30)) < 1e-15);
  assert.equal(decay(31, 30), 0);
  assert.equal(decay(12, 30, "step"), 1);
  assert.throws(() => accessMeasures(demand, { xy: [], size: [] }), /no points/);
});
