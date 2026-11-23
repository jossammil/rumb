// The data catalog says which regions exist, which reference layers each one
// ships, and what every field means. It is read from data/index.json and
// data/<region>/catalog.json; nothing about a particular state lives in code.
// Adding a state later means adding data/<st>/ and a line in index.json.

/** Loads the index and one region's catalog. fetchJSON(path) resolves parsed JSON. */
export async function loadCatalog(fetchJSON, regionId) {
  const index = await fetchJSON("data/index.json");
  const entry =
    index.regions.find((r) => r.id === (regionId || index.default)) ||
    index.regions.find((r) => r.id === index.default);
  if (!entry) throw new Error("The data index lists no regions.");
  const catalog = await fetchJSON("data/" + entry.path + "catalog.json");
  validateCatalog(catalog);
  return { ...catalog, path: "data/" + entry.path, index };
}

/** Throws with a readable message when a catalog is missing what the app needs. */
export function validateCatalog(catalog) {
  const fail = (what) => {
    throw new Error("The data catalog is missing " + what + ".");
  };
  if (!catalog?.region?.id) fail("its region");
  if (!Array.isArray(catalog.region.bounds)) fail("the region's bounds");
  if (!catalog.layers?.length) fail("a reference layer");
  for (const layer of catalog.layers) {
    if (!layer.id || !layer.name) fail("a layer's id or name");
    for (const key of ["display", "parquet", "neighbors"])
      if (!layer.files?.[key]) fail(layer.id + "'s " + key + " file");
    if (!layer.idField) fail(layer.id + "'s idField");
    if (!layer.measures?.length) fail(layer.id + "'s measures");
  }
  return catalog;
}

/** The region's reference layer (the one that opens first). */
export const referenceLayer = (catalog) => catalog.layers[0];

/**
 * Metadata for a field, or undefined. `meta` is the layer's catalog or library
 * entry; without it the reference layer is meant.
 */
export const fieldInfo = (catalog, field, meta = referenceLayer(catalog)) =>
  meta?.fields?.[field];

/** A field's display label: the catalog label, else the name with spaces. */
export const fieldLabel = (catalog, field, meta) =>
  fieldInfo(catalog, field, meta)?.label || field?.replaceAll("_", " ") || "Features";

// The library: add-on layers a reader can stack over the reference layer
// (facilities, districts, County Health Rankings). It lives in its own file,
// data/<region>/layers/library.json, written by scripts/prepare-layers.R, and is
// read only when first needed, so the first map never waits for it.

export const GEOMETRIES = ["point", "line", "polygon"];

/** Loads a region's library, or an empty one when the region has none. */
export async function loadLibrary(fetchJSON, catalog) {
  if (!catalog.library) return { version: 1, groups: [], layers: [] };
  return validateLibrary(await fetchJSON(catalog.path + catalog.library), catalog);
}

/** Throws with a readable message when a library entry lacks what the app needs. */
export function validateLibrary(library, catalog) {
  const fail = (what) => {
    throw new Error("The layer library is missing " + what + ".");
  };
  if (!Array.isArray(library?.layers)) fail("its layer list");
  const seen = new Set(catalog ? catalog.layers.map((l) => l.id) : []);
  for (const layer of library.layers) {
    if (!layer.id || !layer.name) fail("a layer's id or name");
    if (seen.has(layer.id)) fail("a unique id for " + layer.id);
    seen.add(layer.id);
    if (!GEOMETRIES.includes(layer.geometry)) fail(layer.id + "'s geometry type");
    if (!layer.file) fail(layer.id + "'s file");
    for (const key of ["labelField", "typeField", "placeField", "populationField"])
      if (layer[key] && !layer.fields?.[layer[key]]) fail(layer.id + "'s " + key);
    for (const field of [...(layer.popupFields || []), ...(layer.measures || [])])
      if (!layer.fields?.[field]) fail(layer.id + "'s field " + field);
  }
  return library;
}

// Tables: attribute tables that join to the reference layer by id (ACS profile
// covariates, CDC PLACES), plus centers of population for distance work. They
// are listed in data/<region>/tables/index.json, written by
// scripts/prepare-tables.R, and read only when a field or method needs them.

/** Throws with a readable message when the table index lacks what the app needs. */
export function validateTables(index) {
  const fail = (what) => {
    throw new Error("The table index is missing " + what + ".");
  };
  if (!Array.isArray(index?.tables)) fail("its table list");
  for (const table of index.tables) {
    if (!table.id || !table.name || !table.file) fail("a table's id, name or file");
    if (!Array.isArray(table.measures) || !table.fields) fail(table.id + "'s measures");
    for (const field of table.measures) if (!table.fields[field]) fail(table.id + "'s field " + field);
  }
  return { centers: {}, ...index };
}

/** Catalog or library metadata for a layer id, or undefined. */
export function layerMeta(catalog, library, id) {
  const ref = referenceLayer(catalog);
  if (id === ref.id) return ref;
  return library?.layers?.find((l) => l.id === id);
}

/** The geometry a catalog or library layer holds ("polygon" for the reference layer). */
export const layerGeometry = (meta) => meta?.geometry || "polygon";

/** The starter SQL for a reference layer. */
export function starterSQL(layer) {
  const measure = layer.measures[0];
  const columns = [layer.idField, layer.labelField, layer.groupField, measure]
    .filter(Boolean)
    .join(", ");
  return (
    "SELECT " + columns + "\nFROM " + layer.id + "\nORDER BY " + measure + " DESC NULLS LAST"
  );
}
