// Share links: the map's state packed into the link itself, after
// #state=, so nothing is uploaded and the server never sees it (the part
// after # stays in the browser). Only built-in data travels: the camera, the
// stacked catalog layers and their looks, styles and classes, the filter,
// the selection and Compare's settings for the reference layer. Imported
// files, SQL, query layers and analysis results never go into a link.
// Format: "1." + base64url(deflate-raw(JSON)), or "0." + base64url(JSON)
// where the browser cannot compress. Pure apart from CompressionStream.
import { normalizeFilter } from "../geo/filter.js";
import { METHODS } from "../stats/methods.js";
import { rateSpec } from "../stats/rates.js";
import { WEIGHT_KINDS } from "../stats/neighbors.js";

/** Longest link part rumb writes (characters after #state=). */
export const SHARE_LIMIT = 8000;
const VIEW_KEYS = [
  "measure", "category", "palette", "classification", "count", "breaks",
  "method", "inference", "yField", "scan", "rule", "k", "band", "power", "symmetric", "study", "permutations", "seed", "fdr",
];
const LOOK_KEYS = ["color", "opacity", "size", "shape", "outline", "outlineColor", "hatch"];

const toBase64Url = (bytes) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromBase64Url = (text) => {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
};
async function through(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
const canCompress = () => typeof CompressionStream === "function";
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj?.[k] !== undefined && obj[k] !== null).map((k) => [k, obj[k]]));

/**
 * What a link carries for a state: compact JSON. `isShared(id)` says whether
 * a layer id may travel (the reference layer and catalog layers).
 */
export function shareState(state, { camera, isShared, reference }) {
  const stack = state.stack.filter((e) => isShared(e.id));
  const focus = isShared(state.active) ? state.active : reference;
  const views = {};
  for (const e of stack)
    if (e.id !== focus && state.layerViews?.[e.id]) views[e.id] = pick(state.layerViews[e.id], VIEW_KEYS);
  const own = focus === state.active;
  const data = {
    v: 1,
    r: state.region,
    m: camera ? [round(camera.center[0], 5), round(camera.center[1], 5), round(camera.zoom, 2)] : undefined,
    a: focus,
    s: stack.map((e) => {
      const out = { i: e.id };
      if (!e.visible) out.h = 1;
      const look = pick(e.style, LOOK_KEYS);
      if (Object.keys(look).length) out.st = look;
      if (e.label) out.l = e.label;
      if (e.counts?.length) out.n = e.counts.filter(isShared);
      if (e.derived?.length) out.dv = e.derived.map((d) => [d.measure, d.methods]);
      return out;
    }),
    w: own ? pick(state, VIEW_KEYS) : pick(state.layerViews?.[focus], VIEW_KEYS),
    o: views,
    sel: own && state.selected ? [...new Set([...(state.picks || []), state.selected])] : undefined,
    f: state.filter && !(state.filter.kind === "buffer" && !isShared(state.filter.layer)) ? state.filter : undefined,
    fm: state.filterMode === "hide" ? "hide" : undefined,
    rd: state.roads === "below" ? "below" : undefined,
    g: state.graticule ? 1 : undefined,
    vw: state.view === "compare" ? "compare" : undefined,
    c: state.comparisons?.[reference] ? pick(state.comparisons[reference], ["components", "color", "selected"]) : undefined,
  };
  return JSON.parse(JSON.stringify(data));
}

/** The text after #state= for shared data; shortened (picks, then the drawn area) to fit the limit. */
export async function encodeShare(data, { limit = SHARE_LIMIT } = {}) {
  const pack = async (d) => {
    const bytes = new TextEncoder().encode(JSON.stringify(d));
    return canCompress() ? "1." + toBase64Url(await through(bytes, new CompressionStream("deflate-raw"))) : "0." + toBase64Url(bytes);
  };
  let d = data,
    text = await pack(d);
  const trimmed = [];
  while (text.length > limit && d.sel?.length > 1) {
    d = { ...d, sel: d.sel.slice(0, Math.floor(d.sel.length / 2)) };
    trimmed.push("selection");
    text = await pack(d);
  }
  while (text.length > limit && d.f?.kind === "polygon" && d.f.ring.length > 8) {
    d = { ...d, f: { ...d.f, ring: d.f.ring.filter((_, i) => i % 2 === 0) } };
    trimmed.push("drawn area");
    text = await pack(d);
  }
  if (text.length > limit) throw new Error("This map has too much to fit in a link. Save a project file instead.");
  return { text, trimmed: [...new Set(trimmed)] };
}

/** Shared data from the text after #state=. Throws a readable error. */
export async function decodeShare(text) {
  const m = /^([01])\.([A-Za-z0-9_-]+)$/.exec(String(text || ""));
  if (!m || text.length > SHARE_LIMIT * 2) throw new Error("This share link is damaged or too long.");
  let data;
  try {
    let bytes = fromBase64Url(m[2]);
    if (m[1] === "1") bytes = await through(bytes, new DecompressionStream("deflate-raw"));
    if (bytes.byteLength > 512 * 1024) throw new Error("too large");
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("This share link is damaged, or was cut short when it was copied.");
  }
  if (!data || data.v !== 1) throw new Error("This share link was made by a newer rumb.");
  return data;
}

