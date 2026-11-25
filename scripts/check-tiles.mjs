// Checks a tract tile layer before it ships (scripts/build-tiles.mjs wrote it):
// every tract of its values file appears in the tiles at the lowest and the
// highest zoom, no tile is larger than 1 MB, the zooms are the ones the layer
// declares, and the tiles file fits its size budget. Run at the repository root:
//   node scripts/check-tiles.mjs REGION_DIR [--max-mb 150]
// Reads the whole PMTiles file and decodes every tile at the two zooms
// (@mapbox/vector-tile and pbf, development dependencies only). Exits with
// status 1 and lists the problems when the layer fails.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader as Pbf } from "pbf";
import { bytesToHeader, readVarint, tileIdToZxy } from "pmtiles";
import { parquetReadObjects } from "hyparquet";

const MAX_TILE = 1024 * 1024;

/** Every tile in a PMTiles v3 archive: [{ z, x, y, offset, length }] (offsets into the file). */
export function listTiles(bytes) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const header = bytesToHeader(buffer.slice(0, 127));
  const inflate = (b) => (header.internalCompression === 2 ? zlib.gunzipSync(b) : b);
  // A directory: delta-coded tile ids, run lengths, lengths, then offsets (0: right after the last).
  const entries = (offset, length) => {
    const state = { buf: new Uint8Array(inflate(bytes.subarray(offset, offset + length))), pos: 0 };
    const n = readVarint(state),
      list = [];
    let id = 0;
    for (let i = 0; i < n; i++) list.push({ tileId: (id += readVarint(state)) });
    for (const e of list) e.runLength = readVarint(state);
    for (const e of list) e.length = readVarint(state);
    list.forEach((e, i) => {
      const v = readVarint(state);
      e.offset = v === 0 && i > 0 ? list[i - 1].offset + list[i - 1].length : v - 1;
    });
    return list;
  };
  const tiles = [];
  const walk = (offset, length) => {
    for (const e of entries(offset, length)) {
      // A run length of 0 points to a leaf directory.
      if (e.runLength === 0) walk(header.leafDirectoryOffset + e.offset, e.length);
      else
        for (let k = 0; k < e.runLength; k++) {
          const [z, x, y] = tileIdToZxy(e.tileId + k);
          tiles.push({ z, x, y, offset: header.tileDataOffset + e.offset, length: e.length });
        }
    }
  };
  walk(header.rootDirectoryOffset, header.rootDirectoryLength);
  return { header, tiles };
}

/** The ids of a layer's features in one tile's bytes. */
function tileIds(bytes, header, layer, idField) {
  const data = header.tileCompression === 2 ? zlib.gunzipSync(bytes) : bytes;
  const tile = new VectorTile(new Pbf(data)).layers[layer];
  const ids = [];
  for (let i = 0; i < (tile?.length || 0); i++) ids.push(String(tile.feature(i).properties[idField]));
  return ids;
}

export async function checkTiles(dir, { maxMB = 150 } = {}) {
  const problems = [],
    notes = [];
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "tiles", "tiles.json"), "utf8")).layers[0];
  const bytes = fs.readFileSync(path.join(dir, meta.tiles));
  const values = fs.readFileSync(path.join(dir, meta.values));
  const rows = await parquetReadObjects({
    file: values.buffer.slice(values.byteOffset, values.byteOffset + values.byteLength),
    columns: [meta.idField],
  });
  const want = new Set(rows.map((r) => String(r[meta.idField])));
  if (want.size !== rows.length) problems.push("duplicate ids in " + meta.values);
  if (want.size !== meta.count) problems.push(`tiles.json counts ${meta.count} tracts, the values ${want.size}`);
  const { header, tiles } = listTiles(bytes);
  if (header.minZoom !== meta.minzoom || header.maxZoom !== meta.maxzoom)
    problems.push(`zooms ${header.minZoom}–${header.maxZoom}, declared ${meta.minzoom}–${meta.maxzoom}`);
  const largest = tiles.reduce((a, t) => (t.length > a.length ? t : a), { length: 0 });
  if (largest.length > MAX_TILE) problems.push(`tile ${largest.z}/${largest.x}/${largest.y} is ${(largest.length / 1024).toFixed(0)} KB`);
  for (const z of [header.minZoom, header.maxZoom]) {
    const seen = new Set();
    for (const t of tiles)
      if (t.z === z) for (const id of tileIds(bytes.subarray(t.offset, t.offset + t.length), header, meta.sourceLayer, meta.idField)) seen.add(id);
    const missing = [...want].filter((id) => !seen.has(id)),
      extra = [...seen].filter((id) => !want.has(id));
    if (missing.length) problems.push(`${missing.length} tracts missing at zoom ${z}: ${missing.slice(0, 5).join(", ")}`);
    if (extra.length) problems.push(`${extra.length} unknown ids at zoom ${z}: ${extra.slice(0, 5).join(", ")}`);
  }
  const mb = bytes.length / 1048576;
  if (mb > maxMB) problems.push(`${meta.tiles} is ${mb.toFixed(1)} MB, over ${maxMB} MB`);
  notes.push(
    `${want.size} tracts at zooms ${header.minZoom} and ${header.maxZoom}`,
    `${tiles.length} tiles, ${mb.toFixed(1)} MB, largest ${(largest.length / 1024).toFixed(0)} KB (${largest.z}/${largest.x}/${largest.y})`,
    `values ${(values.length / 1048576).toFixed(1)} MB`,
  );
  return { problems, notes };
}

if (import.meta.url === "file://" + process.argv[1]) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--max-mb");
  const maxMB = at >= 0 ? Number(args[at + 1]) : 150;
  const dirs = args.filter((a, i) => !a.startsWith("--") && (at < 0 || i !== at + 1));
  let failed = false;
  for (const dir of dirs) {
    const { problems, notes } = await checkTiles(dir, { maxMB });
    console.log((problems.length ? "FAIL  " : "ok    ") + dir + " · " + notes.join(" · "));
    for (const p of problems) console.log("      " + p);
    failed ||= problems.length > 0;
  }
  process.exit(failed ? 1 : 0);
}
