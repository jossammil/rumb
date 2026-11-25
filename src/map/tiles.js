// Vector tiles from one PMTiles file (pmtiles, BSD-3), read by range requests
// on the same origin. A lazy chunk, loaded the first time a tile layer is read,
// so nothing of it is part of the first map. It takes MapLibre's addProtocol
// from the map (map.js) rather than importing MapLibre, which would split
// MapLibre out of the main bundle.
import { Protocol } from "pmtiles";

let registered = false;
/** Lets MapLibre read "pmtiles://<url>" sources; safe to call more than once. */
export function registerTiles(addProtocol) {
  if (registered) return;
  registered = true;
  addProtocol("pmtiles", new Protocol().tile);
}
