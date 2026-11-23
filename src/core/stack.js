// The layer stack: which layers the map draws, in which order (bottom to top),
// and whether each is shown. The focus layer (state.active) is the one the
// style panel, inspector and analysis act on; it is always in the stack.
// Every function returns a new array and leaves its input alone.

/** A stack entry with its defaults. */
export const stackEntry = (id, extra = {}) => ({ id, visible: true, ...extra });

/** Adds a layer on top, or leaves the stack as it is when the layer is there. */
export const withLayer = (stack, id, extra) =>
  stack.some((e) => e.id === id) ? stack : [...stack, stackEntry(id, extra)];

export const withoutLayer = (stack, id) => stack.filter((e) => e.id !== id);

/** Moves a layer up (+1, toward the top) or down (-1). */
export function moveLayer(stack, id, delta) {
  const i = stack.findIndex((e) => e.id === id),
    j = i + delta;
  if (i < 0 || j < 0 || j >= stack.length) return stack;
  const next = [...stack];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export const setVisible = (stack, id, visible) =>
  stack.map((e) => (e.id === id ? { ...e, visible } : e));

export const updateEntry = (stack, id, patch) =>
  stack.map((e) => (e.id === id ? { ...e, ...patch } : e));

/**
 * A saved stack made safe: well-formed entries, no duplicates, only known
 * layers (when `known(id)` is given), and the focus layer always present and shown.
 */
export function normalizeStack(stack, active, known = () => true) {
  const seen = new Set();
  const out = [];
  for (const e of Array.isArray(stack) ? stack : []) {
    const id = typeof e === "string" ? e : e?.id;
    if (typeof id !== "string" || seen.has(id) || !known(id)) continue;
    seen.add(id);
    out.push(stackEntry(id, typeof e === "object" ? { ...e, id, visible: e.visible !== false } : {}));
  }
  if (!seen.has(active)) out.push(stackEntry(active));
  return out.map((e) => (e.id === active ? { ...e, visible: true } : e));
}

/** Ids of the layers to draw, bottom to top. */
export const drawnIds = (stack) => stack.filter((e) => e.visible).map((e) => e.id);
