// The status bar's readouts: cursor position, zoom, the last timing, the SQL
// engine and the network. The status text itself is set by main.js (status()).
import { formatPosition } from "../core/settings.js";
import { $ } from "./dom.js";
import { getSettings, update } from "./themes.js";

export function createStatusbar(app) {
  const value = (id) => $(id).querySelector("span");
  let last = null;
  function position(lngLat) {
    last = lngLat || last;
    value("sb-coords").textContent = lngLat
      ? formatPosition(lngLat.lat, lngLat.lng, getSettings().coords)
      : "—";
  }
  const zoom = () => (value("sb-zoom").textContent = app.atlas.map.getZoom().toFixed(1));
  function timing() {
    const t = app.timings;
    const parts = [];
    if (t.lastQuery != null) parts.push("sql " + t.lastQuery + " ms");
    if (t.lastAnalysis != null) parts.push("lisa " + t.lastAnalysis + " ms");
    value("sb-time").textContent = parts.join(" · ") || "—";
  }
  function database(state) {
    value("sb-db").textContent = state;
    $("sb-db").classList.toggle("on", state === "ready");
  }
  function network(text, on = navigator.onLine) {
    value("sb-net").textContent = text || (navigator.onLine ? "online" : "offline");
    $("sb-net").classList.toggle("on", on);
  }

  $("sb-coords").addEventListener("click", () => {
    update({ coords: getSettings().coords === "dms" ? "dd" : "dms" });
    if (last) position(last);
  });
  app.atlas.map.on("zoom", zoom);
  zoom();
  addEventListener("online", () => network());
  addEventListener("offline", () => network());
  network();
  return { position, timing, database, network };
}
