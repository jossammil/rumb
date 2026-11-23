// Checks a built region folder before it ships: the catalog, library and table
// index pass the app's own validators, every file they name exists, the ids
// agree across files, neighbors are symmetric, and no file is too large for
// GitHub Pages. Run at the repository root:
//   node scripts/check-region.mjs DIR [DIR...]
// Exits with status 1 and lists the problems when a region fails.
import fs from "node:fs";
import path from "node:path";
import { validateCatalog, validateLibrary, validateTables, referenceLayer } from "../src/catalog/catalog.js";

const MAX_FILE = 100 * 1024 * 1024; // GitHub's limit for one file
const WARN_FILE = 25 * 1024 * 1024;

export function checkRegion(dir) {
  const problems = [];
  const notes = [];
  const fail = (what) => problems.push(what);
  const file = (name) => path.join(dir, name);
  const read = (name) => JSON.parse(fs.readFileSync(file(name), "utf8"));
  const exists = (name) => fs.existsSync(file(name)) || (fail("missing " + name), false);
  const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
  const guard = (what, fn) => {
    try {
      fn();
    } catch (error) {
      fail(what + ": " + error.message);
    }
  };

  let catalog;
  guard("catalog.json", () => (catalog = validateCatalog(read("catalog.json"))));
  if (!catalog) return { problems, notes };
  const ref = referenceLayer(catalog);
  const region = catalog.region;
  for (const name of [...Object.values(ref.files), ref.tables, catalog.library, region.outline,
    region.backdrop?.context, region.backdrop?.world, region.backdrop?.roads, ref.compare?.reference].filter(Boolean))
    exists(name);

  // The reference tracts and their neighbors.
  const display = read(ref.files.display);
  const ids = display.features.map((f) => String(f.id ?? f.properties[ref.idField]));
  const idSet = new Set(ids);
  if (idSet.size !== ids.length) fail("duplicate ids in " + ref.files.display);
  for (const f of display.features)
    if (String(f.id) !== String(f.properties[ref.idField])) fail("feature id differs from " + ref.idField + " for " + f.id);
  const graphs = read(ref.files.neighbors);
  for (const kind of ["queen", "rook"]) {
    const graph = graphs[kind] || {};
    if (!sameSet(new Set(Object.keys(graph)), idSet)) fail(kind + " neighbors do not list every tract");
    for (const [id, list] of Object.entries(graph))
      for (const j of list) if (!graph[j]?.includes(id)) fail(kind + " neighbors are not symmetric at " + id + "–" + j);
  }
  // Bounds frame the opening view, so a sliver outside them is only noted
  // (Mississippi's hand-set bounds leave out 0.02° of coastal water tracts).
  const [[west, south], [east, north]] = region.bounds;
  let beyond = 0;
  const walk = (c) => {
    if (typeof c[0] === "number")
      beyond = Math.max(beyond, west - c[0], c[0] - east, south - c[1], c[1] - north);
    else c.forEach(walk);
  };
  display.features.forEach((f) => walk(f.geometry.coordinates));
  if (beyond > 0.1) fail("tracts reach " + beyond.toFixed(2) + "° past the region's bounds");
  else if (beyond > 0) notes.push("tracts reach " + beyond.toFixed(3) + "° past the bounds");

  // Tables and centers, in the display file's order.
  if (ref.tables) {
    let index;
    guard(ref.tables, () => (index = validateTables(read(ref.tables))));
    for (const table of index?.tables || []) {
      const t = read(table.file);
      if (t.ids.join() !== ids.join()) fail(table.file + " ids differ from the tracts");
      for (const field of Object.keys(table.fields))
        if (!(field in t.columns)) fail(table.file + " lacks " + field);
      for (const [field, column] of Object.entries(t.columns))
        if (column.length !== ids.length) fail(table.file + " " + field + " has " + column.length + " values");
    }
    for (const [layer, center] of Object.entries(index?.centers || {})) {
      const c = read(center.file);
      const want = layer === ref.id ? ids : null;
      if (want && c.ids.join() !== want.join()) fail(center.file + " ids differ from the tracts");
      if (![c.lon, c.lat, c.population].every((col) => col.length === c.ids.length)) fail(center.file + " has ragged columns");
    }
  }

  // The library: every layer's file and neighbors, and county ids.
  if (catalog.library) {
    let library;
    guard(catalog.library, () => (library = validateLibrary(read(catalog.library), catalog)));
    for (const layer of library?.layers || []) {
      if (!exists(layer.file)) continue;
      const geo = read(layer.file);
      if (geo.features.length !== layer.count) fail(layer.id + " has " + geo.features.length + " features, not " + layer.count);
      if (layer.neighbors && exists(layer.neighbors)) {
        const nb = read(layer.neighbors);
        const lids = new Set(geo.features.map((f) => String(f.id)));
        if (!sameSet(new Set(Object.keys(nb.queen)), lids)) fail(layer.id + " neighbors do not list every feature");
      }
    }
  }
  if (ref.compare?.reference && fs.existsSync(file(ref.compare.reference))) {
    const places = read(ref.compare.reference);
    for (const id of Object.keys(places.byId)) if (!idSet.has(id)) fail("places record for unknown tract " + id);
  }

  // Sizes.
  let total = 0;
  const visit = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) visit(p);
      else {
        const size = fs.statSync(p).size;
        total += size;
        if (size > MAX_FILE) fail(path.relative(dir, p) + " is over 100 MB");
        else if (size > WARN_FILE) notes.push(path.relative(dir, p) + " is " + (size / 1048576).toFixed(1) + " MB");
      }
    }
  };
  visit(dir);
  notes.push(ids.length + " tracts, " + (total / 1048576).toFixed(1) + " MB");
  return { problems: problems.slice(0, 40), notes };
}

if (import.meta.url === "file://" + path.resolve(process.argv[1])) {
  const dirs = process.argv.slice(2);
  if (!dirs.length) {
    console.error("Usage: node scripts/check-region.mjs DIR [DIR...]");
    process.exit(2);
  }
  let failed = 0;
  for (const dir of dirs) {
    const { problems, notes } = checkRegion(dir);
    if (problems.length) {
      failed++;
      console.log("FAIL  " + dir + "\n      " + problems.join("\n      "));
    } else console.log("ok    " + dir + " · " + notes.join(" · "));
  }
  process.exit(failed ? 1 : 0);
}
