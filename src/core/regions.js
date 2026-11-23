// Which region opens, and the address that opens another one. Changing region
// reloads the page with ?r=<id>: the catalog, projection and workspace are
// fixed when the app starts, so a fresh start is the reliable switch.

/** Whether the data index lists a region. */
export const listed = (index, id) => !!id && index.regions.some((r) => r.id === id);

/**
 * The region to open: ?r= in the address, then the region used last on this
 * device, then the index's default. Unlisted ids are passed over.
 */
export function chooseRegion(index, { search = "", stored } = {}) {
  const asked = new URLSearchParams(search).get("r");
  if (listed(index, asked)) return asked;
  if (listed(index, stored)) return stored;
  return index.default;
}

/** The region ?r= asked for when the index does not list it, else null. */
export function unknownRegion(index, search = "") {
  const asked = new URLSearchParams(search).get("r");
  return asked && !listed(index, asked) ? asked : null;
}

/**
 * The address that opens region `id` from `href`: ?r= set (or removed for the
 * default region), other query parameters kept, and `hash` (without "#") as
 * the fragment. `extra` adds query parameters, such as restore=1.
 */
export function regionHref(href, id, { index, hash = "", extra = {} } = {}) {
  const url = new URL(href);
  if (index && id === index.default) url.searchParams.delete("r");
  else url.searchParams.set("r", id);
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  url.hash = hash;
  return url.pathname + url.search + url.hash;
}

/** The region a saved project belongs to. Projects saved before there was a choice were Mississippi's. */
export const projectRegion = (saved) => (typeof saved?.region === "string" && saved.region) || "ms";