const num = (v, lo, hi) => (Number.isFinite(v) && v >= lo && v <= hi ? v : undefined);
const str = (v, max = 120) => (typeof v === "string" && v.length <= max ? v : undefined);
const color = (v) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : undefined);

/**
 * A saved-state patch from shared data, keeping only what is known and in
 * range: `known(id)` for layer ids, `palettes` for palette names.
 * Returns { state, camera, dropped: [ids] }.
 */
export function readShare(data, { known, palettes, region }) {
  if (data.r && data.r !== region) throw new Error("This link is for another region.");
  const dropped = [];
  const view = (w = {}) =>
    JSON.parse(
      JSON.stringify({
        measure: str(w.measure),
        category: str(w.category),
        palette: palettes.includes(w.palette) ? w.palette : undefined,
        classification: ["quantile", "equal", "jenks", "sd", "manual"].includes(w.classification) ? w.classification : undefined,
        count: num(w.count, 2, 9),
        breaks: Array.isArray(w.breaks) ? w.breaks.filter(Number.isFinite).slice(0, 8) : undefined,
        method: METHODS[w.method] ? w.method : undefined,
        inference: ["normal", "permutation"].includes(w.inference) ? w.inference : undefined,
        yField: str(w.yField),
        scan:
          w.scan && typeof w.scan === "object"
            ? {
                maxPop: [0.05, 0.1, 0.25, 0.5].includes(w.scan.maxPop) ? w.scan.maxPop : 0.25,
                maxMiles: num(w.scan.maxMiles, 1, 300) ?? null,
                direction: ["high", "low", "both"].includes(w.scan.direction) ? w.scan.direction : "high",
              }
            : undefined,
        rule: WEIGHT_KINDS.includes(w.rule) ? w.rule : undefined,
        k: num(w.k, 1, 30),
        band: num(w.band, 0.1, 200),
        power: [1, 2].includes(w.power) ? w.power : undefined,
        symmetric: typeof w.symmetric === "boolean" ? w.symmetric : undefined,
        study: str(w.study, 200),
        permutations: num(w.permutations, 99, 9999),
        seed: num(w.seed, 0, 2 ** 31),
        fdr: typeof w.fdr === "boolean" ? w.fdr : undefined,
      }),
    );
  const stack = [];
  for (const e of Array.isArray(data.s) ? data.s.slice(0, 40) : []) {
    const id = str(e?.i);
    if (!id || !known(id)) {
      if (id) dropped.push(id);
      continue;
    }
    const st = e.st || {};
    const style = JSON.parse(
      JSON.stringify({
        color: color(st.color),
        opacity: num(st.opacity, 0.05, 1),
        size: num(st.size, 1, 15),
        shape: ["circle", "square", "triangle", "diamond"].includes(st.shape) ? st.shape : undefined,
        outline: num(st.outline, 0, 5),
        outlineColor: color(st.outlineColor),
        hatch: st.hatch === true ? true : undefined,
      }),
    );
    stack.push({
      id,
      visible: e.h !== 1,
      ...(Object.keys(style).length && { style }),
      ...(str(e.l) && { label: e.l }),
      ...(Array.isArray(e.n) && { counts: e.n.filter((x) => typeof x === "string" && known(x)) }),
      ...(Array.isArray(e.dv) && {
        derived: e.dv
          .slice(0, 12)
          .map((d) => Array.isArray(d) && rateSpec({ kind: "rate", measure: str(d[0]), methods: Array.isArray(d[1]) ? d[1] : [] }))
          .filter(Boolean),
      }),
    });
  }
  const active = known(data.a) ? data.a : stack[0]?.id;
  const layerViews = {};
  for (const [id, w] of Object.entries(data.o || {})) if (known(id)) layerViews[id] = view(w);
  const sel = Array.isArray(data.sel) ? data.sel.filter((x) => typeof x === "string").slice(0, 2000) : [];
  const filter = normalizeFilter(data.f);
  const state = {
    active,
    stack,
    layerViews,
    ...view(data.w),
    selected: sel.at(-1) || null,
    picks: sel.length > 1 ? sel : [],
    inspector: sel.length > 0,
    filter: filter?.kind === "buffer" && !known(filter.layer) ? null : filter,
    filterMode: data.fm === "hide" ? "hide" : "dim",
    roads: data.rd === "below" ? "below" : "above",
    graticule: data.g === 1,
    view: data.vw === "compare" ? "compare" : "map",
  };
  if (data.c && Array.isArray(data.c.components)) state.comparisons = { __reference: data.c };
  const m = Array.isArray(data.m) ? data.m : null;
  const camera =
    m && num(m[0], -180, 180) !== undefined && num(m[1], -85, 85) !== undefined && num(m[2], 0, 22) !== undefined
      ? { center: [m[0], m[1]], zoom: m[2] }
      : null;
  return { state, camera, dropped };
}

/** The link for shared text, on the page's own address. */
export const shareUrl = (location, text) => `${location.origin}${location.pathname}#state=${text}`;

/** The shared text in a location hash, or null. */
export function shareFromHash(hash) {
  const m = /^#state=([01]\.[A-Za-z0-9_-]+)$/.exec(String(hash || ""));
  return m ? m[1] : null;
}
