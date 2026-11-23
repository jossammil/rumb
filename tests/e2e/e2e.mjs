// End-to-end checks in a real browser against the built app (npm run build
// first). Starts its own server like GitHub Pages: the site under a subpath,
// no special headers. Each check prints PASS, FAIL or SKIP with its time.
//   npm run e2e                      Chrome (installed Chrome when present)
//   BROWSER=webkit npm run e2e       WebKit (Safari's engine); needs `npx playwright install webkit`
//   SHOTS=/some/dir npm run e2e      also save screenshots (always on failure)
//   ONLY=clusters,join npm run e2e   run some checks (boot always runs)
//   HEADED=1 npm run e2e             watch it in a browser window
//   RUMB_BASE=/rumb/ npm run e2e     serve under another subpath
import { chromium, webkit } from "playwright";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { formatMiles, measurePath } from "../../src/geo/measure.js";
import { transverseMercator } from "../../src/geo/project.js";
import {
  BlobReader,
  BlobWriter,
  TextReader,
  ZipWriter,
} from "@zip.js/zip.js/lib/zip-core-native.js";

const which = process.env.BROWSER || "chromium";
const shots = process.env.SHOTS;
const only = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const basePath = (process.env.RUMB_BASE || "/rumb/").replace(/\/?$/, "/");
const port = 4500 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}${basePath}`;

if (!existsSync("dist/index.html")) {
  console.error("Run `npm run build` first.");
  process.exit(1);
}
const server = spawn(process.execPath, ["scripts/serve.mjs"], {
  env: { ...process.env, RUMB_PORT: String(port), RUMB_BASE: basePath },
  stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 500));

const show = process.env.HEADED === "1" ? { headless: false, slowMo: 120 } : {};
const browser = await (which === "webkit"
  ? webkit.launch(show)
  : chromium.launch({
      ...show,
      ...(existsSync("/Applications/Google Chrome.app") || process.env.CHROME
        ? { channel: "chrome" }
        : {}),
      args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
    }));

// Reference data, read from the repository (the region folder or the old flat layout).
async function dataFile(name) {
  for (const p of [`public/data/ms/${name}`, `public/data/${name}`])
    if (existsSync(p)) return readFile(p);
  throw new Error(`missing data file ${name}`);
}
const ids = JSON.parse(await dataFile("tracts.geojson")).features.map(
  (f) => f.properties.GEOID,
);

const errors = [];
const external = new Set();
const origin = new URL(base).origin;
let page;
const pages = [];

async function openPage(viewport = { width: 1440, height: 960 }) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  const p = await ctx.newPage();
  p.setDefaultTimeout(35000);
  p.on("pageerror", (e) => errors.push(e.message + " @ " + (e.stack || "").split("\n").slice(1, 3).join(" ").trim()));
  p.on("request", (r) => {
    const u = new URL(r.url());
    if (/^https?:$/.test(u.protocol) && u.origin !== origin) external.add(u.origin);
  });
  pages.push(p);
  await p.goto(base);
  await ready(p);
  return p;
}
const ready = (p) =>
  p.waitForFunction(
    () =>
      window.rumb?.timings?.firstMap ||
      performance.getEntriesByName("rumb-first-map").length ||
      performance.getEntriesByName("field-atlas-first-map").length,
    null,
    { timeout: 60000 },
  );

let passed = 0,
  failed = 0,
  skipped = 0;
async function check(name, fn) {
  if (only && !only.has(name) && name !== "boot") return;
  const started = Date.now();
  try {
    const result = await fn();
    if (result === "skip") {
      skipped++;
      console.log(`SKIP  ${name}`);
      return;
    }
    passed++;
    console.log(`PASS  ${name} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  } catch (error) {
    failed++;
    console.log(`FAIL  ${name}: ${error.message.split("\n")[0]}`);
    if (shots)
      await page
        ?.screenshot({ path: path.join(shots, `${which}-FAIL-${name}.png`) })
        .catch(() => {});
  }
}
const expect = (ok, message) => {
  if (!ok) throw new Error(message);
};
const shot = (name, p = page) =>
  shots ? p.screenshot({ path: path.join(shots, `${which}-${name}.png`) }) : null;
const waitText = (selector, text, p = page) =>
  p.locator(selector).filter({ hasText: text }).first().waitFor();
let lastDownloadName = "";
async function download(selector, p = page) {
  const [file] = await Promise.all([p.waitForEvent("download"), p.click(selector)]);
  const bytes = await readFile(await file.path());
  expect(bytes.length > 0, `empty download from ${selector}`);
  lastDownloadName = file.suggestedFilename();
  return bytes;
}
const noOverflow = (p = page) =>
  p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

// Single-line CSV fields only (including quoted names).
function csvRows(bytes) {
  const records = bytes
    .toString("utf8")
    .replace(/^﻿/, "")
    .trimEnd()
    .split(/\r?\n/)
    .map((line) =>
      [...line.matchAll(/(?:^|,)("(?:[^"]|"")*"|[^,]*)/g)].map(([, cell]) =>
        cell.startsWith('"') ? cell.slice(1, -1).replaceAll('""', '"') : cell,
      ),
    );
  const [header, ...rows] = records;
  return rows.map((row) => {
    expect(row.length === header.length, "CSV header and data column counts differ");
    return Object.fromEntries(header.map((field, i) => [field, row[i]]));
  });
}

async function restore(p, buffer, name = "workspace.bgis") {
  await p.setInputFiles("#project-picker", {
    name,
    mimeType: "application/zip",
    buffer,
  });
  await waitText("#toast", /project restored/i, p);
}

// The original v1 manifest and file inventory, independent of today's writer.
async function legacyProject() {
  const zip = new ZipWriter(new BlobWriter("application/zip"), {
    useWebWorkers: false,
    level: 0,
  });
  const state = {
    view: "map",
    active: "tracts",
    measure: "child_poverty_pct",
    palette: "Ember",
    classification: "equal",
    count: 4,
    rule: "rook",
    study: "all",
    permutations: 999,
    seed: 12345,
    fdr: false,
    selected: null,
    result: null,
    mode: "value",
    inspector: false,
    sql: "SELECT 42 AS answer",
    layers: [],
    layerViews: {},
  };
  await zip.add(
    "project.json",
    new TextReader(JSON.stringify({ format: "field-atlas", version: 1, state, files: [] })),
  );
  for (const name of ["tracts.parquet", "tracts.geojson", "neighbors.json", "sources.json"])
    await zip.add(`base/${name}`, new BlobReader(new Blob([await dataFile(name)])));
  return Buffer.from(await (await zip.close()).arrayBuffer());
}

const districts = {
  type: "FeatureCollection",
  features: [
    ["A", -91, -88, 1, 4, 10],
    ["B", -92, -91, 4, 1, 10],
    ["C", -93, -92, 3, 3, 30],
    ["D", -88, -87, 2, 2, null],
  ].map(([GEOID, west, east, need, reach, capacity]) => ({
    type: "Feature",
    properties: { GEOID, name: `District ${GEOID}`, need, reach, capacity },
    geometry: {
      type: "Polygon",
      coordinates: [[[west, 32], [east, 32], [east, 34], [west, 34], [west, 32]]],
    },
  })),
};

