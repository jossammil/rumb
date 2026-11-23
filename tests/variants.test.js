// Bivariate Local Moran against spdep::localmoran_bv, and EB-adjusted Moran
// against spdep::EBImoran.mc and the Assunção–Reis formula, on Mississippi
// tracts over the queen graph.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bivariate, ebMoran, ebStandardize } from "../src/stats/variants.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const ref = read("./stats-reference.json").variants;
const tracts = read("../public/data/ms/tracts.geojson").features.map((f) => f.properties);
const graphs = read("../public/data/ms/neighbors.json");
const by = (field) => Object.fromEntries(tracts.map((p) => [p.GEOID, p[field]]));
const close = (got, want, tol, what) =>
  assert.ok(Math.abs(got - want) <= tol * Math.max(1, Math.abs(want)), `${what}: ${got} vs ${want}`);

test("bivariate Local Moran matches spdep::localmoran_bv", async () => {
  const result = await bivariate({
    values: by("poverty_pct"),
    second: by("child_poverty_pct"),
    neighbors: graphs.queen,
    weights: { kind: "queen" },
    permutations: 99,
  });
  assert.equal(result.n, ref.bivariate.ids.length);
  ref.bivariate.ids.forEach((id, i) => close(result.byId[id].localI, ref.bivariate.localI[i], 1e-10, id));
  close(result.globalI, ref.bivariate.globalI, 1e-12, "global");
  const records = Object.values(result.byId).filter((r) => !r.reason);
  assert.ok(records.every((r) => Math.abs(r.localI - r.z * r.lag) < 1e-12));
  assert.ok(records.every((r) => r.p > 0 && r.p <= 1 && ["HH", "LL", "HL", "LH", "NS"].includes(r.cluster)));
});

test("EB-adjusted Moran matches spdep::EBImoran.mc and the Assunção–Reis scores", async () => {
  const events = by("poverty_count"),
    base = by("poverty_universe");
  const ids = ref.eb.ids;
  const eb = ebStandardize(
    ids.map((id) => events[id]),
    ids.map((id) => base[id]),
  );
  close(eb.a, ref.eb.a, 1e-12, "a");
  close(eb.b, ref.eb.b, 1e-12, "b");
  eb.z.forEach((z, i) => close(z, ref.eb.z[i], 1e-10, ids[i]));
  const result = await ebMoran({ events, base, neighbors: graphs.queen, weights: { kind: "queen" }, permutations: 99 });
  assert.equal(result.method, "eblisa");
  assert.equal(result.n, ids.length);
  close(result.globalI, ref.eb.I, 1e-10, "EB Moran's I");
  const first = result.byId[ids[0]];
  close(first.rate, events[ids[0]] / base[ids[0]], 1e-15, "raw rate kept");
});

test("an a below zero is raised to the pooled rate over the mean base, as in spdep", () => {
  // Identical rates: the between-area variance estimate is negative.
  const { a, b, z } = ebStandardize([10, 20, 30], [100, 200, 300]);
  assert.equal(b, 0.1);
  close(a, 0.1 / 200, 1e-15, "a");
  assert.ok(z.every((v) => Math.abs(v) < 1e-12));
});
