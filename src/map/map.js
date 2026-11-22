// The MapLibre map: region backdrop, one data source, click selection,
// fitting, highlighting, and repainting the backdrop when the theme changes.
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { buildStyle, DATA_LAYERS, mapColors, themedPaint } from "./basemap-style.js";

function extent(collection) {
  const bounds = new maplibregl.LngLatBounds();
  function walk(coords) {
    if (typeof coords?.[0] === "number") bounds.extend([coords[0], coords[1]]);
    else if (Array.isArray(coords)) coords.forEach(walk);
  }
  function geometry(g) {
    if (g?.geometries) g.geometries.forEach(geometry);
    else walk(g?.coordinates);
  }
  collection.features.forEach((f) => geometry(f.geometry));
  return bounds;
}

/**
 * initMap({ region, regionPath, onSelect(id), onPointer(lngLat|null) })
 * → { map, ready, fit, draw, select, camera, retheme }
 */
export function initMap({ region, regionPath, onSelect, onPointer = () => {} }) {
  const map = new maplibregl.Map({
    container: "map",
    bounds: region.bounds,
    fitBoundsOptions: { padding: { top: 38, bottom: 38, left: 40, right: 40 } },
    attributionControl: false,
    canvasContextAttributes: { preserveDrawingBuffer: true },
    dragRotate: false,
    pitchWithRotate: false,
    style: buildStyle(region, regionPath),
  });
  map.touchZoomRotate.disableRotation();

  // The world outline loads only once the view leaves the regional backdrop.
  const [west, south, east, north] = region.backdrop?.extent || [-180, -90, 180, 90];
  let worldLoaded = !region.backdrop?.world;
  map.on("moveend", () => {
    const b = map.getBounds();
    if (
      !worldLoaded &&
      map.getSource("world") &&
      (b.getWest() < west || b.getEast() > east || b.getSouth() < south || b.getNorth() > north)
    ) {
      worldLoaded = true;
      map.getSource("world").setData(regionPath + region.backdrop.world);
    }
  });
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 80, unit: "imperial" }), "bottom-right");

  const ready = new Promise((resolve, reject) => {
    map.once("load", resolve);
    const fail = (e) => {
      if (/WebGL.*(fail|support)/i.test(String(e.error))) reject(e.error);
    };
    map.on("error", fail);
    map.once("load", () => map.off("error", fail));
  });
  const hits = (e) => map.queryRenderedFeatures(e.point, { layers: DATA_LAYERS });
  map.on("click", (e) => {
    const f = hits(e)[0];
    if (f) onSelect(f.properties.__rumb_id);
  });
  map.on("mousemove", (e) => {
    map.getCanvas().style.cursor = hits(e).length ? "pointer" : "";
    onPointer(e.lngLat);
  });
  map.getCanvasContainer().addEventListener("mouseleave", () => onPointer(null));

  function fit(data, duration = 400) {
    const b = extent(data);
    if (!b.isEmpty())
      map.fitBounds(b, {
        padding: { top: 65, bottom: 55, left: 45, right: 45 },
        maxZoom: 13,
        duration,
      });
  }
  return {
    map,
    ready,
    fit,
    /** Features must carry properties.__rumb_id and __rumb_color. */
    draw(features) {
      map.getSource("area").setData({ type: "FeatureCollection", features });
    },
    /** Outlines one ID (or a list) and dashes its neighbors. */
    select(id, neighbors) {
      const f = Array.isArray(id)
        ? ["in", ["get", "__rumb_id"], ["literal", id]]
        : ["==", ["get", "__rumb_id"], id ?? ""];
      map.setFilter("selected", ["all", ["!=", ["geometry-type"], "Point"], f]);
      map.setFilter("selected-point", ["all", ["==", ["geometry-type"], "Point"], f]);
      map.setFilter("neighbors", ["in", ["get", "__rumb_id"], ["literal", neighbors || []]]);
    },
    /** IDs of data features drawn in the current view. */
    visibleIds() {
      return [
        ...new Set(
          map.queryRenderedFeatures({ layers: ["areas"] }).map((f) => f.properties.__rumb_id),
        ),
      ];
    },
    camera() {
      return { center: map.getCenter().toArray(), zoom: map.getZoom() };
    },
    /** Re-reads the theme's map tokens and repaints the backdrop. */
    retheme() {
      for (const [layer, paint] of Object.entries(themedPaint(mapColors())))
        if (map.getLayer(layer))
          for (const [prop, value] of Object.entries(paint)) map.setPaintProperty(layer, prop, value);
    },
  };
}