async function chooseSettings(p, fields, weights, directions) {
  if (!(await p.locator("#cmp-settings").evaluate((el) => el.open)))
    await p.click("#cmp-settings summary");
  if (fields.length === 3 && !(await p.locator("#cmp-field-2").count()))
    await p.click("#cmp-add");
  for (const [i, field] of fields.entries()) {
    await p.selectOption(`#cmp-field-${i}`, field);
    await p.selectOption(`#cmp-direction-${i}`, directions[i]);
    await p.fill(`#cmp-weight-${i}`, String(weights[i]));
  }
  await p.click("#cmp-apply");
}

if (shots) await mkdir(shots, { recursive: true });
let savedProject, compareProject;

// ---- the map and cluster analysis ------------------------------------------------
await check("boot", async () => {
  const requests = [];
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    acceptDownloads: true,
  });
  page = await ctx.newPage();
  page.setDefaultTimeout(35000);
  page.on("pageerror", (e) => errors.push(e.message + " @ " + (e.stack || "").split("\n").slice(1, 3).join(" ").trim()));
  page.on("request", (r) => {
    requests.push(r.url());
    const u = new URL(r.url());
    if (/^https?:$/.test(u.protocol) && u.origin !== origin) external.add(u.origin);
  });
  pages.push(page);
  await page.goto(base);
  await waitText("#foot-status", "878 features");
  await ready(page);
  await page.waitForFunction(
    () => document.querySelectorAll('#measure optgroup[label="Measure"] option').length === 2,
  );
  expect(
    !requests.some((u) => /duckdb|geoda-lisa.*wasm/.test(u)),
    "analytics downloaded before the first map",
  );
  // Roads and add-on layers wait for the first map; roads then draw on their own.
  await page.waitForFunction(() => window.rumb.map.querySourceFeatures("roads").length > 0);
  const late = await page.evaluate(() => {
    const first = window.rumb.timings.firstMap;
    return performance
      .getEntriesByType("resource")
      .filter((e) => /roads\.geojson|\/layers\/|\/tables\//.test(e.name))
      .every((e) => e.startTime >= first - 1);
  });
  expect(late, "roads, layer or table files were requested before the first map");
  expect(!requests.some((u) => /\/layers\//.test(u)), "add-on layers loaded without being asked for");
  // The table index follows the first map; its values wait until a field needs them.
  await page.waitForSelector('#measure optgroup[label="CDC PLACES 2025 (model-based)"]', { state: "attached" });
  expect(!requests.some((u) => /tables\/tracts-(acs|places)/.test(u)), "table values loaded without being asked for");
  await page.waitForTimeout(500);
  await shot("map");
});

await check("clusters", async () => {
  await page.click("#analyze");
  await waitText("#inspect-panel", "0.2768");
  await waitText("#inspect-panel", "872");
  await page.click("#find-feature");
  await page.fill("#find-term", ids[0]);
  await page.locator("#find-results button").first().click();
  await waitText("#inspect-panel", "Adams County");
  await waitText("#inspect-panel", "90% margin of error");
  await waitText("#inspect-panel", "Eligible neighbors");
  await download("#save-results");
  await page.selectOption("#rule", "rook");
  await page.click("#analyze");
  await waitText("#inspect-panel", "0.2846");
  await page.click("#fit");
  await page.waitForTimeout(500);
  await shot("clusters");
  await download("#export-map");
});

await check("weights", async () => {
  const ref = JSON.parse(await readFile("tests/stats-reference.json", "utf8")).weights.moran;
  const p = await openPage();
  const run = async (expected) => {
    await p.click("#analyze");
    await waitText("#inspect-panel", expected.toFixed(4), p);
  };
  // k nearest between 2020 centers of population, as spdep finds them.
  await p.selectOption("#rule", "knn");
  await p.waitForSelector("#k", { state: "visible" });
  await run(ref.knn6);
  await waitText("#weights-note", "6 neighbors each · no islands · from 2020 centers of population", p);
  await p.check("#symmetric");
  await run(ref.knn6sym);
  await p.selectOption("#rule", "band");
  await run(ref.connected);
  await waitText("#weights-note", "Every area within 14.8 mi", p);
  await p.fill("#band", "25");
  await p.press("#band", "Enter");
  await run(ref.band25);
  await p.selectOption("#rule", "idw");
  await p.selectOption("#power", "2");
  await p.fill("#band", "");
  await p.press("#band", "Enter");
  await run(ref.idw2);
  await p.click("#find-feature");
  await p.fill("#find-term", ids[0]);
  await p.locator("#find-results button").first().click();
  await waitText("#inspect-panel", "Eligible neighbors", p);
  // The weights travel in a share link.
  await p.evaluate(() => window.rumb.runCommand("share"));
  await p.locator("#share-link").waitFor();
  const url = await p.inputValue("#share-link");
  await p.context().close();
  const q = await openPage();
  await q.goto(url.replace(/^https?:\/\/[^/]+/, origin));
  await ready(q);
  await waitText("#toast", "Opened a shared map", q);
  const kept = await q.evaluate(() => [window.rumb.state.rule, window.rumb.state.power, window.rumb.state.band].join());
  expect(kept === "idw,2,", "shared weights " + kept);
  await q.context().close();
});

await check("hotspots", async () => {
  const hs = JSON.parse(await readFile("tests/stats-reference.json", "utf8")).hotspots.queen;
  const { pnorm } = await import("../../src/stats/dist.js");
  const hot = hs.gi.filter((z) => z > 0 && 2 * pnorm(-Math.abs(z)) <= 0.1).length;
  const p = await openPage();
  // H switches the method to Gi* and runs it on the focus measure.
  await p.keyboard.press("h");
  await waitText("#inspect-panel", "Hot spot analysis", p);
  await waitText("#legend", "Gi* hot and cold spots", p);
  const shown = await p.$eval("#inspect-panel", (el) => el.textContent.match(/Hot spots(\d+)/)?.[1]);
  expect(Number(shown) === hot, "hot spots " + shown + " vs " + hot);
  await p.evaluate((id) => window.rumb.app.selectFeature(id), hs.ids[0]);
  await waitText("#inspect-panel", "Gi* z-score" + hs.gi[0].toFixed(3), p);
  const bytes = await download("#save-results", p);
  expect(bytes.toString().startsWith("GEOID_or_feature_ID,measure,value,Gi_star_z"), "hot spot CSV header");
  // Permutation inference with FDR runs too.
  await p.selectOption("#gi-inference", "permutation");
  await p.click("#inference summary");
  await p.check("#fdr");
  await p.click("#analyze");
  await waitText("#inspect-panel", "Conditional permutations, FDR-adjusted", p);
  const bins = await p.evaluate(() =>
    window.rumb.map.querySourceFeatures("lyr-tracts").some((f) => /^[HC]9/.test(f.properties.__rumb_class)),
  );
  expect(bins, "hot spot bins on the map");
  await p.context().close();
});

await check("identity", async () => {
  const p = await openPage();
  const ids = ["lyr-tracts-fill", "lyr-tracts-outline", "anchor-areas", "anchor-points", "anchor-labels", "sel-line"];
  const has = await p.evaluate(
    (list) => list.every((id) => window.rumb.map.getLayer(id)) && !window.rumb.map.getLayer("areas"),
    ids,
  );
  expect(has, "stacked map layers missing");
  // A click picks the feature under the cursor through its layer.
  const box = await p.locator("#map").boundingBox();
  await p.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.55);
  await p.locator("#inspect-panel:not([hidden])").waitFor();
  const selected = await p.evaluate(() => window.rumb.state.selected);
  expect(/^28\d{9}$/.test(selected || ""), "a click did not select a tract");
  await p.waitForFunction(() => window.rumb.map.querySourceFeatures("selection").length > 0);
  await p.context().close();
});

