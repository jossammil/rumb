// The MapLibre map: the region backdrop, the stack of data layers (one source
// each, see map/layer-specs.js), Compare's own source, the selection, click
// picking with layer identity, fitting, and repainting when the theme changes.
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { buildStyle, graticuleLines, mapColors, themedPaint } from "./basemap-style.js";
import { ANCHORS, layerSpecs, sourceId, specShape } from "./layer-specs.js";
import { addShapeImages } from "./shapes.js";

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

const collection = (features) => ({ type: "FeatureCollection", features });

/**
 * initMap({ region, regionPath, onSelect({ layer, id, lngLat, additive }), onPointer(lngLat|null) })
 * → { map, ready, fit, addLayer, removeLayer, setData, setStyle, setVisible, syncStack,
 *     setCompare, select, visibleIds, camera, graticule, retheme }
 * `layer` in onSelect is a rumb layer id, or "cmp" while Compare is showing.
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

  let gridLoaded = false;
  // Roads wait until the first map has drawn, so they never delay it.
  map.once("idle", () => {
    if (region.backdrop?.roads && map.getSource("roads"))
      map.getSource("roads").setData(regionPath + region.backdrop.roads);
  });

  const ready = new Promise((resolve, reject) => {
    map.once("load", () => {
      addShapeImages(map);
      resolve();
    });
    const fail = (e) => {
      if (/WebGL.*(fail|support)/i.test(String(e.error))) reject(e.error);
    };
    map.on("error", fail);
    map.once("load", () => map.off("error", fail));
  });

  // Stacked layers: id → { kind, style, specs, byId, visible }; order bottom → top.
  const layers = new Map();
  let order = [];
  let comparing = false;
  let popupNow = null;
  let orderKey = "",
    roadsAt = "above";
  const cmpById = new Map();
  /** MapLibre layer id → rumb layer id, for the layers a click can pick. */
  const pickable = new Map([["cmp-fill", "cmp"]]);

  const specsFor = (id) => {
    const l = layers.get(id);
    return layerSpecs(id, l.kind, mapColors(), l.style, l.tiled);
  };
  /** A tile layer's feature-state target for one feature id. */
  const tileFeature = (id, l, featureId) => ({ source: sourceId(id), sourceLayer: l.tiled.sourceLayer, id: featureId });
  /** A picked feature's rumb id: its property, or a tile feature's promoted id. */
  const pickedId = (f) => String(f.properties.__rumb_id ?? f.id);
  // Visibility is set only where it changes: every style change costs a redraw.
  const shown = new Map();
  const show = (id, on) => {
    const value = on ? "visible" : "none";
    if (shown.get(id) === value) return;
    shown.set(id, value);
    map.setLayoutProperty(id, "visibility", value);
  };
  function applyVisibility() {
    for (const [, l] of layers) for (const s of l.specs) show(s.id, l.visible && !comparing);
    for (const id of ["cmp-fill", "cmp-outline"]) show(id, comparing);
  }
  function interactiveLayers() {
    if (comparing) return ["cmp-fill"];
    return [...layers.entries()]
      .filter(([, l]) => l.visible)
      .flatMap(([, l]) => l.specs.filter((s) => s.interactive).map((s) => s.id));
  }
  const hits = (point) => {
    const ids = interactiveLayers().filter((id) => map.getLayer(id));
    return ids.length ? map.queryRenderedFeatures(point, { layers: ids }) : [];
  };
  // A tool (measuring, drawing, placing) can take the map's clicks and moves.
  let captured = null;
  map.on("click", (e) => {
    if (captured) return captured.click?.(e.lngLat.toArray(), e);
    // Every layer hit at the point, top first, one feature per layer.
    const seen = new Set();
    const found = [];
    for (const f of hits(e.point)) {
      const layer = pickable.get(f.layer.id);
      if (seen.has(layer)) continue;
      seen.add(layer);
      found.push({ layer, id: pickedId(f) });
    }
    if (found.length)
      onSelect({ ...found[0], hits: found, lngLat: e.lngLat, additive: e.originalEvent?.shiftKey || false });
  });
  map.on("mousemove", (e) => {
    if (captured) {
      captured.move?.(e.lngLat.toArray());
      onPointer(e.lngLat);
      return;
    }
    map.getCanvas().style.cursor = hits(e.point).length ? "pointer" : "";
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

  const api = {
    map,
    ready,
    fit,
    /** Registers a URL scheme MapLibre can load sources from (map/tiles.js). */
    addProtocol: (name, load) => maplibregl.addProtocol(name, load),
    /** Hands clicks and moves to a tool ({ click(lonlat), move(lonlat) }), or back with null. */
    capture(handlers) {
      captured = handlers;
      map.getCanvas().style.cursor = handlers ? "crosshair" : "";
      if (handlers) map.doubleClickZoom.disable();
      else map.doubleClickZoom.enable();
    },
    /** Draws the spatial filter's outline: GeoJSON features. */
    setFilterShape(features) {
      map.getSource("filter").setData(collection(features || []));
    },
    /** Draws an analysis's shapes (a scan's windows and centers), or clears them. */
    setAnalysisShapes(features) {
      map.getSource("analysis")?.setData(collection(features || []));
    },
    /** Draws a tool's shape: GeoJSON features (points, a line, a polygon). */
    setSketch(features) {
      map.getSource("sketch").setData(collection(features || []));
    },
    /** Marks positions: features with properties.kind "me" (with an accuracy polygon) or "place". */
    setLocate(features) {
      map.getSource("locate").setData(collection(features || []));
    },
    /** Flies to a [lon, lat] at a zoom (never zooming out). */
    flyTo(lonlat, zoom = 12) {
      map.flyTo({ center: lonlat, zoom: Math.max(map.getZoom(), zoom), duration: 700 });
    },
    /** Opens a popup holding `content` (an element) at a position; closes any other. */
    popup(lngLat, content) {
      popupNow?.remove();
      popupNow = new maplibregl.Popup({ closeButton: true, maxWidth: "300px", className: "rumb-popup" })
        .setLngLat(lngLat)
        .setDOMContent(content)
        .addTo(map);
      return popupNow;
    },
    closePopup() {
      popupNow?.remove();
      popupNow = null;
    },
    /**
     * Adds a layer's source and MapLibre layers (once); kind from layer-specs
     * KINDS. `tiled` ({ url, sourceLayer, idField, minzoom, maxzoom }) makes the
     * source vector tiles, with features identified by idField.
     */
    addLayer(id, kind, style = {}, tiled = null) {
      if (layers.has(id)) return;
      map.addSource(
        sourceId(id),
        tiled
          ? { type: "vector", url: tiled.url, promoteId: tiled.idField, minzoom: tiled.minzoom, maxzoom: tiled.maxzoom }
          : { type: "geojson", data: collection([]) },
      );
      const l = { kind, style, specs: [], byId: new Map(), visible: true, tiled, picked: { selected: [], neighbor: [] } };
      layers.set(id, l);
      l.specs = specsFor(id);
      for (const s of l.specs) {
        map.addLayer(s.spec, ANCHORS[s.band]);
        if (s.interactive) pickable.set(s.id, id);
      }
      order.push(id);
      orderKey = "";
      applyVisibility();
    },
    removeLayer(id) {
      const l = layers.get(id);
      if (!l) return;
      for (const s of l.specs) {
        if (map.getLayer(s.id)) map.removeLayer(s.id);
        pickable.delete(s.id);
        shown.delete(s.id);
      }
      map.removeSource(sourceId(id));
      layers.delete(id);
      order = order.filter((x) => x !== id);
      orderKey = "";
    },
    has: (id) => layers.has(id),
    /**
     * Features must carry properties.__rumb_id and __rumb_color. A tile layer
     * takes them as feature-state (color, out, unreliable), replacing every
     * earlier state, then puts its selection back.
     */
    setData(id, features) {
      const l = layers.get(id);
      if (!l) return;
      l.byId = new Map(features.map((f) => [String(f.properties.__rumb_id), f]));
      if (!l.tiled) return map.getSource(sourceId(id)).setData(collection(features));
      map.removeFeatureState({ source: sourceId(id), sourceLayer: l.tiled.sourceLayer });
      for (const f of features) {
        const p = f.properties;
        map.setFeatureState(tileFeature(id, l, String(p.__rumb_id)), {
          color: p.__rumb_color,
          out: p.__rumb_out === true,
          unreliable: p.__rumb_unreliable === true,
        });
      }
      for (const role of ["selected", "neighbor"]) for (const fid of l.picked[role]) map.setFeatureState(tileFeature(id, l, fid), { [role]: true });
    },
    /** Changes a layer's look (DEFAULT_STYLE keys); layers are rebuilt when a shape or label comes or goes. */
    setStyle(id, style) {
      const l = layers.get(id);
      if (!l) return;
      const before = specShape(l.specs);
      l.style = style;
      l.specs = specsFor(id);
      if (specShape(l.specs) !== before) {
        for (const layer of map.getStyle().layers)
          if (layer.source === sourceId(id)) {
            map.removeLayer(layer.id);
            shown.delete(layer.id);
          }
        for (const s of l.specs) {
          map.addLayer(s.spec, ANCHORS[s.band]);
          if (s.interactive) pickable.set(s.id, id);
        }
        orderKey = "";
        api.syncStack(order);
        applyVisibility();
        return;
      }
      for (const s of l.specs) {
        for (const [prop, value] of Object.entries(s.spec.paint || {})) map.setPaintProperty(s.id, prop, value);
        for (const [prop, value] of Object.entries(s.spec.layout || {})) map.setLayoutProperty(s.id, prop, value);
      }
    },
    /** The style a layer was last given. */
    styleOf: (id) => layers.get(id)?.style,
    setVisible(id, visible) {
      const l = layers.get(id);
      if (!l) return;
      l.visible = visible;
      applyVisibility();
    },
    /** Puts layers in stack order (bottom → top) within each band; nothing moves when the order holds. */
    syncStack(ids) {
      const next = ids.filter((id) => layers.has(id));
      const key = next.map((id) => specShape(layers.get(id).specs)).join("|");
      if (key === orderKey) return;
      orderKey = key;
      order = next;
      for (const id of order) for (const s of layers.get(id).specs) map.moveLayer(s.id, ANCHORS[s.band]);
    },
    /** Shows Compare's areas (features with __rumb_id and __rumb_color) instead of the stack, or null to leave. */
    setCompare(features) {
      comparing = !!features;
      cmpById.clear();
      for (const f of features || []) cmpById.set(String(f.properties.__rumb_id), f);
      map.getSource("cmp").setData(collection(features || []));
      if (!comparing) map.getSource("selection").setData(collection([]));
      applyVisibility();
    },
    /** Outlines features of one layer (an id or a list) and dashes their neighbors. */
    select({ layer, ids = [], neighbors = [] } = {}) {
      const byId = layer === "cmp" ? cmpById : layers.get(layer)?.byId;
      const list = (Array.isArray(ids) ? ids : [ids]).filter((x) => x != null).map(String);
      // Tile layers mark their selection in feature-state (their features have no geometry here).
      for (const [lid, l] of layers) {
        if (!l.tiled) continue;
        const next = lid === layer ? { selected: list, neighbor: (neighbors || []).map(String) } : { selected: [], neighbor: [] };
        for (const role of ["selected", "neighbor"]) {
          for (const fid of l.picked[role]) map.setFeatureState(tileFeature(lid, l, fid), { [role]: false });
          for (const fid of next[role]) map.setFeatureState(tileFeature(lid, l, fid), { [role]: true });
        }
        l.picked = next;
      }
      const features = [];
      const add = (id, role) => {
        const f = byId?.get(String(id));
        if (f) features.push({ type: "Feature", geometry: f.geometry, properties: { role, id: String(id) } });
      };
      for (const id of neighbors || []) add(id, "neighbor");
      for (const id of list) add(id, "selected");
      map.getSource("selection").setData(collection(features));
    },
    /** IDs of a layer's features drawn in the current view. */
    visibleIds(id) {
      const l = layers.get(id);
      const shown = (l?.specs || []).filter((s) => s.interactive && map.getLayer(s.id)).map((s) => s.id);
      if (!shown.length) return [];
      return [...new Set(map.queryRenderedFeatures({ layers: shown }).map(pickedId))];
    },
    /** True once a layer has features drawn in the view (the first-map mark). */
    drawn: (id) => api.visibleIds(id).length > 0,
    camera() {
      return { center: map.getCenter().toArray(), zoom: map.getZoom() };
    },
    /** Draws the roads above area fills ("above") or below them ("below"). */
    setRoads(position) {
      if (position === roadsAt) return;
      roadsAt = position;
      for (const id of ["roads-secondary", "roads-primary"])
        if (map.getLayer(id)) map.moveLayer(id, position === "below" ? "cmp-fill" : "graticule");
    },
    /** Shows or hides the 1° grid over the region's backdrop. */
    graticule(on) {
      if (!map.getLayer("graticule")) return;
      if (on && !gridLoaded) {
        gridLoaded = true;
        map.getSource("graticule").setData(graticuleLines(region.backdrop?.extent || [-180, -85, 180, 85]));
      }
      map.setLayoutProperty("graticule", "visibility", on ? "visible" : "none");
    },
    /** Re-reads the theme's map tokens and repaints the backdrop and every stacked layer. */
    retheme() {
      for (const [layer, paint] of Object.entries(themedPaint(mapColors())))
        if (map.getLayer(layer))
          for (const [prop, value] of Object.entries(paint)) map.setPaintProperty(layer, prop, value);
      for (const [id, l] of layers) api.setStyle(id, l.style);
    },
  };
  return api;
}
