import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  BlobReader,
  BlobWriter,
  TextReader,
  ZipWriter,
} from "@zip.js/zip.js/lib/zip-core-native.js";
import { chromium, webkit } from "playwright";

const url = process.argv[2] || "http://127.0.0.1:4180/";
const engine = process.env.BGIS_WEBKIT ? "WebKit" : "Chrome";
const browser =
  engine === "WebKit"
    ? await webkit.launch()
    : await chromium.launch({
        channel: "chrome",
        args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
      });
const pageErrors = [];
const externalRequests = new Set();
const placesRequests = [];

async function openPage() {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    acceptDownloads: true,
  });
  page.setDefaultTimeout(35000);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    const target = new URL(request.url());
    if (
      /^https?:$/.test(target.protocol) &&
      target.origin !== new URL(url).origin
    )
      externalRequests.add(target.origin);
    if (target.pathname.endsWith("/data/places-2025.json"))
      placesRequests.push(request.url());
  });
  await page.goto(url);
  await page
    .locator("#foot-status")
    .filter({ hasText: "878 features" })
    .waitFor();
  await page.waitForFunction(
    () => performance.getEntriesByName("field-atlas-first-map").length > 0,
  );
  return page;
}

async function download(page, selector) {
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    page.click(selector),
  ]);
  const content = await readFile(await file.path());
  assert.ok(content.length, `empty download from ${selector}`);
  return content;
}

async function legacyProject() {
  const zip = new ZipWriter(new BlobWriter("application/zip"), {
    useWebWorkers: false,
    level: 0,
  });
  // This is the original v1 manifest and file inventory, independent of today's writer.
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
    new TextReader(
      JSON.stringify({ format: "field-atlas", version: 1, state, files: [] }),
    ),
  );
  for (const name of [
    "tracts.parquet",
    "tracts.geojson",
    "neighbors.json",
    "sources.json",
  ]) {
    const bytes = await readFile(
      new URL(`../public/data/${name}`, import.meta.url),
    );
    await zip.add(`base/${name}`, new BlobReader(new Blob([bytes])));
  }
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
      coordinates: [
        [
          [west, 32],
          [east, 32],
          [east, 34],
          [west, 34],
          [west, 32],
        ],
      ],
    },
  })),
};

// The checked inputs have single-line field values, including quoted fields such as tract names.
function csvRows(bytes) {
  const records = bytes
    .toString("utf8")
    .replace(/^\uFEFF/, "")
    .trimEnd()
    .split(/\r?\n/)
    .map((line) =>
      [...line.matchAll(/(?:^|,)("(?:[^"]|"")*"|[^,]*)/g)].map(([, cell]) =>
        cell.startsWith('"') ? cell.slice(1, -1).replaceAll('""', '"') : cell,
      ),
    );
  const [header, ...rows] = records;
  return rows.map((row) => {
    assert.equal(
      row.length,
      header.length,
      "CSV header and data column counts differ",
    );
    return Object.fromEntries(header.map((field, i) => [field, row[i]]));
  });
}

async function chooseSettings(page, fields, weights, directions) {
  if (!(await page.locator("#cmp-settings").evaluate((el) => el.open)))
    await page.click("#cmp-settings summary");
  if (fields.length === 3 && !(await page.locator("#cmp-field-2").count()))
    await page.click("#cmp-add");
  for (const [index, field] of fields.entries()) {
    await page.selectOption(`#cmp-field-${index}`, field);
    await page.selectOption(`#cmp-direction-${index}`, directions[index]);
    await page.fill(`#cmp-weight-${index}`, String(weights[index]));
  }
  await page.click("#cmp-apply");
}

