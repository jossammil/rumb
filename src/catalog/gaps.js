// Areas a source reports few measures for, which a library layer lists as
// meta.gaps = [{ ids, note }] (Connecticut's planning regions in County Health
// Rankings, nationally). Pure.
import { featureId } from "../core/features.js";

/**
 * "9 in Connecticut, whose …" for each gap with missing values among
 * `features`, where `values[i]` is feature i's value (null when missing).
 */
export function gapNotes(meta, features, values) {
  const notes = [];
  for (const gap of meta?.gaps || []) {
    const ids = new Set(gap.ids);
    const n = features.reduce((count, f, i) => count + (values[i] == null && ids.has(featureId(f)) ? 1 : 0), 0);
    if (n) notes.push(n + " " + gap.note);
  }
  return notes;
}
