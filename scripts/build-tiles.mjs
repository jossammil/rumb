// Builds a tract tile layer from state folders: vector tiles of every tract
// (tippecanoe, into one PMTiles file), the tracts' values (one Parquet row
// group per state, scripts/prepare-tract-values.R), and tiles.json, which
// describes the layer to the app like a library layer. Run at the repository
// root:
//   node scripts/build-tiles.mjs --out REGION_DIR [--id ID] [--name NAME] [--hidden] STATE_DIR...
// Files go to REGION_DIR/tiles/. --hidden keeps the layer out of the library
// panel (Delaware's test fixture). Needs tippecanoe 2.79.0 on the PATH.
//
// Every tract is kept at every zoom from 5 to 11, tiny ones included, with
// borders that neighbors share simplified alike. Tracts start at zoom 5:
// at zoom 4 a dozen small city tracts vanish even so, and the largest tile
// passes 800 KB (measured 2026-11-24). Counties cover the zooms below.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { bbox } from "./region-catalog.mjs";

export const TIPPECANOE = "2.79.0";
export const ZOOMS = { min: 5, max: 11 };

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const valued = new Set(["--out", "--id", "--name"]);
const dirs = args.filter((a, i) => !a.startsWith("--") && !valued.has(args[i - 1]));
const out = option("--out");
if (!out || !dirs.length) {
  console.error("Usage: node scripts/build-tiles.mjs --out REGION_DIR [--id ID] [--name NAME] [--hidden] STATE_DIR...");
  process.exit(2);
}
const tiles = path.join(out, "tiles");
fs.mkdirSync(tiles, { recursive: true });

const run = (command, argv) => {
  const r = spawnSync(command, argv, { stdio: ["ignore", "inherit", "inherit"] });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(command + " failed with status " + r.status);
};
const version = spawnSync("tippecanoe", ["--version"], { encoding: "utf8" });
const found = (version.stdout + version.stderr).match(/v?(\d+\.\d+\.\d+)/)?.[1];
if (found !== TIPPECANOE) throw new Error("Needs tippecanoe " + TIPPECANOE + ", found " + (found || "none"));

const inputs = dirs.map((d) => path.join(d, "tracts.geojson"));
const started = Date.now();
// tippecanoe writes PMTiles itself; GEOID is the only property the map needs.
// (Its warning about string feature ids is expected: GEOID is promoted instead.)
run("tippecanoe", [
  "-o", path.join(tiles, "tracts.pmtiles"), "--force", "--quiet",
  "-l", "tracts", "-y", "GEOID",
  "-Z" + ZOOMS.min, "-z" + ZOOMS.max,
  "--detect-shared-borders", "--no-feature-limit", "--no-tile-size-limit", "--no-tiny-polygon-reduction",
  ...inputs,
]);
run("Rscript", ["scripts/prepare-tract-values.R", "--out", tiles, ...dirs]);
const values = JSON.parse(fs.readFileSync(path.join(tiles, "tracts-values.json"), "utf8"));
fs.rmSync(path.join(tiles, "tracts-values.json"));

// The layer's extent, from the display files (Alaska's run west of 180°).
const box = inputs
  .map((f) => bbox(JSON.parse(fs.readFileSync(f, "utf8"))))
  .reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
const single = values.states.length === 1 ? values.states[0].name : null;
const layer = {
  id: option("--id", "tracts_tiles"),
  name: option("--name", single ? single + " tracts (tiles)" : "All U.S. tracts"),
  group: "Census",
  geometry: "polygon",
  tiles: "tiles/tracts.pmtiles",
  sourceLayer: "tracts",
  minzoom: ZOOMS.min,
  maxzoom: ZOOMS.max,
  idField: "GEOID",
  values: "tiles/tracts-values.parquet",
  states: values.states,
  count: values.rows,
  bbox: box.map((v) => Math.round(v * 1e4) / 1e4),
  labelField: values.labelField,
  placeField: values.placeField,
  populationField: "acs_population",
  measures: values.measures,
  fields: values.fields,
  credit: "Boundaries & estimates · U.S. Census Bureau · CDC PLACES",
  vintage: "2020–2024",
  ...(args.includes("--hidden") && { hidden: true }),
  bytes: fs.statSync(path.join(tiles, "tracts.pmtiles")).size + values.bytes,
  source: { tippecanoe: TIPPECANOE, values: { sha256: values.sha256, packages: values.packages } },
};
fs.writeFileSync(path.join(tiles, "tiles.json"), JSON.stringify({ version: 1, layers: [layer] }, null, 1) + "\n");
// A built region's catalog names its tile layers (region-catalog.mjs does the same when it writes one).
const catalogFile = path.join(out, "catalog.json");
if (fs.existsSync(catalogFile)) {
  const catalog = JSON.parse(fs.readFileSync(catalogFile, "utf8"));
  if (catalog.tiles !== "tiles/tiles.json") {
    const { layers, ...rest } = catalog;
    fs.writeFileSync(catalogFile, JSON.stringify({ ...rest, tiles: "tiles/tiles.json", layers }, null, 1) + "\n");
  }
}
console.log(
  `${layer.id}: ${layer.count} tracts of ${values.states.length} states, ` +
    `${(fs.statSync(path.join(tiles, "tracts.pmtiles")).size / 1048576).toFixed(1)} MB of tiles and ` +
    `${(values.bytes / 1048576).toFixed(1)} MB of values in ${((Date.now() - started) / 1000).toFixed(0)} s`,
);