await check("join", async () => {
  await page.setInputFiles("#file-picker", {
    name: "measures.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "GEOID,service_rate\n" + ids.map((id, i) => id + "," + (i % 12)).join("\n"),
    ),
  });
  await waitText("#work-content", "Table preview");
  await page.click("#check-join");
  await waitText("#join-result", "878 matched");
  await page.click("#join-map");
  await waitText("#map-title", "measures by tract");
  expect((await page.inputValue("#measure")) === "service_rate", "joined measure not chosen");
  await page.click("#analyze");
  await waitText("#inspect-panel", "Global Moran");
  await page.click("#find-feature");
  await page.fill("#find-term", ids[0]);
  await page.locator("#find-results button").first().click();
  savedProject = await download("#save-project");
  expect(/\.rumb$/.test(lastDownloadName), `project saved as ${lastDownloadName}`);
});

await check("restore", async () => {
  if (!savedProject) return "skip";
  const p = await openPage({ width: 1280, height: 850 });
  await restore(p, savedProject, "measures.rumb");
  await waitText("#map-title", "measures by tract", p);
  await waitText("#inspect-panel", "Global Moran", p);
  await waitText("#inspect-panel", ids[0], p);
  expect((await p.inputValue("#measure")) === "service_rate", "restored measure");
  await p.click('[data-view="sql"]');
  await p.fill("#sql-input", "SELECT count(*) AS total FROM measures");
  await p.click("#run-query");
  await waitText("#query-grid", "878", p);
  const csv = (await download("#export-query", p)).toString("utf8");
  expect(/total\r?\n878/.test(csv), "restored query CSV");
  await p.click('[data-view="map"]');
  await p.click('[data-layer="tracts"]');
  await waitText("#inspect-panel", "0.2846", p);
  await p.selectOption("#study", "county:Adams County");
  await p.selectOption("#measure", "child_poverty_pct");
  await p.click("#inference summary");
  await p.check("#fdr");
  await p.click("#analyze");
  await waitText("#inspect-panel", "FDR-adjusted q", p);
  await waitText("#inspect-panel", "Adams County", p);
  await p.context().close();
});

await check("points", async () => {
  await page.setInputFiles("#file-picker", {
    name: "sites.geojson",
    mimeType: "application/geo+json",
    buffer: Buffer.from(
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { name: "Jackson site" },
            geometry: { type: "Point", coordinates: [-90.18, 32.3] },
          },
        ],
      }),
    ),
  });
  await waitText("#work-content", "Table preview");
  await page.click("#count-source");
  await page.click("#run-query");
  await waitText("#query-grid", "point_count");
  await page.click("#map-query");
  await waitText("#map-title", "Query result");
  expect((await page.inputValue("#measure")) === "point_count", "point count measure");
});

await check("mobile", async () => {
  const p = await openPage({ width: 390, height: 844 });
  await p.click("#mobile-settings");
  await p.locator("#settings.open").waitFor();
  await p.click('[data-layer="tracts"]');
  if (await p.locator("#settings.open").count()) await p.click("#close-side");
  await p.locator("#settings:not(.open)").waitFor();
  await p.waitForTimeout(400);
  expect(await noOverflow(p), "page wider than a 390px phone");
  await shot("mobile", p);
  await p.context().close();
});

await check("layers", async () => {
  const p = await openPage();
  await p.click("#add-layer");
  await p.click('[data-library="fire_stations_2020"]');
  await waitText("#toast", /Added Fire stations/, p);
  await p.keyboard.press("n");
  await p.click('[data-library="chr_counties_2025"]');
  await waitText("#toast", /Added County Health Rankings/, p);
  const ids = () => p.evaluate(() => window.rumb.state.stack.map((e) => e.id + (e.visible ? "" : ":hidden")).join());
  expect((await ids()) === "tracts,fire_stations_2020,chr_counties_2025", "stack " + (await ids()));
  // The newest layer is the focus, so its measures fill the style panel.
  expect((await p.inputValue("#measure")) === "v085_rawvalue", "County Health Rankings lead measure");
  await waitText("#legend", "Uninsured", p);
  // Areas draw below the roads and points above them, whatever the stack order.
  const bands = await p.evaluate(() => {
    const order = window.rumb.map.getStyle().layers.map((l) => l.id);
    return ["lyr-tracts-fill", "lyr-chr_counties_2025-fill", "roads-primary", "lyr-fire_stations_2020-point"].map((id) =>
      order.indexOf(id),
    );
  });
  expect(bands.every((v, i) => v >= 0 && (i === 0 || v > bands[i - 1])), "layer bands " + bands);
  await p.click('[data-row="chr_counties_2025"] [aria-label^="Move down"]');
  await p.click('[data-row="chr_counties_2025"] [aria-label^="Move down"]');
  await p.click('[data-row="fire_stations_2020"] .eye');
  expect((await ids()) === "chr_counties_2025,tracts,fire_stations_2020:hidden", "moved and hidden " + (await ids()));
  expect(
    (await p.evaluate(() => window.rumb.map.getLayoutProperty("lyr-fire_stations_2020-point", "visibility"))) === "none",
    "hidden layer still drawn",
  );
  // The tracts keep their statistics with other layers on the map.
  await p.click('[data-layer="tracts"]');
  expect((await p.inputValue("#measure")) === "poverty_pct", "tract measure restored");
  await p.click("#analyze");
  await waitText("#inspect-panel", "0.2768", p);
  await p.click('[data-view="compare"]');
  await waitText("#cmp-count", "870 of 878 areas ranked", p);
  await p.click('[data-view="map"]');
  // A project keeps the stack and carries the library layers' files.
  const saved = await download("#save-project", p);
  const q = await openPage();
  const fetched = [];
  q.on("request", (r) => fetched.push(r.url()));
  await restore(q, saved, "stack.rumb");
  const back = await q.evaluate(() => window.rumb.state.stack.map((e) => e.id + (e.visible ? "" : ":hidden")).join());
  expect(back === "chr_counties_2025,tracts,fire_stations_2020:hidden", "restored stack " + back);
  await q.click('[data-layer="chr_counties_2025"]');
  await waitText("#legend", "Uninsured", q);
  expect(!fetched.some((u) => /chr_counties_2025\.geojson|fire_stations_2020\.geojson/.test(u)), "layer files fetched again");
  await shot("layers", q);
  await p.context().close();
  await q.context().close();
});

