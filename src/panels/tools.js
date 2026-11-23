// Field tools on the map: measuring distances and areas (M), showing your own
// position (G) and going to a typed coordinate (the palette). Your position is
// never saved in a project or a share link.
import { plural } from "../catalog/format.js";
import { formatPosition } from "../core/settings.js";
import { formatMiles, measurePath } from "../geo/measure.js";
import { regionProjection } from "../geo/project.js";
import { createSketch } from "../map/sketch.js";
import { $, fill, h } from "../ui/dom.js";
import { getSettings } from "../ui/themes.js";

export function createTools(app) {
  const projection = regionProjection(app.catalog.region);
  const sketch = createSketch(app.atlas);
  const card = $("tool-card");
  let tool = null,
    me = null,
    place = null;

  const row = (label, value, id) => h("div", null, h("dt", { text: label }), h("dd", { id, text: value }));
  function show(title, rows, note, actions = []) {
    card.hidden = false;
    fill(
      card,
      h("div", { class: "tool-head" }, h("strong", { text: title }), h("button", { class: "iconbtn dismiss", "aria-label": "Close " + title, onclick: stop, text: "×" })),
      rows.length && h("dl", { class: "metrics" }, rows),
      note && h("p", { class: "subtle", text: note }),
      actions.length && h("div", { class: "tool-actions" }, actions),
    );
  }
  function stop() {
    sketch.clear();
    if (tool === "pick") app.atlas.capture(null);
    tool = null;
    card.hidden = true;
  }

  /** Waits for one click on the map and hands its [lon, lat] to onPick. */
  function pick(title, note, onPick) {
    stop();
    tool = "pick";
    show(title, [], note);
    app.atlas.capture({
      click: (lonlat) => {
        stop();
        onPick(lonlat);
      },
    });
  }

  /** Draws a closed area by clicking its corners, then hands the ring to onDone. */
  function drawArea(onDone) {
    stop();
    tool = "area";
    const card = (points) =>
      show("Draw an area", [], plural(points.length, "point") + " · Enter or the first point to finish · Backspace to undo · Esc to stop", [
        h("button", { class: "small-btn", id: "area-finish", text: "Finish", onclick: () => sketch.finish() }),
      ]);
    sketch.start({
      closed: true,
      onChange: card,
      onDone: (points) => {
        stop();
        onDone(points);
      },
      onCancel: stop,
    });
  }

  function renderMeasure(path, done) {
    const m = measurePath(path, projection);
    const rows = [row("Distance", formatMiles(m.miles), "measure-distance")];
    if (m.squareMiles != null)
      rows.push(row("Around", formatMiles(m.closedMiles), "measure-around"), row("Area", formatMiles(m.squareMiles, "sq mi"), "measure-area"));
    show(
      "Measure",
      rows,
      done
        ? path.length + " points · straight lines in the region's projection (" + (app.catalog.region.projection?.name || "local") + ")"
        : "Click to add points · Enter or the first point to finish · Backspace to undo · Esc to stop",
      done
        ? [
            h("button", { class: "small-btn", text: "Measure again", onclick: measure }),
            h("button", { class: "small-btn", text: "Clear", onclick: stop }),
          ]
        : [h("button", { class: "small-btn", id: "measure-finish", text: "Finish", onclick: () => sketch.finish() })],
    );
  }
  function measure() {
    if (tool === "measure" && sketch.active) return stop();
    tool = "measure";
    sketch.start({
      closed: true,
      onChange: (points, hover) => renderMeasure(hover ? [...points, hover] : points, false),
      onDone: (points) => renderMeasure(points, true),
      onCancel: stop,
    });
  }

  /** A circle of `metres` around a [lon, lat], drawn in the projected plane. */
  function circle(lonlat, metres, steps = 64) {
    const [cx, cy] = projection.forward(lonlat);
    const ring = Array.from({ length: steps + 1 }, (_, i) => {
      const t = (2 * Math.PI * (i % steps)) / steps;
      return projection.inverse([cx + metres * Math.cos(t), cy + metres * Math.sin(t)]);
    });
    return { type: "Polygon", coordinates: [ring] };
  }
  function drawMarks() {
    const features = [];
    if (me) {
      features.push({ type: "Feature", properties: { kind: "me" }, geometry: circle(me.lonlat, Math.max(me.accuracy, 5)) });
      features.push({ type: "Feature", properties: { kind: "me" }, geometry: { type: "Point", coordinates: me.lonlat } });
    }
    if (place) features.push({ type: "Feature", properties: { kind: "place" }, geometry: { type: "Point", coordinates: place } });
    app.atlas.setLocate(features);
  }
  const where = ([lon, lat]) => formatPosition(lat, lon, getSettings().coords);

  /** Finds your position with the browser (it asks you first) and marks it. */
  function locate() {
    if (!navigator.geolocation) throw new Error("This browser cannot share your location.");
    app.status("Finding your location…", "running");
    return new Promise((resolve) =>
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          me = { lonlat: [pos.coords.longitude, pos.coords.latitude], accuracy: pos.coords.accuracy || 0 };
          drawMarks();
          app.atlas.flyTo(me.lonlat, 12);
          app.notify("You are at " + where(me.lonlat) + " (within " + Math.round(me.accuracy) + " m).");
          app.idleStatus();
          resolve(me);
        },
        (err) => {
          app.idleStatus();
          app.notify(
            err.code === 1 ? "Location is turned off for this site." : "Your location is not available right now.",
            { error: true },
          );
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
      ),
    );
  }

  /** Marks a typed coordinate and flies to it. */
  function goto(lonlat) {
    place = lonlat;
    drawMarks();
    app.atlas.flyTo(lonlat, 11);
    app.notify("Showing " + where(lonlat) + ".");
  }

  return {
    measure,
    locate,
    goto,
    stop,
    sketch,
    projection,
    pick,
    drawArea,
    /** Enter, Backspace and Esc while drawing (Esc also stops picking); true when used. */
    key(e) {
      if (tool === "pick" && e.key === "Escape") {
        stop();
        return true;
      }
      return sketch.key(e);
    },
    /** Your last position { lonlat, accuracy }, or null. */
    get located() {
      return me;
    },
    get place() {
      return place;
    },
    get active() {
      return tool;
    },
  };
}
