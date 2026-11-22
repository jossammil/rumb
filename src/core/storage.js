// Small per-browser preferences in localStorage, under the "rumb." prefix.
// Storage can be missing or full (private windows, blocked site data), so
// every read falls back and every write is allowed to fail quietly.
const PREFIX = "rumb.";

export function load(key, fallback) {
  try {
    const raw = globalThis.localStorage?.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    globalThis.localStorage?.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* Preferences are a convenience; the app works without them. */
  }
}
