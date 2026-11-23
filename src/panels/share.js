// Share links in the app: "Copy a share link" (U) packs the map into the
// link (core/share.js); opening a link with #state= puts that map on screen.
// The link carries only built-in data, never imported files or SQL.
import { decodeShare, encodeShare, readShare, shareFromHash, shareState, shareUrl } from "../core/share.js";
import { defaults, normalizeState } from "../core/state.js";
import { palettes } from "../map/classify.js";
import { $, h } from "../ui/dom.js";

export function createShare(app) {
  const { store, ws, catalog } = app;
  const isShared = (id) => id === ws.ref.id || !!ws.meta(id);

  /** Makes a link for the current map and shows it, copying it when the browser allows. */
  async function copyLink() {
    await ws.library().catch(() => null);
    const { state } = app;
    const data = shareState(state, { camera: app.atlas.camera(), isShared, reference: ws.ref.id });
    const { text, trimmed } = await encodeShare(data);
    const url = shareUrl(location, text);
    const me = app.tools.located?.lonlat;
    const fromMe =
      me && state.filter?.kind === "radius" && Math.abs(state.filter.center[0] - me[0]) < 1e-9 && Math.abs(state.filter.center[1] - me[1]) < 1e-9;
    const local = state.layers.length || state.stack.some((e) => !isShared(e.id)) || !isShared(state.active);
    const input = h("input", { id: "share-link", type: "text", readonly: true, value: url, "aria-label": "Share link" });
    let copied = false;
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
    } catch {
      // No clipboard here (an insecure page, or permission refused): the dialog still shows the link.
    }
    $("dialog-content").replaceChildren(
      h(
        "div",
        { class: "dialog-body share" },
        h("h2", { text: "Share this map" }),
        h("p", {
          text: copied ? "The link is copied. Anyone who opens it sees this map." : "Copy this link. Anyone who opens it sees this map.",
        }),
        input,
        h("button", {
          class: "small-btn",
          id: "share-copy",
          text: "Copy",
          onclick: async () => {
            input.select();
            try {
              await navigator.clipboard.writeText(url);
              app.notify("Link copied.");
            } catch {
              document.execCommand?.("copy");
            }
          },
        }),
        h("p", {
          class: "subtle",
          text: "The link holds the view, the catalog layers and their looks, classes, the filter and the selection. Nothing is uploaded: the map travels in the part of the link after #, which browsers never send to a server.",
        }),
        local &&
          h("p", { class: "subtle", text: "Imported files, SQL and query layers stay on this device and are not in the link; save a project to pass them on." }),
        trimmed.length > 0 && h("p", { class: "subtle", text: "Shortened to fit: part of the " + trimmed.join(" and ") + " was left out." }),
        fromMe && h("p", { class: "warn", text: "The filter is centered on your location, so the link shows where you are." }),
      ),
    );
    $("dialog").showModal();
    input.select();
    if (copied) app.notify("Share link copied.");
  }

  /** Puts a shared map on screen; keeps this device's imported data and query layers. */
  async function open(text) {
    const data = await decodeShare(text);
    await ws.library().catch(() => null);
    const { state: patch, camera, dropped } = readShare(data, {
      known: isShared,
      palettes: Object.keys(palettes),
      region: catalog.region.id,
    });
    const { comparisons: shared, ...rest } = patch;
    const now = store.state;
    const next = normalizeState(
      {
        ...defaults(catalog),
        layers: now.layers,
        sql: now.sql,
        comparisons: { ...now.comparisons, ...(shared && { [ws.ref.id]: shared.__reference }) },
        ...rest,
      },
      catalog,
      (id) => !!ws.meta(id),
    );
    app.analysis.cancel();
    store.replace(next);
    await app.loadStack();
    // A measure the layer does not have falls back to its first one.
    const fields = app.fieldList(app.layer());
    if (store.state.measure && !fields.includes(store.state.measure)) store.set({ measure: fields[0] || "" });
    app.filter.drawShape();
    app.renderAll();
    app.setView(store.state.view, true);
    if (camera) app.atlas.map.jumpTo(camera);
    history.replaceState(null, "", location.pathname + location.search);
    app.notify("Opened a shared map." + (dropped.length ? " Not available here: " + dropped.join(", ") + "." : ""));
  }

  /** Opens the map in the page's address, if there is one. */
  async function fromAddress() {
    const text = shareFromHash(location.hash);
    if (text) await app.perform(null, () => open(text));
  }
  window.addEventListener("hashchange", fromAddress);

  return { copyLink, open, fromAddress };
}
