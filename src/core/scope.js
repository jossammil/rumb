// What a layer can be used for. A tile layer (the national tract map) is for
// viewing: its features have no geometry in the app, so the methods that need
// shapes, distances or the whole layer in memory are off on it, and each says
// why. Pure.

/** The reason shown wherever a tile layer turns something off. */
export const TILE_REASON =
  "This layer is drawn from tiles, for viewing. Statistics, filters, search and Compare run on the counties nationwide, or on one state.";

/** Commands a tile layer turns off (ids from core/commands.js). */
export const SCOPED_COMMANDS = new Set([
  "view-compare",
  "find",
  "filter-radius",
  "filter-buffer",
  "filter-draw",
  "run-analysis",
  "hot-spots",
  "count-points",
  "smooth-rate",
  "access",
]);

/** { viewOnly, reason } for a layer view (the focus layer). */
export function layerScope(layer) {
  const viewOnly = !!layer?.meta?.tiled;
  return { viewOnly, reason: viewOnly ? TILE_REASON : null };
}

/** Whether a command can run while `layer` is the focus. */
export const commandAllowed = (id, layer) => !SCOPED_COMMANDS.has(id) || !layerScope(layer).viewOnly;
