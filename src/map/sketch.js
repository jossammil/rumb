// Drawing on the map by clicking: the measure tool and the polygon filter use
// it. Click to add a point, move to preview the next one; Enter (or a click on
// the first point) finishes, Backspace takes the last point back, Esc cancels.
// It draws through the map's sketch source and reads clicks by capturing them.

/** createSketch(atlas) → { start(options), stop(), clear(), undo(), finish(), key(event), active, points } */
export function createSketch(atlas) {
  let points = [],
    hover = null,
    opts = null;

  function features() {
    const path = hover && opts?.preview !== false ? [...points, hover] : points;
    const out = points.map((p, i) => ({
      type: "Feature",
      properties: { i },
      geometry: { type: "Point", coordinates: p },
    }));
    if (path.length >= 2)
      out.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: opts?.closed ? [...path, path[0]] : path } });
    if (path.length >= 3 && opts?.area !== false)
      out.push({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...path, path[0]]] } });
    return out;
  }
  function draw() {
    atlas.setSketch(features());
    opts?.onChange?.(points, hover);
  }
  /** True when a click lands close to the first point (in screen pixels). */
  function nearFirst(lonlat) {
    if (points.length < 3) return false;
    const a = atlas.map.project(points[0]),
      b = atlas.map.project(lonlat);
    return Math.hypot(a.x - b.x, a.y - b.y) < 10;
  }

  const api = {
    /** start({ closed, area, onChange(points, hover), onDone(points), onCancel() }) */
    start(options = {}) {
      api.stop();
      opts = options;
      points = [];
      hover = null;
      atlas.capture({
        click: (lonlat) => {
          if (opts?.closed && nearFirst(lonlat)) return api.finish();
          points.push(lonlat);
          draw();
        },
        move: (lonlat) => {
          hover = lonlat;
          draw();
        },
      });
      draw();
    },
    /** Ends drawing; keeps the shape on the map unless `clear`. */
    stop(clear = true) {
      if (!opts) return;
      atlas.capture(null);
      opts = null;
      hover = null;
      if (clear) {
        points = [];
        atlas.setSketch([]);
      }
    },
    /** Removes the drawing, finished or not. */
    clear() {
      api.stop();
      points = [];
      atlas.setSketch([]);
    },
    undo() {
      points.pop();
      draw();
    },
    finish() {
      const done = opts?.onDone,
        finished = points;
      hover = null;
      atlas.setSketch(features());
      api.stop(false);
      done?.(finished);
    },
    cancel() {
      const cancel = opts?.onCancel;
      api.stop();
      cancel?.();
    },
    /** Handles Enter, Backspace and Esc while drawing; true when the key was used. */
    key(e) {
      if (!opts) return false;
      if (e.key === "Escape") api.cancel();
      else if (e.key === "Enter") api.finish();
      else if (e.key === "Backspace" || e.key === "Delete") api.undo();
      else return false;
      return true;
    },
    get active() {
      return !!opts;
    },
    get points() {
      return points;
    },
  };
  return api;
}
