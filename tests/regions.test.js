import test from "node:test";
import assert from "node:assert/strict";
import { chooseRegion, listed, projectRegion, regionHref, unknownRegion } from "../src/core/regions.js";
import { matchRegions } from "../src/panels/regions.js";

const index = { default: "ms", regions: [{ id: "ms" }, { id: "de" }, { id: "tx" }] };

test("the region comes from ?r=, then the last one used, then the default", () => {
  assert.equal(chooseRegion(index, { search: "?r=de" }), "de");
  assert.equal(chooseRegion(index, { search: "?r=de", stored: "tx" }), "de");
  assert.equal(chooseRegion(index, { search: "", stored: "tx" }), "tx");
  assert.equal(chooseRegion(index, { search: "?r=zz", stored: "tx" }), "tx");
  assert.equal(chooseRegion(index, { search: "?r=zz", stored: "qq" }), "ms");
  assert.equal(chooseRegion(index), "ms");
  assert.equal(unknownRegion(index, "?r=zz"), "zz");
  assert.equal(unknownRegion(index, "?r=de"), null);
  assert.equal(unknownRegion(index, ""), null);
  assert.ok(listed(index, "tx") && !listed(index, "") && !listed(index, undefined));
});

test("the address for another region keeps the page and its other parameters", () => {
  const href = "https://example.org/rumb/?x=1#state=1.abc";
  assert.equal(regionHref(href, "de", { index }), "/rumb/?x=1&r=de");
  assert.equal(regionHref("https://example.org/rumb/?r=de", "ms", { index, hash: "state=1.abc" }), "/rumb/#state=1.abc");
  assert.equal(regionHref("https://example.org/rumb/", "tx", { index, extra: { restore: "1" } }), "/rumb/?r=tx&restore=1");
});

test("projects saved without a region are Mississippi's", () => {
  assert.equal(projectRegion({ region: "de" }), "de");
  assert.equal(projectRegion({}), "ms");
  assert.equal(projectRegion({ region: "" }), "ms");
});

test("the state picker finds states by name or abbreviation, in name order", () => {
  const regions = [{ id: "ms", name: "Mississippi" }, { id: "mo", name: "Missouri" }, { id: "de", name: "Delaware" }];
  assert.deepEqual(matchRegions(regions, "").map((r) => r.id), ["de", "ms", "mo"]);
  assert.deepEqual(matchRegions(regions, "miss").map((r) => r.id), ["ms", "mo"]);
  assert.deepEqual(matchRegions(regions, "DE").map((r) => r.id), ["de"]);
  assert.deepEqual(matchRegions(regions, " zz ").map((r) => r.id), []);
});