await check("symbology", async () => {
  const p = await openPage();
  const add = async (id, name) => {
    await p.keyboard.press("n");
    await p.click(`[data-library="${id}"]`);
    await waitText("#toast", "Added " + name, p);
  };
  await add("law_enforcement_2017", "Law enforcement sites");
  // Color by category: the catalog's type field comes first.
  await p.selectOption("#measure", "category:type");
  await waitText("#legend", "Police station", p);
  // Shape, size and labels rebuild the layer as symbols.
  await p.click("#look summary");
  await p.selectOption("#look-shape", "triangle");
  await p.locator("#look-size").fill("9");
  await p.locator("#look-size").dispatchEvent("change");
  await p.selectOption("#look-label", "name");
  const built = await p.evaluate(() => {
    const m = window.rumb.map;
    return [
      m.getLayer("lyr-law_enforcement_2017-shape")?.type,
      m.getLayoutProperty("lyr-law_enforcement_2017-shape", "icon-image"),
      m.getLayoutProperty("lyr-law_enforcement_2017-shape", "icon-size"),
      !!m.getLayer("lyr-law_enforcement_2017-label"),
    ].join();
  });
  expect(built === "symbol,rumb-shape-triangle,1.125,true", "shape and labels " + built);
  // Fire stations go on top; then the tracts take the focus back.
  await add("fire_stations_2020", "Fire stations");
  await p.click('[data-layer="tracts"]');
  await waitText("#legend .legend-others", "Fire stations", p);
  await waitText("#legend .legend-others", "Law enforcement sites", p);
  // A click on a fire station (not the focus) opens its popup; it can take the focus.
  const station = await p.evaluate(() => {
    const f = window.rumb.app.layerById("fire_stations_2020").collection.features[0];
    window.rumb.map.jumpTo({ center: f.geometry.coordinates, zoom: 13 });
    return f.properties.name;
  });
  await p.waitForTimeout(600);
  const box = await p.locator("#map").boundingBox();
  await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await waitText(".map-popup", station, p);
  await p.click(".map-popup button");
  await p.waitForFunction(() => window.rumb.state.active === "fire_stations_2020" && window.rumb.state.selected === "1");
  await waitText("#inspect-panel", station, p);
  // The PNG lists the other shown layers.
  const png = await download("#export-map", p);
  expect(png.length > 10000, "map image");
  await shot("symbology", p);
  await p.context().close();
});

await check("classes", async () => {
  const p = await openPage();
  const bar = () => p.$$eval("#legend .legend-bar i", (els) => els.map((e) => getComputedStyle(e).backgroundColor));
  await p.selectOption("#classification", "jenks");
  await p.selectOption("#class-count", "9");
  await p.waitForFunction(() => document.querySelectorAll("#legend .legend-bar i").length === 9);
  // Standard deviations on a diverging palette: the middle class is the neutral color.
  await p.selectOption("#class-count", "5");
  await p.selectOption("#classification", "sd");
  await p.click('[data-palette="RdBu"]');
  await p.waitForFunction(() => document.querySelectorAll("#legend .legend-bar i").length === 5);
  expect((await bar())[2] === "rgb(247, 247, 247)", "diverging middle " + (await bar())[2]);
  // Manual breaks start from the map's breaks and accept typed ones.
  await p.selectOption("#classification", "manual");
  expect((await p.inputValue("#manual-breaks")).split(",").length === 4, "manual breaks seeded");
  await p.fill("#manual-breaks", "10, 20, 40");
  await p.locator("#manual-breaks").dispatchEvent("change");
  await waitText("#legend .breaks", "20–<40", p);
  await waitText("#legend .breaks", "≥ 40", p);
  expect((await p.evaluate(() => window.rumb.state.breaks.join())) === "10,20,40", "breaks kept");
  await p.context().close();
});

await check("measure", async () => {
  const p = await openPage();
  await p.evaluate(() => window.rumb.map.jumpTo({ center: [-90.15, 32.3], zoom: 9 }));
  await p.keyboard.press("m");
  await p.locator("#tool-card:not([hidden])").waitFor();
  const box = await p.locator("#map").boundingBox();
  for (const pt of [[-90.3, 32.2], [-90.0, 32.2], [-90.0, 32.4]]) {
    const xy = await p.evaluate((q) => window.rumb.map.project(q), pt);
    await p.mouse.click(box.x + xy.x, box.y + xy.y);
  }
  await p.keyboard.press("Enter");
  await waitText("#tool-card", "Measure again", p);
  // The readout matches the same measurement made outside the browser.
  const points = await p.evaluate(() => window.rumb.app.tools.sketch.points);
  expect(points.length === 3, "three points");
  const region = JSON.parse(await dataFile("catalog.json")).region;
  const m = measurePath(points, transverseMercator(region.projection.tmerc));
  expect((await p.textContent("#measure-distance")) === formatMiles(m.miles), "distance");
  expect((await p.textContent("#measure-area")) === formatMiles(m.squareMiles, "sq mi"), "area");
  expect(m.miles > 25 && m.miles < 35, "about 31 miles: " + m.miles);
  // Clicks while measuring do not select features.
  expect((await p.evaluate(() => window.rumb.state.selected)) == null, "measuring selected a feature");
  await p.context().close();
});

await check("locate", async () => {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 850 },
    geolocation: { latitude: 32.3, longitude: -90.18, accuracy: 30 },
    permissions: ["geolocation"],
  });
  const p = await ctx.newPage();
  p.setDefaultTimeout(35000);
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base);
  await ready(p);
  await p.keyboard.press("g");
  await waitText("#toast", "You are at", p);
  const me = await p.evaluate(() => window.rumb.app.tools.located);
  expect(Math.abs(me.lonlat[0] + 90.18) < 1e-6 && Math.abs(me.lonlat[1] - 32.3) < 1e-6, "position");
  await p.waitForFunction(() => window.rumb.map.querySourceFeatures("locate").length >= 2);
  // Your position is never part of the saved state.
  expect(!JSON.stringify(await p.evaluate(() => window.rumb.state)).includes("-90.18"), "position in state");
  await ctx.close();
});

