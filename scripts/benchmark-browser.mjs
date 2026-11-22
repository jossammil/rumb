// Run against a production preview after generating fixtures with benchmark-db.R.
import assert from "node:assert/strict";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const [directory, url = "http://127.0.0.1:4180/"] = process.argv.slice(2);
if (!directory)
  throw Error(
    "Pass the directory containing points50.parquet and points500.parquet.",
  );
const bundle = (await readdir("dist/assets")).find(
  (s) => s.startsWith("database-") && s.endsWith(".js"),
);
const browser = await chromium.launch({
  channel: "chrome",
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
});
try {
  for (const size of [50, 500]) {
    const page = await browser.newPage();
    const file = join(directory, "points" + size + ".parquet");
    const byteSize = (await stat(file)).size;

    await page.goto(url);
    await page.waitForFunction(() =>
      document
        .querySelector("#foot-status")
        .textContent.includes("878 features"),
    );
    await page.waitForFunction(
      () => performance.getEntriesByName("rumb-first-map").length,
    );
    const mapReadyMs = await page.evaluate(() =>
      Math.round(
        performance.getEntriesByName("rumb-first-map")[0].startTime,
      ),
    );
    await page.evaluate(
      async (path) => {
        const m = await import(path);
        window.benchDB = await m.openDatabase();
      },
      new URL("assets/" + bundle, url).href,
    );
    const worker = page
      .workers()
      .find((w) => w.url().includes("duckdb-browser-eh.worker"));
    assert.ok(worker);
    await worker.evaluate(() => {
      // Count bytes read through DuckDB's local File API for the benchmark file only.
      const marked = new WeakSet(),
        rawSlice = Blob.prototype.slice,
        rawRead = FileReaderSync.prototype.readAsArrayBuffer;
      globalThis.benchmarkBytes = 0;
      Blob.prototype.slice = function (...args) {
        const part = rawSlice.apply(this, args);
        if (
          (this instanceof File &&
            /^points(50|500)\.parquet$/.test(this.name)) ||
          marked.has(this)
        )
          marked.add(part);
        return part;
      };
      FileReaderSync.prototype.readAsArrayBuffer = function (blob) {
        const bytes = rawRead.call(this, blob);
        if (marked.has(blob)) globalThis.benchmarkBytes += bytes.byteLength;
        return bytes;
      };
    });
    await page.evaluate(() => {
      const input = document.createElement("input");
      input.type = "file";
      input.id = "benchmark-file";
      document.body.append(input);
    });
    await page.locator("#benchmark-file").setInputFiles(file);
    const logged = { fileMB: byteSize / 1e6, mapReadyMs };
    async function measure(key, fn) {
      const before = await worker.evaluate(() => globalThis.benchmarkBytes),
        t = Date.now();
      const r = await fn();
      logged[key] = {
        ms: Date.now() - t,
        fileBytesRead:
          (await worker.evaluate(() => globalThis.benchmarkBytes)) - before,
      };
      return r;
    }
    const meta = await measure("register", () =>
      page.evaluate(() =>
        window.benchDB.importFile(
          document.querySelector("#benchmark-file").files[0],
          "events",
        ),
      ),
    );
    logged.rows = meta.rows;
    await page.evaluate(() => {
      window.ticks = 0;
      window.maxFrame = 0;
      let prev = performance.now();
      function frame(now) {
        window.maxFrame = Math.max(window.maxFrame, now - prev);
        prev = now;
        window.ticks++;
        window.frameID = requestAnimationFrame(frame);
      }
      window.frameID = requestAnimationFrame(frame);
    });
    await measure("fullCategorySum", () =>
      page.evaluate(() =>
        benchDB.query(
          "SELECT category, sum(value) FROM events GROUP BY category",
        ),
      ),
    );
    const result = await measure("spatialJoinFirst50000", () =>
      page.evaluate(() =>
        benchDB.query(
          "WITH points AS (SELECT geometry FROM events WHERE event_id < 50000) SELECT t.GEOID, count(p.geometry) AS points FROM tracts t LEFT JOIN points p ON ST_Within(p.geometry,t.geometry) GROUP BY t.GEOID",
          { limit: 1000 },
        ),
      ),
    );
    assert.equal(result.rows.length, 878);
    logged.inTracts = result.rows.reduce((n, r) => n + r.points, 0);
    Object.assign(
      logged,
      await page.evaluate(() => {
        cancelAnimationFrame(window.frameID);
        return {
          animationFrames: window.ticks,
          longestFrameMs: Math.round(window.maxFrame),
        };
      }),
    );
    console.log(JSON.stringify(logged));
    await page.close();
  }
} finally {
  await browser.close();
}
