import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readColumns, readTable } from "../src/data/parquet.js";

const read = (p) => readFileSync(new URL(p, import.meta.url));
const buffer = (p) => {
  const b = read(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

for (const region of ["ms", "de"]) {
  test(region + "'s Parquet tables read back exactly as its JSON tables", async () => {
    const index = JSON.parse(read("../public/data/" + region + "/tables/index.json"));
    for (const table of index.tables) {
      assert.ok(table.parquet, table.id + " has a Parquet copy");
      const json = JSON.parse(read("../public/data/" + region + "/" + table.file));
      const parquet = await readTable(buffer("../public/data/" + region + "/" + table.parquet));
      assert.deepEqual(parquet.ids, json.ids, table.id + " ids");
      assert.deepEqual(Object.keys(parquet.columns).sort(), Object.keys(json.columns).sort(), table.id + " columns");
      for (const [name, column] of Object.entries(json.columns)) assert.deepEqual(parquet.columns[name], column, table.id + " " + name);
    }
  });
}

test("a Parquet table can be read for some columns only", async () => {
  const t = await readTable(buffer("../public/data/ms/tables/tracts-acs.parquet"), { names: ["acs_population"] });
  assert.deepEqual(Object.keys(t.columns), ["acs_population"]);
  assert.equal(t.ids.length, 878);
});

// A server like GitHub Pages: HEAD reports the gzip size (with
// Content-Encoding), and a range request gets the file's own bytes. With
// `ranges` false it ignores Range and sends the whole file.
async function serve(bytes, { ranges = true } = {}) {
  const { createServer } = await import("node:http");
  const { gzipSync } = await import("node:zlib");
  const gzipped = gzipSync(bytes).length;
  const server = createServer((req, res) => {
    const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
    if (req.method === "HEAD") {
      res.writeHead(200, { "Content-Length": gzipped, "Content-Encoding": "gzip" });
      return res.end();
    }
    if (!ranges || !m) {
      res.writeHead(200, { "Content-Length": bytes.length });
      return res.end(bytes);
    }
    const start = Number(m[1]);
    const end = m[2] ? Math.min(Number(m[2]), bytes.length - 1) : bytes.length - 1;
    res.writeHead(206, { "Content-Range": `bytes ${start}-${end}/${bytes.length}`, "Content-Length": end - start + 1 });
    res.end(bytes.subarray(start, end + 1));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}/tracts-values.parquet`, close: () => server.close() };
}

for (const ranges of [true, false]) {
  test(`a remote Parquet file reads right when HEAD gives the gzip size (${ranges ? "ranges" : "no ranges"})`, async () => {
    const path = "../public/data/de/tiles/tracts-values.parquet";
    const local = await readTable(buffer(path));
    const names = Object.keys(local.columns).slice(0, 3);
    const { url, close } = await serve(read(path), { ranges });
    try {
      const got = await readColumns(url, names);
      assert.deepEqual(got.ids, local.ids);
      for (const name of names) assert.deepEqual(got.columns[name], local.columns[name], name);
    } finally {
      close();
    }
  });
}