await check("goto", async () => {
  const p = await openPage();
  await p.keyboard.press("Control+k");
  await p.keyboard.type("32.3, -90.18");
  await p.locator("#palette-list li", { hasText: "90.18000" }).first().click();
  await waitText("#toast", "Showing", p);
  await p.waitForFunction(() => {
    const c = window.rumb.map.getCenter();
    return Math.abs(c.lng + 90.18) < 0.01 && Math.abs(c.lat - 32.3) < 0.01;
  });
  await p.context().close();
});

await check("filters", async () => {
  const ref = JSON.parse(await readFile("tests/filter-reference.json", "utf8"));
  const p = await openPage();
  const add = async (id, name) => {
    await p.keyboard.press("n");
    await p.click(`[data-library="${id}"]`);
    await waitText("#toast", "Added " + name, p);
  };
  await add("fire_stations_2020", "Fire stations");
  const count = (id) => p.textContent(`[data-count="${id}"] dd`);
  // C arms a click for the center; the panel then counts what is kept.
  await p.keyboard.press("c");
  await waitText("#tool-card", "Radius filter", p);
  const box = await p.locator("#map").boundingBox();
  const xy = await p.evaluate(() => window.rumb.map.project([-90.18, 32.3]));
  await p.mouse.click(box.x + xy.x, box.y + xy.y);
  await p.waitForFunction(() => window.rumb.state.filter?.kind === "radius");
  await p.waitForFunction(() => window.rumb.map.querySourceFeatures("filter").length > 0);
  // Exactly at Jackson, the counts match GEOS.
  await p.evaluate((c) => window.rumb.app.filter.set({ kind: "radius", center: c, miles: 25 }), ref.center);
  expect((await count("fire_stations_2020")) === ref.stations25.length + " of 1,043", "25 mi: " + (await count("fire_stations_2020")));
  await p.locator("#filter-miles").fill("50");
  await p.locator("#filter-miles").dispatchEvent("input");
  await waitText('[data-count="fire_stations_2020"]', ref.stations50.length + " of", p);
  await p.check("#filter-hide");
  await p.waitForFunction(
    (n) => new Set(window.rumb.map.querySourceFeatures("lyr-fire_stations_2020").map((f) => f.properties.__rumb_id)).size <= n,
    ref.stations50.length,
  );
  await p.uncheck("#filter-hide");
  // B buffers the selection: stations within 5 miles of Hinds County.
  await add("chr_counties_2025", "County Health Rankings");
  await p.evaluate(() => window.rumb.app.selectFeature("28049"));
  await p.keyboard.press("b");
  await p.waitForFunction(() => window.rumb.state.filter?.kind === "buffer");
  await waitText('[data-count="fire_stations_2020"]', ref.stationsNearHinds.length + " of", p);
  await p.waitForFunction(() => window.rumb.map.querySourceFeatures("filter").length > 0);
  // D draws an area by clicking its corners; the drawn area matches GEOS too.
  await p.keyboard.press("d");
  for (const pt of ref.ring.slice(0, 3)) {
    const q = await p.evaluate((c) => window.rumb.map.project(c), pt);
    await p.mouse.click(box.x + q.x, box.y + q.y);
  }
  await p.keyboard.press("Enter");
  await p.waitForFunction(() => window.rumb.state.filter?.kind === "polygon");
  await p.evaluate((ring) => window.rumb.app.filter.set({ kind: "polygon", ring }), ref.ring);
  await waitText('[data-count="fire_stations_2020"]', ref.stationsInArea.length + " of", p);
  await waitText('[data-count="chr_counties_2025"]', ref.countiesInArea.length + " of", p);
  await p.waitForFunction(() => window.rumb.map.querySourceFeatures("filter").some((f) => f.geometry.type === "Polygon"));
  await p.waitForTimeout(700);
  await shot("filters", p);
  await p.keyboard.press("x");
  await p.waitForFunction(() => window.rumb.state.filter === null);
  expect(!(await p.locator("[data-count]").count()), "counts after clearing");
  await p.context().close();
});

await check("pooled", async () => {
  const ref = JSON.parse(await readFile("tests/counts-reference.json", "utf8"));
  const p = await openPage();
  const add = async (id, name) => {
    await p.keyboard.press("n");
    await p.click(`[data-library="${id}"]`);
    await waitText("#toast", "Added " + name, p);
  };
  await add("chr_counties_2025", "County Health Rankings");
  // One county pooled with its neighbors, then a second county added with Shift.
  await p.evaluate((id) => window.rumb.app.selectFeature(id), ref.selected);
  await waitText("#inspect-panel", "Pooled with neighbors", p);
  const pct = (v) => (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, "") + "%";
  const cells = () => p.$$eval('[data-pool="v085_rawvalue"] td', (tds) => tds.map((td) => td.textContent));
  await p.waitForFunction(() => document.querySelectorAll('[data-pool="v085_rawvalue"] td').length === 3);
  const want = ["selected", "neighbors", "total"].map((k) => pct(ref.pooled.v085_rawvalue[k].value));
  expect((await cells()).join() === want.join(), "pooled uninsured " + (await cells()) + " vs " + want);
  await p.evaluate(() => window.rumb.app.togglePick("28121"));
  await waitText("#inspect-panel", "2 areas selected", p);
  await p.waitForFunction(
    () => new Set(window.rumb.map.querySourceFeatures("selection").filter((f) => f.properties.role === "selected").map((f) => f.properties.id)).size === 2,
  );
  // Q counts the fire stations in each county, as GEOS does.
  await add("fire_stations_2020", "Fire stations");
  await p.click('[data-layer="chr_counties_2025"]');
  await p.keyboard.press("q");
  await waitText("#legend", "Fire stations (count)", p);
  const counted = await p.evaluate(() =>
    Object.fromEntries(window.rumb.app.layer().collection.features.map((f) => [f.id, f.properties.count_fire_stations_2020])),
  );
  expect(JSON.stringify(counted) === JSON.stringify(ref.counties), "county counts");
  expect(await p.evaluate(() => window.rumb.app.fieldList(window.rumb.app.layer()).includes("rate_fire_stations_2020")), "rate per 10,000");
  // A filter's features can become the selection.
  await p.evaluate(() => window.rumb.app.filter.set({ kind: "radius", center: [-90.18, 32.3], miles: 25 }));
  await p.click("#filter-select");
  await waitText("#inspect-panel", "areas selected", p);
  await p.keyboard.press("q");
  await p.waitForFunction(() => !window.rumb.app.layer().countFields);
  await p.context().close();
});

