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

/** Metadata for a field of the reference layer, or undefined. */
export const fieldInfo = (catalog, field) =>
  referenceLayer(catalog).fields?.[field];

/** A field's display label: the catalog label, else the name with spaces. */
export const fieldLabel = (catalog, field) =>
  fieldInfo(catalog, field)?.label || field?.replaceAll("_", " ") || "Features";

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
