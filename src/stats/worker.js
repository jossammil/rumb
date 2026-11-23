// The statistics worker: Moran analyses, hot spots, polygon contiguity and
// buffer outlines, off the main thread.
import { analyze } from "./stats.js";

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    let result;
    if (type === "analyze") result = await analyze(data);
    else if (type === "gistar") {
      const { hotSpots } = await import("./hotspots.js");
      result = await hotSpots(data);
    } else if (type === "weights") {
      const { polygonNeighbors } = await import("./weights.js");
      result = polygonNeighbors(data.features, data.rule);
    } else if (type === "buffer") {
      const { bufferOutline } = await import("./buffer.js");
      result = bufferOutline(data.geometries, data.metres);
    } else throw new Error("Unknown statistics request.");
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error.message ?? error) });
  }
};
