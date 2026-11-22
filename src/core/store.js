// A tiny observable store: one state object, shallow patches, and listeners
// that are told which keys changed. Panels still render on purpose; the store
// lets passive views (the status bar, titles) follow along without wiring.

/**
 * createStore({ view: "map" }) → { state, set({ view: "sql" }), replace(next), subscribe(fn) }
 * Listeners receive (state, changedKeys: Set).
 */
export function createStore(initial) {
  let state = initial;
  const listeners = new Set();
  const notify = (keys) => {
    for (const fn of listeners) fn(state, keys);
  };
  return {
    get state() {
      return state;
    },
    /** Merges a shallow patch into the state; listeners hear only real changes. */
    set(patch) {
      const keys = Object.keys(patch).filter((k) => !Object.is(state[k], patch[k]));
      Object.assign(state, patch);
      if (keys.length) notify(new Set(keys));
    },
    /** Swaps in a whole new state (opening a project). */
    replace(next) {
      state = next;
      notify(new Set(Object.keys(next)));
    },
    /** Tells listeners that nested data changed in place (a layer's comparison, say). */
    touch(...keys) {
      notify(new Set(keys));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
