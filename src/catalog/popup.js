// What a feature's popup (and the inspector) lists: rows from a layer's
// catalog popup fields, each formatted by its field's format. Pure.
import { number } from "./format.js";

/** A value as text for its field ({ format, unit }); null when there is nothing to show. */
export function formatValue(value, info = {}) {
  if (value == null || value === "" || (typeof value === "number" && !Number.isFinite(value))) return null;
  if (typeof value !== "number") return String(value);
  switch (info.format) {
    case "percent":
      return number(value, 1) + (info.unit || "%");
    case "currency":
      return "$" + number(value, 0);
    case "integer":
      return number(value, 0);
    case "rate":
      return number(value, 1);
    default:
      return number(value, 2) + (info.unit || "");
  }
}

const NOT_SHOWN = /^(__|ogc_fid$|fid$)/i;

/**
 * Popup rows [{ field, label, text, href }] for a feature's properties. A layer
 * with popupFields lists those; any other lists its first `limit` fields.
 * `skip` leaves fields out (the title, say).
 */
export function popupRows(meta, props, { skip = [], limit = 8 } = {}) {
  const fields = meta?.popupFields?.length
    ? meta.popupFields
    : Object.keys(props || {}).filter((k) => !NOT_SHOWN.test(k)).slice(0, limit);
  const rows = [];
  for (const field of fields) {
    if (skip.includes(field)) continue;
    const info = meta?.fields?.[field];
    const text = formatValue(props?.[field], info);
    if (text == null) continue;
    const href =
      info?.format === "url" && /^https?:\/\//i.test(text)
        ? text
        : info?.format === "phone" && /\d{3}.*\d{4}/.test(text)
          ? "tel:" + text.replace(/[^0-9+]/g, "")
          : null;
    rows.push({ field, label: info?.label || field.replaceAll("_", " "), text, href });
  }
  return rows;
}

/** A feature's title: its label field, else a name, else "Feature <id>". */
export const featureTitle = (props, id, labelField) =>
  String(props?.[labelField] ?? props?.name ?? props?.NAME ?? "Feature " + id);
