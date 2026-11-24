import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readTable } from "../src/data/parquet.js";

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
