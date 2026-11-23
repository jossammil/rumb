// The analysis methods' registry: how each result reads in the legend,
// inspector, CSV and report, and results saved before methods existed.
import test from "node:test";
import assert from "node:assert/strict";
import { METHOD_LIST, methodId, methodOf, METHODS } from "../src/stats/methods.js";
import { analyze } from "../src/stats/stats.js";

const values = { a: 1, b: 2, c: 5, d: 9, e: 1, f: 0 };
const neighbors = { a: ["b"], b: ["a", "c"], c: ["b", "d"], d: ["c", "e"], e: ["d", "f"], f: ["e"] };

test("every method describes its results completely", async () => {
  for (const m of METHOD_LIST) {
    for (const key of ["id", "label", "title", "legendTitle", "modeLabel", "short", "request", "file"])
      assert.equal(typeof m[key], "string", m.id + "." + key);
    for (const key of ["classes", "classOf", "featureRows", "summaryRows", "reportText", "rule", "csvRow"])
      assert.equal(typeof m[key], "function", m.id + "." + key);
    assert.ok(m.swatches.every((k) => m.classes()[k]), m.id + " swatches are classes");
  }
  const result = { ...(await analyze({ values, neighbors, permutations: 99 })), studyName: "All" };
  const lisa = methodOf(result);
  assert.equal(lisa, METHODS.lisa);
  const [id, record] = Object.entries(result.byId)[2];
  const row = lisa.csvRow(id, record, result, { measure: "v", rule: "queen" });
  assert.equal(row.length, lisa.csvFields.length, "CSV rows fill every column");
  assert.equal(row[lisa.csvFields.indexOf("method")], result.methodNote);
  assert.equal(lisa.summaryRows(result)[0][0], "Global Moran’s I");
  assert.ok(lisa.reportText(result).startsWith("Global Moran's I 0.1724"));
  assert.ok(lisa.classes()[lisa.classOf(record)], "a record's class has a legend entry");
});

test("results saved before methods read as Local Moran", () => {
  const legacy = { method: "GeoDa sample-standardized Local Moran I; …", globalI: 0.2 };
  assert.equal(methodOf(legacy).id, "lisa");
  assert.equal(methodOf(null).id, "lisa");
  assert.equal(methodId("nope"), "lisa");
  // The old description still reaches the CSV's method column.
  const row = METHODS.lisa.csvRow("x", { neighbors: [], reason: null }, { ...legacy, studyName: "All" }, { rule: "queen" });
  assert.equal(row.at(-1), legacy.method);
});