await check("tables", async () => {
  const places = JSON.parse(await dataFile("tables/tracts-places.json"));
  const p = await openPage();
  await p.waitForSelector('#measure optgroup[label="ACS 2020–2024 profile"] option[value="acs_uninsured_pct"]', { state: "attached" });
  await p.selectOption("#measure", "places_diabetes");
  await waitText("#legend", "Diagnosed diabetes", p);
  const drawn = await p.evaluate(() =>
    window.rumb.app.layer().collection.features.filter((f) => Number.isFinite(f.properties.places_diabetes)).length,
  );
  expect(drawn === 870, "PLACES values on " + drawn + " tracts");
  await p.evaluate((id) => window.rumb.app.selectFeature(id), ids[0]);
  await waitText("#inspect-panel", "95% confidence interval", p);
  await waitText("#inspect-panel", "Model-based", p);
  // Two tracts pool as an adult-population-weighted mean.
  await p.evaluate((list) => window.rumb.app.selectMany(list), [ids[0], ids[1]]);
  const i = [0, 1].map((k) => places.ids.indexOf(ids[k]));
  const w = i.map((k) => places.columns.places_pop18[k]),
    v = i.map((k) => places.columns.places_diabetes[k]);
  const want = ((v[0] * w[0] + v[1] * w[1]) / (w[0] + w[1])).toFixed(1).replace(/\.0$/, "") + "%";
  await p.waitForFunction(() => document.querySelector('[data-pool="places_diabetes"] td'));
  const got = await p.$eval('[data-pool="places_diabetes"] td', (td) => td.textContent);
  expect(got === want, "pooled diabetes " + got + " vs " + want);
  // SQL sees the tables as views keyed by GEOID.
  await p.evaluate(() => window.rumb.app.store.set({ sql: "SELECT count(*) AS n, round(avg(acs_uninsured_pct), 3) AS u FROM tract_acs JOIN tracts USING (GEOID)" }));
  await p.evaluate(() => window.rumb.app.setView("sql"));
  await p.click("#run-query");
  await waitText("#work-content", "878", p);
  await p.context().close();
  // A shared link with a table field reads that table before drawing.
  const q = await openPage();
  await q.evaluate(async () => {
    await window.rumb.app.setMeasure("acs_no_vehicle_pct");
  });
  await q.keyboard.press("u");
  await q.locator("#share-link").waitFor();
  const url = await q.inputValue("#share-link");
  await q.context().close();
  const r = await openPage();
  await r.goto(url.replace(/^https?:\/\/[^/]+/, origin));
  await ready(r);
  await waitText("#toast", "Opened a shared map", r);
  await waitText("#legend", "Households with no vehicle", r);
  const restored = await r.evaluate(() => window.rumb.app.layer().collection.features.some((f) => Number.isFinite(f.properties.acs_no_vehicle_pct)));
  expect(restored, "shared table field has values");
  await r.context().close();
});

