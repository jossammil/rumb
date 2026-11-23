// Share links: what travels, what never does, the round trip and the checks
// on the way back in.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeShare, encodeShare, readShare, shareFromHash, shareState, shareUrl, SHARE_LIMIT } from "../src/core/share.js";
import { defaults } from "../src/core/state.js";
import { palettes } from "../src/map/classify.js";

const catalog = JSON.parse(readFileSync(new URL("../public/data/ms/catalog.json", import.meta.url)));
const LIB = new Set(["fire_stations_2020", "chr_counties_2025"]);
const isShared = (id) => id === "tracts" || LIB.has(id);
const options = { known: isShared, palettes: Object.keys(palettes), region: "ms" };

function sample() {
  return {
    ...defaults(catalog),
    active: "chr_counties_2025",
    measure: "v085_rawvalue",
    palette: "RdBu",
    classification: "jenks",
    count: 7,
    selected: "28049",
    picks: ["28049", "28121"],
    result: { huge: "analysis" },
    layers: [{ id: "q1", name: "Private query", sql: "SELECT secret", collection: { features: [] } }],
    stack: [
      { id: "tracts", visible: false },
      { id: "q1", visible: true },
      { id: "fire_stations_2020", visible: true, style: { shape: "triangle", size: 8 }, label: "name" },
      { id: "chr_counties_2025", visible: true, counts: ["fire_stations_2020", "q1"] },
    ],
    layerViews: { tracts: { measure: "child_poverty_pct", palette: "Ember", result: { big: 1 } }, q1: { measure: "x" } },
    filter: { kind: "radius", center: [-90.18, 32.3], miles: 25, orSelection: true },
    filterMode: "hide",
    roads: "below",
    sql: "SELECT secret",
  };
}

test("a share keeps catalog layers and settings, never imports, SQL or results", async () => {
  const data = shareState(sample(), { camera: { center: [-90.123456789, 32.3], zoom: 7.123 }, isShared, reference: "tracts" });
  const text = JSON.stringify(data);
  for (const secret of ["secret", "q1", "Private query", "huge", "analysis", "big"]) assert.ok(!text.includes(secret), secret);
  assert.deepEqual(data.m, [-90.12346, 32.3, 7.12]);
  assert.deepEqual(data.s.map((e) => e.i), ["tracts", "fire_stations_2020", "chr_counties_2025"]);
  assert.deepEqual(data.s[2].n, ["fire_stations_2020"]);
  assert.equal(data.w.palette, "RdBu");
  assert.deepEqual(data.o.tracts, { measure: "child_poverty_pct", palette: "Ember" });
  const { text: encoded } = await encodeShare(data);
  assert.ok(encoded.startsWith("1.") && encoded.length < 600, "compressed: " + encoded.length);
  assert.equal(shareFromHash("#state=" + encoded), encoded);
  assert.equal(shareUrl({ origin: "https://x.org", pathname: "/rumb/" }, encoded), "https://x.org/rumb/#state=" + encoded);
  // And back.
  const { state, camera, dropped } = readShare(await decodeShare(encoded), options);
  assert.deepEqual(dropped, []);
  assert.equal(state.active, "chr_counties_2025");
  assert.deepEqual(state.stack[0], { id: "tracts", visible: false });
  assert.deepEqual(state.stack[1].style, { shape: "triangle", size: 8 });
  assert.equal(state.stack[1].label, "name");
  assert.deepEqual([state.selected, state.picks], ["28121", ["28049", "28121"]]);
  assert.deepEqual(state.filter, { kind: "radius", center: [-90.18, 32.3], miles: 25, orSelection: true });
  assert.equal(state.filterMode, "hide");
  assert.equal(state.roads, "below");
  assert.equal(state.classification, "jenks");
  assert.deepEqual(camera, { center: [-90.12346, 32.3], zoom: 7.12 });
});

test("a query layer in focus falls back to the reference layer", () => {
  const s = { ...sample(), active: "q1" };
  const data = shareState(s, { camera: null, isShared, reference: "tracts" });
  assert.equal(data.a, "tracts");
  assert.equal(data.sel, undefined);
  assert.deepEqual(data.w, { measure: "child_poverty_pct", palette: "Ember" });
});

test("shared data is checked on the way in", async () => {
  const bad = {
    v: 1,
    r: "ms",
    a: "nowhere",
    s: [{ i: "nowhere" }, { i: "tracts", st: { color: "red", opacity: 9, shape: "star", size: 4 } }, { i: "fire_stations_2020", h: 1 }],
    w: { palette: "Neon", classification: "magic", count: 99, measure: "poverty_pct" },
    f: { kind: "radius", center: [-90, 200], miles: 5 },
    m: [10, 99, 3],
  };
  const { state, camera, dropped } = readShare(bad, options);
  assert.deepEqual(dropped, ["nowhere"]);
  assert.equal(state.active, "tracts");
  assert.deepEqual(state.stack[0], { id: "tracts", visible: true, style: { size: 4 } });
  assert.equal(state.stack[1].visible, false);
  assert.deepEqual([state.palette, state.classification, state.count, state.measure], [undefined, undefined, undefined, "poverty_pct"]);
  assert.equal(state.filter, null);
  assert.equal(camera, null);
  assert.throws(() => readShare({ v: 1, r: "al" }, options), /another region/);
  await assert.rejects(decodeShare("1.@@@"), /damaged/);
  await assert.rejects(decodeShare("1.AAAA"), /damaged/);
  assert.equal(shareFromHash("#other=1"), null);
});

test("long shares are shortened, then refused", async () => {
  const data = { v: 1, sel: Array.from({ length: 4000 }, (_, i) => "28" + String(i).padStart(9, "0")) };
  const { text, trimmed } = await encodeShare(data);
  assert.ok(text.length <= SHARE_LIMIT);
  assert.deepEqual(trimmed, ["selection"]);
  const ring = Array.from({ length: 3000 }, (_, i) => [-90 + Math.sin(i) * 0.987654321, 32 + Math.cos(i * 1.7) * 0.123456789]);
  const short = await encodeShare({ v: 1, f: { kind: "polygon", ring } });
  assert.ok(short.text.length <= SHARE_LIMIT && short.trimmed.includes("drawn area"));
  await assert.rejects(encodeShare({ v: 1, junk: "x".repeat(100000).split("").map((_, i) => i) }), /too much/);
});
