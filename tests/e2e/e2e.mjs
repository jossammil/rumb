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
  p.on("pageerror", (e) => errors.push(e.message));
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
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    requests.push(r.url());
    const u = new URL(r.url());
    if (/^https?:$/.test(u.protocol) && u.origin !== origin) external.add(u.origin);
  });
  pages.push(page);
  await page.goto(base);
  await waitText("#foot-status", "878 features");
  await ready(page);
  await page.waitForFunction(() => document.querySelector("#measure")?.options.length === 2);
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
      .filter((e) => /roads\.geojson|\/layers\//.test(e.name))
      .every((e) => e.startTime >= first - 1);
  });
  expect(late, "roads or layer files were requested before the first map");
  expect(!requests.some((u) => /\/layers\//.test(u)), "add-on layers loaded without being asked for");
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
  p.on("pageerror", (e) => errors.push(e.message));
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