await check("share", async () => {
  const p = await openPage();
  await p.keyboard.press("n");
  await p.click('[data-library="fire_stations_2020"]');
  await waitText("#toast", "Added Fire stations", p);
  await p.click("#look summary");
  await p.selectOption("#look-shape", "diamond");
  await p.click('[data-layer="tracts"]');
  await p.click('[data-palette="Viridis"]');
  await p.selectOption("#classification", "jenks");
  await p.evaluate(() => window.rumb.app.filter.set({ kind: "radius", center: [-90.18, 32.3], miles: 25 }));
  await p.evaluate((id) => window.rumb.app.selectFeature(id), ids[0]);
  await p.evaluate(() => window.rumb.map.jumpTo({ center: [-89.5, 32.1], zoom: 8.25 }));
  await p.keyboard.press("u");
  await p.locator("#share-link").waitFor();
  const url = await p.inputValue("#share-link");
  expect(/#state=1\.[A-Za-z0-9_-]+$/.test(url) && url.length < 1200, "link " + url.length);
  // Another browser opens it; the state never leaves the address bar.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  const q = await ctx.newPage();
  q.setDefaultTimeout(35000);
  q.on("pageerror", (e) => errors.push(e.message));
  const sent = [];
  q.on("request", (r) => sent.push(r.url()));
  await q.goto(url.replace(/^https?:\/\/[^/]+/, origin));
  await ready(q);
  await waitText("#toast", "Opened a shared map", q);
  const got = await q.evaluate(() => {
    const s = window.rumb.state;
    const c = window.rumb.map.getCenter();
    return {
      stack: s.stack.map((e) => e.id + (e.style?.shape ? ":" + e.style.shape : "")).join(),
      active: s.active,
      palette: s.palette,
      classification: s.classification,
      filter: s.filter?.kind + " " + s.filter?.miles,
      selected: s.selected,
      camera: [c.lng.toFixed(2), c.lat.toFixed(2), window.rumb.map.getZoom().toFixed(2)].join(),
      hash: location.hash,
    };
  });
  const want = {
    stack: "tracts,fire_stations_2020:diamond",
    active: "tracts",
    palette: "Viridis",
    classification: "jenks",
    filter: "radius 25",
    selected: ids[0],
    camera: "-89.50,32.10,8.25",
    hash: "",
  };
  expect(JSON.stringify(got) === JSON.stringify(want), "opened " + JSON.stringify(got));
  await waitText('[data-count="fire_stations_2020"]', "88 of", q);
  expect(!sent.some((u) => /state=/.test(u)), "the shared state reached a server");
  await ctx.close();
  await p.context().close();
});

await check("exports", async () => {
  const ref = JSON.parse(await readFile("tests/filter-reference.json", "utf8"));
  const p = await openPage();
  await p.keyboard.press("n");
  await p.click('[data-library="fire_stations_2020"]');
  await waitText("#toast", "Added Fire stations", p);
  await p.evaluate((c) => window.rumb.app.filter.set({ kind: "radius", center: c, miles: 25 }), ref.center);
  // CSV of what the filter keeps, with distances and the drawn color.
  await p.keyboard.press("w");
  expect((await p.inputValue("#export-scope")) === "filtered", "filtered by default");
  const csv = csvRows(await download("#export-go", p));
  expect(csv.length === ref.stations25.length, "CSV rows " + csv.length);
  expect(JSON.stringify(csv.map((r) => r.id).sort()) === JSON.stringify(ref.stations25), "CSV ids");
  expect(csv.every((r) => Number(r.distance_mi) <= 25 && /^#[0-9a-f]{6}$/i.test(r.style_color) && r.lon && r.lat), "CSV columns");
  // GeoJSON of all of them.
  await p.keyboard.press("w");
  await p.selectOption("#export-scope", "all");
  await p.selectOption("#export-format", "geojson");
  const geo = JSON.parse((await download("#export-go", p)).toString("utf8"));
  expect(geo.features.length === 1043 && geo.features[0].geometry.type === "Point", "GeoJSON");
  // GeoParquet, written by DuckDB, reads back in with its geometry.
  await p.keyboard.press("w");
  await p.selectOption("#export-format", "parquet");
  const parquet = await download("#export-go", p);
  expect(parquet.subarray(0, 4).toString() === "PAR1", "a Parquet file");
  await p.setInputFiles("#file-picker", { name: "kept.parquet", mimeType: "application/octet-stream", buffer: parquet });
  await waitText("#work-content", "Table preview", p);
  await waitText("#work-content", ref.stations25.length + " rows", p);
  await p.context().close();
});

await check("report", async () => {
  const p = await openPage();
  await p.evaluate(() => window.rumb.app.filter.set({ kind: "radius", center: [-90.18, 32.3], miles: 10 }));
  await p.evaluate(() => (window.print = () => (window.__printed = true)));
  await p.keyboard.press("p");
  await p.locator("#report-print").waitFor();
  await p.fill("#report-notes", "Checked on site.");
  await p.click("#report-print");
  await p.waitForFunction(() => window.__printed === true);
  const sections = await p.$$eval("#print-root [data-section]", (els) => els.map((e) => e.dataset.section));
  expect(sections.join() === "map,legend,summary,features,counts,sources,notes", "sections " + sections);
  // The report is hidden on screen; it shows only when printing.
  expect((await p.textContent("#print-root")).includes("Kept by the filter"), "filtered features in the report");
  expect((await p.$eval("#print-root .print-map", (img) => img.src.length)) > 10000, "map image");
  // Printing shows only the report.
  await p.emulateMedia({ media: "print" });
  const shown = await p.evaluate(() => [getComputedStyle(document.querySelector("#print-root")).display, getComputedStyle(document.querySelector("#map-view")).display]);
  expect(shown.join() === "block,none", "print layout " + shown);
  if (which === "chromium") {
    const pdf = await p.pdf({ format: "Letter" });
    expect(pdf.length > 20000 && pdf.subarray(0, 4).toString() === "%PDF", "PDF");
  }
  await p.context().close();
});

// ---- compare -----------------------------------------------------------------
await check("compare", async () => {
  const p = await openPage();
  const places = [];
  p.on("request", (r) => {
    if (r.url().includes("places-2025.json")) places.push(r.url());
  });
  expect(places.length === 0, "PLACES fetched before Compare opened");
  await p.click('[data-view="compare"]');
  await waitText("#cmp-count", "870 of 878", p);
  expect((await p.locator("#cmp-plot circle").count()) === 870, "870 plot points");
  let rows = csvRows(await download("#cmp-export", p));
  expect(rows.length === 878, `CSV rows ${rows.length}`);
  expect(rows.filter((r) => r.exclusion_reason).length === 8, "8 unranked");
  await p.check("#cmp-unranked");
  expect((await p.locator("#cmp-table tbody tr").count()) === 8, "unranked filter");
  await p.uncheck("#cmp-unranked");
  await p.click('[data-sort="name"]');
  expect(
    (await p
      .locator('[data-sort="name"]')
      .evaluate((b) => b.parentNode.getAttribute("aria-sort"))) === "ascending",
    "name sort",
  );
  await p.click('[data-sort="rank"]');
  const first = p.locator("#cmp-table tbody tr").first();
  const id = await first.getAttribute("data-id");
  expect(id === "28121020500", `top tract ${id}`);
  await first.locator("button").click();
  await waitText("#cmp-details", "90% MOE", p);
  await waitText("#cmp-details", "95% CI", p);
  const dot = p.locator(`#cmp-plot circle[data-id="${id}"]`);
  const second = p.locator("#cmp-table tbody tr").nth(1).locator("button");
  await second.click();
  await waitText("#cmp-selection", "2 selected", p);
  await second.click();
  await dot.click({ force: true });
  await waitText("#cmp-selection", "0 selected", p);
  await first.locator("button").click();
  await p.selectOption("#cmp-color", "quadrant");
  await p.focus("#cmp-split");
  const prev = await p.locator("#cmp-panel").boundingBox();
  await p.keyboard.press("ArrowLeft");
  expect((await p.locator("#cmp-panel").boundingBox()).width > prev.width, "splitter key");
  await chooseSettings(
    p,
    ["poverty_pct", "housing_insecurity_pct", "food_insecurity_pct"],
    [40, 35, 25],
    ["higher", "lower", "higher"],
  );
  rows = csvRows(await download("#cmp-export", p));
  expect(rows[0].component_2_direction === "lower", "direction in CSV");
  await p.fill("#cmp-weight-0", "5");
  await p.click("#cmp-apply");
  await waitText("#cmp-error", "100", p);
  compareProject = await download("#save-project", p);
  await shot("compare", p);
  page = p;
});

await check("compare-restore", async () => {
  if (!compareProject) return "skip";
  const p = await openPage();
  await p.route("**/places-2025.json", (r) => r.abort());
  await restore(p, compareProject);
  await waitText("#cmp-selection", "1 selected", p);
  expect((await p.inputValue("#cmp-field-2")) === "food_insecurity_pct", "restored field");
  expect((await p.inputValue("#cmp-color")) === "quadrant", "restored color mode");
  await p.context().close();
});

await check("compare-districts", async () => {
  const p = page;
  await p.setInputFiles("#file-picker", {
    name: "districts.geojson",
    mimeType: "application/geo+json",
    buffer: Buffer.from(JSON.stringify(districts)),
  });
  await p.click("#map-source");
  await p.locator("#map-view:not([hidden])").waitFor();
  await p.click('[data-view="compare"]');
  await chooseSettings(p, ["need", "reach", "capacity"], [40, 35, 25], ["higher", "lower", "higher"]);
  await waitText("#cmp-count", "3 of 4", p);
  const rows = csvRows(await download("#cmp-export", p));
  expect(rows.filter((r) => r.exclusion_reason).length === 1, "1 excluded district");
  expect(rows[0].area_name === "District B", `top district ${rows[0].area_name}`);
  await p.click("#fit");
  await p.waitForTimeout(750);
  const box = await p.locator("#map").boundingBox();
  await p.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.5);
  await waitText("#cmp-selection", "1 selected", p);
  await waitText("#cmp-details", "District A", p);
  await p.check("#cmp-only");
  expect((await p.locator("#cmp-table tbody tr").count()) === 1, "selected-only filter");
  await p.selectOption("#cmp-layer", "tracts");
  await waitText("#cmp-selection", "1 selected", p);
});

await check("compare-mobile", async () => {
  const p = page;
  await p.setViewportSize({ width: 390, height: 844 });
  expect(await noOverflow(p), "page wider than a 390px phone");
  const mobile = await p.locator("#cmp-panel").boundingBox();
  expect(mobile.y >= (await p.locator("#map").boundingBox()).height, "panel below map");
  await p.focus("#cmp-split");
  await p.keyboard.press("ArrowUp");
  expect((await p.locator("#cmp-panel").boundingBox()).height > mobile.height, "splitter key");
  await p.setViewportSize({ width: 1440, height: 960 });
});

await check("legacy-project", async () => {
  const p = await openPage();
  await restore(p, await legacyProject());
  expect((await p.inputValue("#measure")) === "child_poverty_pct", "legacy measure");
  // A project saved by today's writer still opens when it carries the old .bgis name.
  if (savedProject) {
    await restore(p, savedProject, "measures.bgis");
    await waitText("#map-title", "measures by tract", p);
  }
  await p.context().close();
});

// ---- the shell: themes, palette, keys, status bar --------------------------------
const THEMES = ["terminal", "terminal-night", "terminal-day", "hud", "fieldkit", "starship"];
await check("themes", async () => {
  const p = await openPage();
  await p.click("#analyze");
  await waitText("#inspect-panel", "0.2768", p);
  await p.click("#find-feature");
  await p.fill("#find-term", ids[0]);
  await p.locator("#find-results button").first().click();
  for (const theme of THEMES) {
    await p.evaluate((t) => window.rumb.appearance({ theme: t }), theme);
    const repainted = await p.evaluate(
      () =>
        window.rumb.map.getPaintProperty("ocean", "background-color") ===
        getComputedStyle(document.documentElement).getPropertyValue("--map-water").trim(),
    );
    expect(repainted, `${theme}: map backdrop did not follow the theme`);
    const roads = await p.evaluate(
      () =>
        window.rumb.map.getPaintProperty("roads-primary", "line-color") ===
        getComputedStyle(document.documentElement).getPropertyValue("--map-road").trim(),
    );
    expect(roads, `${theme}: roads did not follow the theme`);
    expect(
      (await p.evaluate(() => document.documentElement.dataset.theme)) === theme,
      `${theme} not applied`,
    );
    await p.waitForTimeout(300);
    await shot("theme-" + theme, p);
  }
  // The choice is remembered for the next visit.
  await p.reload();
  await ready(p);
  expect((await p.evaluate(() => document.documentElement.dataset.theme)) === "starship", "theme not kept");
  await p.context().close();
});

await check("palette", async () => {
  const p = await openPage();
  await p.keyboard.press("Control+k");
  await p.locator("#palette[open]").waitFor();
  await p.keyboard.type("sql edit");
  await p.keyboard.press("Enter");
  await p.locator("#sql-input").waitFor();
  expect((await p.evaluate(() => window.rumb.state.view)) === "sql", "palette did not open SQL");
  // Places are found by name, and choosing one selects it on the map.
  await p.keyboard.press("Control+k");
  await p.keyboard.type(ids[0]);
  await p.locator("#palette-list li", { hasText: ids[0] }).first().click();
  await waitText("#inspect-panel", "Adams County", p);
  await p.context().close();
});

await check("keys", async () => {
  const p = await openPage();
  await p.keyboard.press("3");
  await waitText("#work-content", "rows", p);
  await p.keyboard.press("1");
  await p.locator("#map-view:not([hidden])").waitFor();
  await p.keyboard.press("?");
  await p.locator("#dialog[open] .help-sheet").waitFor();
  await p.keyboard.press("Escape");
  await p.locator("#dialog:not([open])").waitFor({ state: "attached" });
  await p.keyboard.press("r");
  await waitText("#inspect-panel", "0.2768", p);
  const before = await p.evaluate(() => document.documentElement.dataset.theme);
  await p.keyboard.press("t");
  const after = await p.evaluate(() => document.documentElement.dataset.theme);
  expect(before !== after, "T did not change the theme");
  // Keys typed into a text box stay there.
  await p.keyboard.press("4");
  await p.click("#sql-input");
  await p.keyboard.type("1");
  expect((await p.evaluate(() => window.rumb.state.view)) === "sql", "a key in the editor switched views");
  await p.context().close();
});

await check("statusbar", async () => {
  const p = await openPage();
  const box = await p.locator("#map").boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.locator("#sb-coords span", { hasText: /\d+\.\d{5} N/ }).waitFor();
  await p.click("#sb-coords");
  await p.mouse.move(box.x + box.width / 2 + 5, box.y + box.height / 2);
  await p.locator("#sb-coords span", { hasText: /°.*″N/ }).waitFor();
  expect(/^\d+\.\d$/.test(await p.textContent("#sb-zoom span")), "zoom readout");
  expect((await p.textContent("#sb-db span")) === "idle", "database idle before use");
  await p.click("#analyze");
  await waitText("#sb-time", "lisa", p);
  await p.keyboard.press("4");
  await p.click("#run-query");
  await waitText("#sb-db", "ready", p);
  await waitText("#sb-state", "READY", p);
  await p.context().close();
});

await check("narrow", async () => {
  const p = await openPage({ width: 320, height: 640 });
  expect(await noOverflow(p), "page wider than 320px");
  await p.keyboard.press("4");
  expect(await noOverflow(p), "SQL view wider than 320px");
  await p.keyboard.press("2");
  await waitText("#cmp-count", "870", p);
  expect(await noOverflow(p), "Compare wider than 320px");
  await shot("narrow-320", p);
  await p.context().close();
});

// ---- offline -------------------------------------------------------------------
await check("offline", async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 850 }, serviceWorkers: "allow" });
  const p = await ctx.newPage();
  p.setDefaultTimeout(60000);
  p.on("pageerror", (e) => errors.push(e.message + " @ " + (e.stack || "").split("\n").slice(1, 3).join(" ").trim()));
  await p.goto(base);
  await ready(p);
  const controlled = await p
    .waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  if (!controlled) {
    await ctx.close();
    return "skip"; // this browser build does not run service workers under automation
  }
  await p.evaluate(() => window.rumb.runCommand("offline"));
  await waitText("#sb-net", "offline ready", p);
  await ctx.setOffline(true);
  await p.reload();
  await ready(p);
  await waitText("#foot-status", "878 features", p);
  await waitText("#sb-net", "OFFLINE", p);
  // DuckDB, its extensions and the GeoParquet come from the cache.
  await p.keyboard.press("4");
  await p.click("#run-query");
  await waitText("#query-grid", "Census Tract", p);
  // So do the statistics worker and GeoDaLib.
  await p.keyboard.press("1");
  await p.click("#analyze");
  await waitText("#inspect-panel", "0.2768", p);
  // The library, its layers, the roads, filters and the report work offline too.
  await p.keyboard.press("n");
  await p.click('[data-library="fire_stations_2020"]');
  await waitText("#toast", "Added Fire stations", p);
  await p.waitForFunction(() => window.rumb.map.querySourceFeatures("roads").length > 0);
  await p.evaluate(() => window.rumb.app.filter.set({ kind: "radius", center: [-90.18, 32.3], miles: 25 }));
  await waitText('[data-count="fire_stations_2020"]', "88 of", p);
  await p.evaluate(() => (window.print = () => (window.__printed = true)));
  await p.keyboard.press("p");
  await p.click("#report-print");
  await p.waitForFunction(() => window.__printed === true);
  await ctx.setOffline(false);
  await ctx.close();
});

// ---- across all checks --------------------------------------------------------
await check("same-origin", async () => {
  expect(external.size === 0, `requests to ${[...external].join(", ")}`);
});
if (errors.length) {
  failed++;
  console.log(`FAIL  page errors: ${errors.slice(0, 3).join(" | ")}`);
}
console.log(
  `${which}: ${passed}/${passed + failed} checks passed${skipped ? `, ${skipped} skipped` : ""}`,
);
await browser.close();
server.kill();
process.exit(failed ? 1 : 0);