async function restore(page, buffer) {
  await page.setInputFiles("#project-picker", {
    name: "workspace.bgis",
    mimeType: "application/zip",
    buffer,
  });
  await page
    .locator("#toast")
    .filter({ hasText: /project restored/i })
    .waitFor();
}
try {
  const page = await openPage();
  assert.equal(placesRequests.length, 0);
  const compare = () => page.click('[data-view="compare"]');
  const wait = (sel, text) =>
    page.locator(sel).filter({ hasText: text }).first().waitFor();
  await compare();
  await wait("#cmp-count", "870 of 878");
  assert.equal(await page.locator("#cmp-plot circle").count(), 870);
  let rows = csvRows(await download(page, "#cmp-export"));
  assert.equal(rows.length, 878);
  assert.equal(rows.filter((r) => r.exclusion_reason).length, 8);
  await page.check("#cmp-unranked");
  assert.equal(await page.locator("#cmp-table tbody tr").count(), 8);
  await page.uncheck("#cmp-unranked");
  await page.click('[data-sort="name"]');
  assert.equal(
    await page
      .locator('[data-sort="name"]')
      .evaluate((b) => b.parentNode.getAttribute("aria-sort")),
    "ascending",
  );
  await page.click('[data-sort="rank"]');
  const first = page.locator("#cmp-table tbody tr").first();
  const id = await first.getAttribute("data-id");
  await first.locator("button").click();
  await wait("#cmp-details", "90% MOE");
  await wait("#cmp-details", "95% CI");
  const dot = page.locator('#cmp-plot circle[data-id="' + id + '"]');
  const second = page.locator("#cmp-table tbody tr").nth(1).locator("button");
  await second.click();
  await wait("#cmp-selection", "2 selected");
  await second.click();
  await dot.click({ force: true });
  await wait("#cmp-selection", "0 selected");
  await first.locator("button").click();
  await page.selectOption("#cmp-color", "quadrant");
  await page.focus("#cmp-split");
  const prev = await page.locator("#cmp-panel").boundingBox();
  await page.keyboard.press("ArrowLeft");
  assert.ok(
    (await page.locator("#cmp-panel").boundingBox()).width > prev.width,
  );
  await chooseSettings(
    page,
    ["poverty_pct", "housing_insecurity_pct", "food_insecurity_pct"],
    [40, 35, 25],
    ["higher", "lower", "higher"],
  );
  rows = csvRows(await download(page, "#cmp-export"));
  assert.equal(rows[0].component_2_direction, "lower");
  await page.fill("#cmp-weight-0", "5");
  await page.click("#cmp-apply");
  await wait("#cmp-error", "100");
  const archive = await download(page, "#save-project");
  const saved = await openPage();
  await saved.route("**/data/places-2025.json", (r) => r.abort());
  await restore(saved, archive);
  await saved
    .locator("#cmp-selection")
    .filter({ hasText: "1 selected" })
    .waitFor();
  assert.equal(await saved.inputValue("#cmp-field-2"), "food_insecurity_pct");
  assert.equal(await saved.inputValue("#cmp-color"), "quadrant");
  await saved.close();
  await page.setInputFiles("#file-picker", {
    name: "districts.geojson",
    mimeType: "application/geo+json",
    buffer: Buffer.from(JSON.stringify(districts)),
  });
  await page.click("#map-source");
  await page.locator("#map-view:not([hidden])").waitFor();
  await compare();
  await chooseSettings(
    page,
    ["need", "reach", "capacity"],
    [40, 35, 25],
    ["higher", "lower", "higher"],
  );
  await wait("#cmp-count", "3 of 4");
  rows = csvRows(await download(page, "#cmp-export"));
  assert.equal(rows.filter((r) => r.exclusion_reason).length, 1);
  assert.equal(rows[0].area_name, "District B");
  await page.click("#fit");
  await page.waitForTimeout(750);
  const box = await page.locator("#map").boundingBox();
  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.5);
  await wait("#cmp-selection", "1 selected");
  await wait("#cmp-details", "District A");
  await page.check("#cmp-only");
  assert.equal(await page.locator("#cmp-table tbody tr").count(), 1);
  await page.selectOption("#cmp-layer", "tracts");
  await wait("#cmp-selection", "1 selected");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  const mobile = await page.locator("#cmp-panel").boundingBox();
  assert.ok(mobile.y >= (await page.locator("#map").boundingBox()).height);
  await page.focus("#cmp-split");
  await page.keyboard.press("ArrowUp");
  assert.ok(
    (await page.locator("#cmp-panel").boundingBox()).height > mobile.height,
  );
  await restore(page, await legacyProject());
  assert.equal(await page.inputValue("#measure"), "child_poverty_pct");
  assert.deepEqual(pageErrors, []);
  assert.deepEqual([...externalRequests], []);
  console.log(
    engine,
    "passed comparison, linked selection, archive and mobile checks",
  );
} finally {
  await browser.close();
}
