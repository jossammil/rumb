// Reading a typed position: decimal degrees ("32.3, -90.18", "-90.18 32.3")
// or degrees, minutes and seconds ("32°18′N 90°11′W", "N 32 18 30 W 90 11").
// Returns [lon, lat] or null. Pure.

const HEMI = /[NSEW]/i;

/** A latitude or longitude from parts [degrees, minutes?, seconds?] and a sign. */
const fromParts = (parts, negative) => {
  const [d, m = 0, s = 0] = parts;
  if (m < 0 || m >= 60 || s < 0 || s >= 60) return NaN;
  const v = Math.abs(d) + m / 60 + s / 3600;
  return negative || d < 0 || Object.is(d, -0) ? -v : v;
};

/**
 * [lon, lat] from text, or null. Without hemisphere letters, two numbers are
 * read as latitude then longitude, as most sources write them, except that
 * "negative, positive" (a western longitude first, as in GeoJSON) is read the
 * other way round in this hemisphere. Four or six numbers are degrees and
 * minutes (and seconds).
 */
export function parseCoordinate(text) {
  const raw = String(text ?? "").trim();
  if (!raw || raw.length > 80) return null;
  const tokens = raw.toUpperCase().match(/[NSEW]|[-+]?\d+(?:\.\d+)?/g) || [];
  // Only digits, separators, degree signs and hemisphere letters may appear.
  if (/[^\d\s.,;:+\-°º'′"″NSEWnsew]/.test(raw)) return null;
  let lat, lon;
  if (tokens.some((t) => HEMI.test(t))) {
    // Group numbers with the letter that follows them (or, failing that, precedes them).
    const groups = [];
    let nums = [];
    const letterFirst = HEMI.test(tokens[0]);
    let pending = letterFirst ? tokens[0] : null;
    for (const t of letterFirst ? tokens.slice(1) : tokens) {
      if (HEMI.test(t)) {
        if (letterFirst) {
          groups.push([pending, nums]);
          pending = t;
        } else groups.push([t, nums]);
        nums = [];
      } else nums.push(Number(t));
    }
    if (letterFirst) groups.push([pending, nums]);
    if (groups.length !== 2 || groups.some(([, n]) => n.length < 1 || n.length > 3)) return null;
    for (const [h, n] of groups) {
      const v = fromParts(n, h === "S" || h === "W");
      if (h === "N" || h === "S") lat = v;
      else lon = v;
    }
  } else {
    const n = tokens.map(Number);
    if (n.length === 2) [lat, lon] = n;
    else if (n.length === 4) [lat, lon] = [fromParts(n.slice(0, 2)), fromParts(n.slice(2))];
    else if (n.length === 6) [lat, lon] = [fromParts(n.slice(0, 3)), fromParts(n.slice(3))];
    else return null;
    if (lat < 0 && lon > 0 && Math.abs(lat) <= 180 && lon <= 90) [lat, lon] = [lon, lat];
    else if (Math.abs(lat) > 90 && Math.abs(lon) <= 90) [lat, lon] = [lon, lat];
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return [lon, lat];
}
