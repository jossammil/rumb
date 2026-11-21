import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, webkit } from "playwright";

const url = process.argv[2] || "http://127.0.0.1:4180/";
const artifactDir = await mkdtemp(join(tmpdir(), "bgis-check-"));
const browser = process.env.BGIS_WEBKIT
  ? await webkit.launch()
  : await chromium.launch({
      channel: "chrome",
      args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
    });
const page = await browser.newPage({
  viewport: { width: 1440, height: 960 },
  acceptDownloads: true,
});
const pageErrors = [],
  requests = [],
  localOrigin = new URL(url).origin;
page.on("pageerror", (err) => {
  pageErrors.push(err.message);
  console.error(err.message);
});
page.on("console", (msg) => {
  if (msg.type() === "error") console.error("browser:", msg.text());
});
page.on("request", (req) => requests.push(req.url()));
page.setDefaultTimeout(35000);
const ids = JSON.parse(
  await readFile(new URL("../public/data/tracts.geojson", import.meta.url)),
).features.map((f) => f.properties.GEOID);
async function waitText(selector, text, p = page) {
  await p.locator(selector).filter({ hasText: text }).first().waitFor();
}
async function download(selector, name, p = page) {
  const promise = p.waitForEvent("download");
  await p.click(selector);
  const d = await promise;
  const path = join(artifactDir, name);
  await d.saveAs(path);
  assert.ok((await stat(path)).size > 0);
  return path;
}
try {
  await page.goto(url);
  await waitText("#foot-status", "878 features");
  await page.waitForFunction(
    () => document.querySelector("#measure")?.options.length === 2,
  );
  await page.waitForFunction(
    () => performance.getEntriesByName("field-atlas-first-map").length,
  );
  const firstMap = await page.evaluate(() =>
    Math.round(
      performance.getEntriesByName("field-atlas-first-map")[0].startTime,
    ),
  );
  assert.ok(
    !requests.some((u) => /duckdb|geoda-lisa.*wasm/.test(u)),
    "map should precede analytics downloads",
  );
  await page.waitForTimeout(550);
  await page.screenshot({ path: join(artifactDir, "map.png") });
  console.log(
    "map ready",
    firstMap,
    "ms (fresh browser context), screenshots",
    artifactDir,
  );
  await page.click("#analyze");
  await waitText("#inspect-panel", "0.2768");
  await waitText("#inspect-panel", "872");
  await page.click("#find-feature");
  await page.fill("#find-term", ids[0]);
  await page.locator("#find-results button").first().click();
  await waitText("#inspect-panel", "Adams County");
  await waitText("#inspect-panel", "90% margin of error");
  await waitText("#inspect-panel", "Eligible neighbors");
  await download("#save-results", "cluster-results.csv");
  await page.selectOption("#rule", "rook");
  await page.click("#analyze");
  await waitText("#inspect-panel", "0.2846");
  await page.click("#fit");
  await page.waitForTimeout(550);
  await page.screenshot({ path: join(artifactDir, "clusters.png") });
  await download("#export-map", "map-export.png");
  await page.setInputFiles("#file-picker", {
    name: "measures.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "GEOID,service_rate\n" +
        ids.map((id, i) => id + "," + (i % 12)).join("\n"),
    ),
  });
  await waitText("#work-content", "Table preview");
  await page.click("#check-join");
  await waitText("#join-result", "878 matched");
  await page.click("#join-map");
  await waitText("#map-title", "measures by tract");
  assert.equal(await page.inputValue("#measure"), "service_rate");
  await page.click("#analyze");
  await waitText("#inspect-panel", "Global Moran");
  await page.click("#find-feature");
  await page.fill("#find-term", ids[0]);
  await page.locator("#find-results button").first().click();
  const project = await download("#save-project", "map.bgis");
  const fresh = await browser.newPage({
    viewport: { width: 1280, height: 850 },
    acceptDownloads: true,
  });
  fresh.on("pageerror", (err) => pageErrors.push(err.message));
  await fresh.goto(url);
  await waitText("#foot-status", "878 features", fresh);
  await fresh.setInputFiles("#project-picker", project);
  await waitText("#map-title", "measures by tract", fresh);
  await waitText("#inspect-panel", "Global Moran", fresh);
  await waitText("#inspect-panel", ids[0], fresh);
  assert.equal(await fresh.inputValue("#measure"), "service_rate");
  await fresh.click('[data-view="sql"]');
  await fresh.fill("#sql-input", "SELECT count(*) AS total FROM measures");
  await fresh.click("#run-query");
  await waitText("#query-grid", "878", fresh);
  const csv = await download("#export-query", "restored-query.csv", fresh);
  assert.match(await readFile(csv, "utf8"), /total\r?\n878/);
  await fresh.click('[data-view="map"]');
  await fresh.click('[data-layer="tracts"]');
  await waitText("#inspect-panel", "0.2846", fresh);
  await fresh.selectOption("#study", "county:Adams County");
  await fresh.selectOption("#measure", "child_poverty_pct");
  await fresh.click("#inference summary");
  await fresh.check("#fdr");
  await fresh.click("#analyze");
  await waitText("#inspect-panel", "FDR-adjusted q", fresh);
  await waitText("#inspect-panel", "Adams County", fresh);
  await fresh.close();
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
  assert.equal(await page.inputValue("#measure"), "point_count");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click("#mobile-settings");
  await page.click('[data-layer="tracts"]');
  await page.click("#mobile-settings");
  await page.click("#close-side");
  await page.waitForTimeout(400);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await page.screenshot({ path: join(artifactDir, "mobile.png") });
  const external = requests.filter(
    (u) => /^https?:/.test(u) && new URL(u).origin !== localOrigin,
  );
  assert.deepEqual([...new Set(external)], []);
  assert.deepEqual(pageErrors, []);
  console.log(
    "PASS: map, both neighbor rules, inspect selection, CSV/PNG, complete table join, mapped points, archive restoration, restored SQL, mobile layout, same-origin assets.",
  );
} catch (error) {
  console.error(
    "Status:",
    await page.locator("#foot-status").textContent(),
    "Toast:",
    await page.locator("#toast").textContent(),
  );
  await page.screenshot({ path: join(artifactDir, "error.png") });
  throw error;
} finally {
  await browser.close();
}
