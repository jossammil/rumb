// Writes a state's catalog.json from the files the data scripts built and from
// Mississippi's catalog, which is the template for the reference layer's fields
// (every state's tracts carry the same ACS S1701 measures). Mississippi keeps
// its committed, hand-edited catalog. Used by scripts/build-regions.mjs.
import fs from "node:fs";
import path from "node:path";

const R = 6371008.8;
const rad = Math.PI / 180;
const round = (x, digits) => Number(x.toFixed(digits));

/** The [west, south, east, north] box of a GeoJSON collection. */
export function bbox(collection) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (c) => {
    if (typeof c[0] === "number") {
      b[0] = Math.min(b[0], c[0]);
      b[1] = Math.min(b[1], c[1]);
      b[2] = Math.max(b[2], c[0]);
      b[3] = Math.max(b[3], c[1]);
    } else c.forEach(walk);
  };
  for (const f of collection.features) walk(f.geometry.coordinates);
  return b;
}

/**
 * The projection distances, buffers and filters use in a state. Alaska uses
 * the Alaska Albers equal-area system (EPSG:3338). Every other state uses a
 * transverse Mercator centred on it, whose scale factor splits the scale error
 * evenly between the centre and the east and west edges: at a distance x from
 * the central meridian TM's scale is about k0 (1 + x² / 2R²), so with
 * e = x_max² / 2R², k0 = 1 / (1 + e/2) and the error stays within ±e/2
 * (0.26% for Texas, the widest after Alaska).
 */
export function regionProjection(region, [west, south, east, north]) {
  if (region.fips === "02")
    return {
      epsg: 3338,
      name: "NAD83 / Alaska Albers",
      aea: { lat0: 50, lon0: -154, lat1: 55, lat2: 65, x0: 0, y0: 0, a: 6378137, rf: 298.257222101 },
      proj: "+proj=aea +lat_0=50 +lon_0=-154 +lat_1=55 +lat_2=65 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs",
    };
  const lon0 = round((west + east) / 2, 2);
  const lat0 = round((south + north) / 2, 2);
  const widest = Math.max(Math.abs(Math.cos(south * rad)), Math.abs(Math.cos(north * rad)));
  const x = R * widest * ((east - west) / 2) * rad;
  const e = (x * x) / (2 * R * R);
  const k0 = round(1 / (1 + e / 2), 7);
  return {
    name: "Transverse Mercator centred on " + region.name + " (NAD83)",
    tmerc: { lat0, lon0, k0, x0: 500000, y0: 0, a: 6378137, rf: 298.257222101 },
    proj: `+proj=tmerc +lat_0=${lat0} +lon_0=${lon0} +k=${k0} +x_0=500000 +y_0=0 +ellps=GRS80 +units=m +no_defs`,
    scaleError: round(e / 2, 5),
  };
}

/** Bounds padded by 1% of the span and rounded outward to 0.01°. */
export function paddedBounds([west, south, east, north]) {
  const dx = (east - west) * 0.01,
    dy = (north - south) * 0.01;
  const down = (v) => Math.floor(v * 100) / 100,
    up = (v) => Math.ceil(v * 100) / 100;
  return [
    [round(down(west - dx), 2), round(down(south - dy), 2)],
    [round(up(east + dx), 2), round(up(north + dy), 2)],
  ];
}

/** The catalog for `region` (an entry of scripts/regions.json) built into `dir`. */
export function regionCatalog(region, dir, { template, backdrop }) {
  const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
  const tracts = read("tracts.geojson");
  const box = bbox(tracts);
  const base = template.layers[0];
  const layer = {
    ...base,
    name: region.name + " tracts",
    title: region.name,
    summary: "2020–2024 ACS · " + region.name + " census tracts",
    studyAll: "All " + region.name + " tracts",
  };
  // Compare pairs poverty with a PLACES social-needs measure; leave it out
  // where the state's release has none of them.
  delete layer.compare;
  if (fs.existsSync(path.join(dir, "places-2025.json"))) {
    const places = read("places-2025.json");
    const measures = Object.keys(places.measures);
    if (measures.length) {
      const pick = base.compare.lead.find((f) => measures.includes(f)) || measures[0];
      layer.compare = { ...base.compare, lead: ["poverty_pct", pick, "child_poverty_pct"] };
    }
  }
  return {
    version: template.version,
    region: {
      id: region.id,
      name: region.name,
      bounds: paddedBounds(box),
      credit: template.region.credit,
      projection: regionProjection(region, box),
      outline: "outline.geojson",
      backdrop: {
        context: "context.geojson",
        world: "world-land.geojson",
        roads: "roads.geojson",
        extent: backdrop.extent,
        labels: backdrop.labels,
      },
    },
    library: template.library,
    layers: [layer],
  };
}
