import { analyze } from "./stats.js";

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    let result;
    if (type === "analyze") result = await analyze(data);
    else if (type === "weights") {
      const { polygonNeighbors } = await import("./stats-weights.js");
      result = polygonNeighbors(data.features, data.rule);
    } else throw new Error("Unknown statistics request.");
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error.message ?? error) });
  }
};
