// Review screenshots for design/screens/<stage>/: every theme on the cluster
// map, then Compare, SQL, the palette and a phone; then stacked library
// layers, a filter, a pooled selection, natural breaks, measuring and a
// 320px phone; then the statistics (tract tables, hot spots, bivariate and
// EB clusters, hatching, smoothing and the scan; regressions, count models,
// access, point patterns and density), as numbered JPEGs. Not a test; run
// after `npm run build` when the look changes:
//   node scripts/screens.mjs stats-b
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";

const stage = process.argv[2] || "latest";
const dir = `design/screens/stage-${stage}`;
await mkdir(dir, { recursive: true });
const port = 4600 + Math.floor(Math.random() * 300);
const server = spawn(process.execPath, ["scripts/serve.mjs"], {
  env: { ...process.env, RUMB_PORT: String(port) },
  stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 500));
const browser = await chromium.launch({
  ...(existsSync("/Applications/Google Chrome.app") ? { channel: "chrome" } : {}),
  args: ["--use-angle=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`http://127.0.0.1:${port}/rumb/`);
await page.waitForFunction(() => window.rumb?.timings.firstMap, null, { timeout: 60000 });
let n = 0;
const shot = (name) => page.screenshot({ path: `${dir}/${++n}-${name}.jpg`, type: "jpeg", quality: 82 });

await page.click("#analyze");
await page.locator("#inspect-panel", { hasText: "0.2768" }).waitFor();
await page.evaluate(() => window.rumb.app.selectFeature("28049010100"));
for (const theme of ["terminal", "terminal-night", "terminal-day", "hud", "fieldkit", "starship"]) {
  await page.evaluate((t) => window.rumb.appearance({ theme: t }), theme);
  await page.waitForTimeout(400);
  await shot("theme-" + theme);
}
await page.evaluate(() => window.rumb.appearance({ theme: "terminal" }));
await page.keyboard.press("2");
await page.locator("#cmp-count", { hasText: "870" }).waitFor();
await page.waitForTimeout(400);
await shot("compare");
await page.keyboard.press("4");
await page.click("#run-query");
await page.locator("#query-grid table").waitFor({ timeout: 60000 });
await shot("sql");
await page.keyboard.press("1");
await page.keyboard.press("Control+k");
await page.keyboard.type("hinds");
await page.waitForTimeout(200);
await shot("palette");
await page.keyboard.press("Escape");
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(500);
await shot("phone");

// Map parity: library layers, styles, filters, pooled selections, field tools.
await page.setViewportSize({ width: 1440, height: 900 });
const add = async (id) => {
  await page.keyboard.press("n");
  await page.click(`[data-library="${id}"]`);
  await page.locator("#toast", { hasText: "Added" }).waitFor();
  await page.waitForTimeout(300);
};
await page.evaluate(() => window.rumb.runCommand("clear-selection"));
await add("chr_counties_2025");
await add("fire_stations_2020");
await page.click("#look summary");
await page.selectOption("#look-shape", "triangle");
await page.evaluate(() => window.rumb.map.jumpTo({ center: [-90.1, 32.35], zoom: 7.4 }));
await page.waitForTimeout(800);
await shot("stacked-layers");
await page.click('[data-layer="chr_counties_2025"]');
await page.evaluate(() => window.rumb.app.filter.set({ kind: "radius", center: [-90.18, 32.3], miles: 25 }));
await page.waitForTimeout(800);
await shot("filter-radius");
await page.evaluate(() => {
  window.rumb.app.filter.clear();
  window.rumb.app.selectFeature("28049");
  window.rumb.app.togglePick("28121");
});
await page.waitForTimeout(800);
await shot("pooled-selection");
await page.click('[data-layer="tracts"]');
await page.evaluate(() => {
  window.rumb.runCommand("clear-selection");
  window.rumb.app.store.set({ mode: "value", inspector: false });
  window.rumb.app.toggleLayer("chr_counties_2025");
  window.rumb.app.toggleLayer("fire_stations_2020");
});
await page.selectOption("#classification", "jenks");
await page.selectOption("#class-count", "9");
await page.click('[data-palette="RdBu"]');
await page.evaluate(() => window.rumb.map.jumpTo({ center: [-89.7, 32.6], zoom: 6.4 }));
await page.waitForTimeout(800);
await shot("natural-breaks");
await page.evaluate(() => window.rumb.map.jumpTo({ center: [-90.15, 32.3], zoom: 9 }));
await page.keyboard.press("m");
const box = await page.locator("#map").boundingBox();
for (const pt of [[-90.3, 32.2], [-90.0, 32.2], [-90.0, 32.4]]) {
  const xy = await page.evaluate((q) => window.rumb.map.project(q), pt);
  await page.mouse.click(box.x + xy.x, box.y + xy.y);
}
await page.keyboard.press("Enter");
await page.waitForTimeout(500);
await shot("measure");
await page.evaluate(() => window.rumb.app.tools.stop());
await page.setViewportSize({ width: 320, height: 720 });
await page.waitForTimeout(500);
await shot("phone-320");

// Statistics: tract tables, weights, hot spots, variants, smoothing, hatching and the scan.
await page.setViewportSize({ width: 1440, height: 900 });
const runAnalysis = async (text) => {
  await page.click("#analyze");
  await page.locator("#inspect-panel", { hasText: text }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(600);
};
await page.evaluate(() => window.rumb.map.jumpTo({ center: [-89.7, 32.6], zoom: 6.4 }));
await page.evaluate(() => window.rumb.app.setMeasure("places_diabetes"));
await page.click('[data-palette="Lagoon"]');
await page.selectOption("#classification", "quantile");
await page.selectOption("#class-count", "5");
await page.evaluate(() => window.rumb.app.selectFeature("28049010100"));
await page.waitForTimeout(800);
await shot("places-table");
await page.evaluate(() => window.rumb.app.setMeasure("acs_uninsured_pct"));
await page.selectOption("#rule", "knn");
await page.evaluate(() => window.rumb.runCommand("clear-selection"));
await page.keyboard.press("h");
await page.locator("#inspect-panel", { hasText: "Hot spot analysis" }).waitFor();
await page.waitForTimeout(800);
await shot("hot-spots-knn");
await page.evaluate(() => window.rumb.app.setMeasure("poverty_pct"));
await page.selectOption("#method", "bilisa");
await page.selectOption("#y-field", "places_diabetes");
await runAnalysis("Bivariate Moran");
await shot("bivariate-clusters");
await page.selectOption("#method", "eblisa");
await page.selectOption("#rule", "queen");
await runAnalysis("EB Moran");
await shot("eb-clusters");
await page.evaluate(() => {
  window.rumb.app.store.set({ mode: "value" });
  window.rumb.app.setMeasure("child_poverty_pct");
});
await page.check("#look-hatch");
await page.evaluate(() => window.rumb.map.jumpTo({ center: [-90.2, 32.33], zoom: 9.2 }));
await page.waitForTimeout(800);
await shot("hatched-acs");
await page.uncheck("#look-hatch");
await page.evaluate(() => {
  window.rumb.app.toggleLayer("chr_counties_2025");
  window.rumb.map.jumpTo({ center: [-89.7, 32.6], zoom: 6.4 });
});
await page.click('[data-layer="chr_counties_2025"]');
await page.evaluate(() => window.rumb.app.setMeasure("v138_rawvalue"));
await page.click("#smooth-rate");
await page.selectOption("#smooth-measure", "v138_rawvalue");
await shot("smooth-dialog");
await page.click("#smooth-go");
await page.locator("#legend", { hasText: "empirical Bayes" }).waitFor();
await page.waitForTimeout(600);
await shot("smoothed-rate");
await page.evaluate(() => window.rumb.app.setMeasure("v138_rawvalue"));
await page.selectOption("#method", "scan");
await page.selectOption("#scan-pop", "0.5");
await runAnalysis("Most likely");
await shot("scan-clusters");
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(600);
await shot("scan-phone");

// Statistics, part B: regressions, count models, access, point patterns and density.
await page.setViewportSize({ width: 1440, height: 900 });
const covariates = async (list) => {
  await page.waitForSelector("#covariates");
  for (const x of list) await page.check(`[data-covariate="${x}"]`);
};
await page.click('[data-layer="tracts"]');
// Tract regressions show with the counties hidden; the county model shows them again.
await page.evaluate(() => {
  window.rumb.app.toggleLayer("chr_counties_2025");
  window.rumb.app.setMeasure("places_diabetes");
});
await page.selectOption("#method", "model");
await page.selectOption("#rule", "queen");
await covariates(["acs_uninsured_pct", "acs_age65_pct", "acs_no_vehicle_pct", "acs_bachelors_pct"]);
await page.evaluate(() => window.rumb.map.jumpTo({ center: [-89.7, 32.6], zoom: 6.4 }));
await runAnalysis("R² · adjusted");
await shot("regression-ols");
await page.selectOption("#model-type", "lag");
await runAnalysis("ρ (rho)");
await page.locator('[data-table^="Impacts"]').scrollIntoViewIfNeeded();
await shot("regression-lag-impacts");
await page.evaluate(() => window.rumb.app.toggleLayer("chr_counties_2025"));
await page.click('[data-layer="chr_counties_2025"]');
await page.evaluate(() => window.rumb.app.setMeasure("v138_rawvalue"));
await page.selectOption("#method", "model");
await page.selectOption("#model-type", "nb");
await covariates(["v085_rawvalue", "v023_rawvalue", "v058_rawvalue"]);
await runAnalysis("θ (dispersion)");
await shot("count-model-nb");
await page.click('[data-layer="tracts"]');
await page.evaluate(() => {
  window.rumb.runCommand("clear-selection");
  window.rumb.app.store.set({ mode: "value", inspector: false });
  window.rumb.app.toggleLayer("chr_counties_2025");
});
await page.click("#access-tool");
await page.selectOption("#access-layer", "pharmacies_2010");
await page.click("#access-go");
await page.locator("#legend", { hasText: "access (E2SFCA" }).waitFor();
await page.waitForTimeout(800);
await shot("access-pharmacies");
await add("nursing_homes_2024");
await page.selectOption("#method", "points");
await page.selectOption("#point-weight", "beds");
await runAnalysis("Nearest neighbor ratio");
await shot("point-pattern");
await page.click("#density-tool");
await page.locator("#density-note", { hasText: "Auto bandwidth" }).waitFor();
await page.selectOption("#density-weight", "beds");
await page.locator("#density-note", { hasText: "Auto bandwidth" }).waitFor();
await page.click("#density-go");
await page.locator("#toast", { hasText: "Added Density" }).waitFor();
await page.waitForTimeout(800);
await shot("density-surface");
await browser.close();
server.kill();
console.log(`Wrote ${n} screenshots to ${dir}/`);
