import test from "node:test";
import assert from "node:assert/strict";
import { cameraFromSearch, cameraParam, chooseRegion, listed, projectRegion, regionHref, stateOf, unknownRegion } from "../src/core/regions.js";
import { matchRegions } from "../src/panels/regions.js";
import { commandAllowed, layerScope, SCOPED_COMMANDS } from "../src/core/scope.js";
import { countCached, offlineAsks, offlineBytes, offlineFiles } from "../src/data/offline.js";

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

test("offline downloads cover the vendor files, shared data and the open region", () => {
  const list = { vendor: ["vendor/a"], shared: ["data/index.json"], regions: { ms: ["data/ms/x"], de: ["data/de/y"] }, files: ["old"] };
  assert.deepEqual(offlineFiles(list, "de"), ["vendor/a", "data/index.json", "data/de/y"]);
  assert.deepEqual(offlineFiles(list, "tx"), ["vendor/a", "data/index.json"]);
  assert.deepEqual(offlineFiles({ files: ["old"] }, "ms"), ["old"]);
});

test("the offline status counts cached files from the caches' own lists", () => {
  const at = (f) => "https://x.test/rumb/" + f;
  const files = ["vendor/a.js", "data/ms/x.json", "data/ms/y.parquet"].map(at);
  // The worker caches some requests with a query string, and looks them up ignoring it.
  const cached = [at("vendor/a.js?v=3"), at("data/ms/x.json"), at("data/de/z.json"), at("data/ms/x.json")];
  assert.equal(countCached(files, cached), 2);
  assert.equal(countCached(files, []), 0);
  assert.equal(countCached(files, [...files, at("index.html")]), 3);
});

test("the national tract map opens a tract's state at the same place", () => {
  const meta = { states: [{ state: "01", id: "al", name: "Alabama" }, { state: "10", id: "de", name: "Delaware" }] };
  assert.equal(stateOf(meta, "10001040700").id, "de");
  assert.equal(stateOf(meta, "99000000000"), undefined);
  const at = cameraParam({ center: [-75.551234567, 39.16], zoom: 9.456 });
  assert.equal(at, "-75.55123,39.16000,9.46");
  assert.deepEqual(cameraFromSearch("?r=de&at=" + at), { center: [-75.55123, 39.16], zoom: 9.46 });
  // Alaska's shifted longitudes pass; nonsense does not.
  assert.deepEqual(cameraFromSearch("?at=-185.2,52,6"), { center: [-185.2, 52], zoom: 6 });
  for (const bad of ["", "?at=1,2", "?at=a,b,c", "?at=0,95,3", "?at=0,0,40"]) assert.equal(cameraFromSearch(bad), null, bad);
});

test("a tile layer is for viewing: the commands that need its shapes are off", () => {
  const tiled = { meta: { tiled: true } },
    counties = { meta: undefined };
  assert.equal(layerScope(tiled).viewOnly, true);
  assert.match(layerScope(tiled).reason, /counties nationwide, or on one state/);
  assert.deepEqual(layerScope(counties), { viewOnly: false, reason: null });
  for (const id of SCOPED_COMMANDS) {
    assert.equal(commandAllowed(id, tiled), false, id);
    assert.equal(commandAllowed(id, counties), true, id);
  }
  // Styling, the library and the region picker stay.
  for (const id of ["style", "add-layer", "regions", "fit", "view-map"]) assert.equal(commandAllowed(id, tiled), true, id);
});

test("offline downloads know their size, so a large region can ask first", () => {
  const list = { vendor: [], shared: [], regions: { us: [] }, bytes: { base: 61e6, us: 87e6, de: 2e6 } };
  assert.equal(offlineBytes(list, "us"), 148e6);
  // The region's own data decides, not the runtimes every region shares.
  assert.equal(offlineAsks(list, "us"), true);
  assert.equal(offlineAsks(list, "de"), false);
  assert.equal(offlineAsks({ files: [] }, "us"), false);
  assert.equal(offlineBytes({ files: [] }, "us"), null);
});
