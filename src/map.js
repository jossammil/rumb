import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { saveBlob } from "./ui.js";

const empty = { type: "FeatureCollection", features: [] };
const boundsMS = [
  [-91.66, 30.16],
  [-88.08, 35.02],
];
const kind = (name) => ["==", ["get", "kind"], name];
const water = "#c9ddda";
const land = "#e9ecdf";
const label = {
  "text-font": ["Arial"],
  "text-field": ["get", "name"],
  "text-size": 11,
  "text-padding": 4,
};
const labelsPaint = {
  "text-color": "#566858",
  "text-halo-color": "#f5f7ef",
  "text-halo-width": 1.4,
};

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

export function initMap(onSelect) {
  const states = [
    ["ARKANSAS", -92.65, 34.45],
    ["LOUISIANA", -92.48, 31.15],
    ["ALABAMA", -86.9, 32.55],
    ["TENNESSEE", -88.8, 35.83],
    ["GEORGIA", -83.45, 32.65],
    ["TEXAS", -95.8, 31.3],
    ["Gulf of Mexico", -89.5, 29.25],
  ].map(([name, lon, lat]) => ({
    type: "Feature",
    properties: { name },
    geometry: { type: "Point", coordinates: [lon, lat] },
  }));
  const src = (data) => ({ type: "geojson", data });
  const map = new maplibregl.Map({
    container: "map",
    bounds: boundsMS,
    fitBoundsOptions: { padding: { top: 38, bottom: 38, left: 40, right: 40 } },
    attributionControl: false,
    canvasContextAttributes: { preserveDrawingBuffer: true },
    dragRotate: false,
    pitchWithRotate: false,
    style: {
      version: 8,
      sources: {
        world: src(empty),
        context: src("./data/context.geojson"),
        stateNames: src({ type: "FeatureCollection", features: states }),
        area: src(empty),
      },
      layers: [
        {
          id: "ocean",
          type: "background",
          paint: { "background-color": water },
        },
        {
          id: "world-land",
          type: "fill",
          source: "world",
          paint: { "fill-color": land },
        },
        {
          id: "land",
          type: "fill",
          source: "context",
          filter: kind("land"),
          paint: { "fill-color": land },
        },
        {
          id: "lakes",
          type: "fill",
          source: "context",
          filter: kind("lakes"),
          paint: { "fill-color": water },
        },
        {
          id: "rivers",
          type: "line",
          source: "context",
          filter: kind("rivers"),
          paint: {
            "line-color": "#9cbfbd",
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              4,
              0.65,
              8,
              1.9,
            ],
          },
        },
        {
          id: "states",
          type: "line",
          source: "context",
          filter: kind("states"),
          paint: {
            "line-color": "#a9b5a2",
            "line-width": 1.35,
            "line-dasharray": [5, 2],
          },
        },
        {
          id: "areas",
          type: "fill",
          source: "area",
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: {
            "fill-color": ["get", "__atlas_color"],
            "fill-opacity": 0.94,
          },
        },
        {
          id: "outlines",
          type: "line",
          source: "area",
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: {
            "line-color": "#fcfdf3",
            "line-opacity": 0.68,
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              4,
              0.35,
              7,
              0.75,
              11,
              1.4,
            ],
          },
        },
        {
          id: "lines",
          type: "line",
          source: "area",
          filter: ["==", ["geometry-type"], "LineString"],
          paint: { "line-color": ["get", "__atlas_color"], "line-width": 3 },
        },
        {
          id: "points",
          type: "circle",
          source: "area",
          filter: ["==", ["geometry-type"], "Point"],
          paint: {
            "circle-radius": 5,
            "circle-color": ["get", "__atlas_color"],
            "circle-stroke-color": "#fff",
            "circle-stroke-width": 1,
          },
        },
        {
          id: "neighbors",
          type: "line",
          source: "area",
          filter: ["==", ["get", "__atlas_id"], ""],
          paint: {
            "line-color": "#3d505c",
            "line-width": 2,
            "line-dasharray": [2, 1],
          },
        },
        {
          id: "selected",
          type: "line",
          source: "area",
          filter: ["==", ["get", "__atlas_id"], ""],
          paint: { "line-color": "#1d2933", "line-width": 3.3 },
        },
        {
          id: "selected-point",
          type: "circle",
          source: "area",
          filter: [
            "all",
            ["==", ["geometry-type"], "Point"],
            ["==", ["get", "__atlas_id"], ""],
          ],
          paint: {
            "circle-color": "#132f27",
            "circle-radius": 6,
            "circle-stroke-width": 3,
            "circle-stroke-color": "#fff",
          },
        },
        {
          id: "state-names",
          type: "symbol",
          source: "stateNames",
          layout: { ...label, "text-size": 12, "text-letter-spacing": 0.17 },
          paint: {
            ...labelsPaint,
            "text-color": "#849480",
            "text-halo-width": 1,
          },
        },
        {
          id: "town-dots",
          type: "circle",
          source: "context",
          filter: kind("places"),
          paint: {
            "circle-radius": 1.8,
            "circle-color": "#5e6e61",
            "circle-stroke-color": "#f4f5ed",
            "circle-stroke-width": 0.6,
          },
        },
        {
          id: "towns",
          type: "symbol",
          source: "context",
          filter: kind("places"),
          layout: { ...label, "text-offset": [0, 0.8], "text-anchor": "top" },
          paint: labelsPaint,
        },
      ],
    },
  });
  map.touchZoomRotate.disableRotation();
  let globalLandLoaded = false;
  map.on("moveend", () => {
    const b = map.getBounds();
    if (
      !globalLandLoaded &&
      map.getSource("world") &&
      (b.getWest() < -98 ||
        b.getEast() > -82 ||
        b.getSouth() < 26 ||
        b.getNorth() > 39)
    ) {
      globalLandLoaded = true;
      map.getSource("world").setData("./data/world-land.geojson");
    }
  });
  map.addControl(
    new maplibregl.ScaleControl({ maxWidth: 80, unit: "imperial" }),
    "bottom-right",
  );
  const ready = new Promise((resolve, reject) => {
    map.once("load", resolve);
    const fail = (e) => {
      if (/WebGL.*(fail|support)/i.test(String(e.error))) reject(e.error);
    };
    map.on("error", fail);
    map.once("load", () => map.off("error", fail));
  });
  const hits = (e) =>
    map.queryRenderedFeatures(e.point, {
      layers: ["points", "lines", "areas"],
    });
  map.on("click", (e) => {
    const f = hits(e)[0];
    if (f) onSelect(f.properties.__atlas_id);
  });
  map.on("mousemove", (e) => {
    map.getCanvas().style.cursor = hits(e).length ? "pointer" : "";
  });
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
    draw(features) {
      map.getSource("area").setData({ type: "FeatureCollection", features });
    },
    select(id, neighbors) {
      const f = Array.isArray(id)
        ? ["in", ["get", "__atlas_id"], ["literal", id]]
        : ["==", ["get", "__atlas_id"], id ?? ""];
      map.setFilter("selected", ["all", ["!=", ["geometry-type"], "Point"], f]);
      map.setFilter("selected-point", [
        "all",
        ["==", ["geometry-type"], "Point"],
        f,
      ]);
      map.setFilter("neighbors", [
        "in",
        ["get", "__atlas_id"],
        ["literal", neighbors || []],
      ]);
    },
    camera() {
      return { center: map.getCenter().toArray(), zoom: map.getZoom() };
    },
    async image(title, subtitle, legend, notes) {
      await new Promise((resolve) => {
        map.once("idle", resolve);
        map.triggerRepaint();
      });
      const canvas = document.createElement("canvas"),
        input = map.getCanvas();
      const ratio = input.width / Math.max(1, input.clientWidth),
        header = 75,
        bottom = 74;
      canvas.width = input.width;
      canvas.height = input.height + (header + bottom) * ratio;
      const ctx = canvas.getContext("2d");
      ctx.scale(ratio, ratio);
      const w = canvas.width / ratio,
        h = input.height / ratio;
      ctx.fillStyle = "#fbfcf7";
      ctx.fillRect(0, 0, w, h + header + bottom);
      ctx.fillStyle = "#204739";
      ctx.font = "26px Georgia";
      ctx.fillText(title, 16, 32, w - 32);
      ctx.font = "14px Arial";
      ctx.fillText(subtitle, 16, 56, w - 32);
      ctx.drawImage(input, 0, header, w, h);
      ctx.font = "12px Arial";
      let x = 16;
      const parts = legend.length,
        cell = (w - 32) / Math.max(1, parts);
      legend.forEach(({ color, text }) => {
        ctx.fillStyle = color;
        ctx.fillRect(x, h + header + 10, cell - 3, 8);
        ctx.fillStyle = "#284537";
        ctx.fillText(text, x, h + header + 35, cell - 4);
        x += cell;
      });
      ctx.font = "11px Arial";
      ctx.fillText(notes, 16, h + header + 59, w - 32);
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!blob)
        throw new Error("This browser could not encode the map image.");
      saveBlob(blob, "rumb-map.png");
    },
  };
}
