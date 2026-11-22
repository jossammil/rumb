// Appearance: applies the saved settings to <html> (data-theme, data-size,
// data-decor, data-scanlines) and runs the Appearance dialog. The CSS in
// styles/tokens.css and styles/themes.css does the rest.
import { normalizeSettings, nextTheme, SIZES, THEMES } from "../core/settings.js";
import { load, save } from "../core/storage.js";
import { $, h } from "./dom.js";

let settings = normalizeSettings(load("settings"));
const listeners = new Set();

export const getSettings = () => settings;

/** Listen for appearance changes (the map repaints its backdrop). */
export const onSettings = (fn) => listeners.add(fn);

export function applySettings(next = settings) {
  settings = normalizeSettings(next);
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  root.dataset.size = settings.size;
  if (settings.decor) delete root.dataset.decor;
  else root.dataset.decor = "off";
  if (settings.scanlines) root.dataset.scanlines = "on";
  else delete root.dataset.scanlines;
  const theme = THEMES.find((t) => t.id === settings.theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme.themeColor);
  save("settings", settings);
  for (const fn of listeners) fn(settings);
  return settings;
}

export const update = (patch) => applySettings({ ...settings, ...patch });
export const cycleTheme = () => update({ theme: nextTheme(settings.theme) });

export function openAppearance() {
  const body = h("div", { class: "dialog-body" });
  function render() {
    const choice = (pressed, onclick, ...children) =>
      h("button", { "aria-pressed": String(pressed), onclick }, ...children);
    body.replaceChildren(
      h("h2", { text: "Appearance" }),
      h("p", { text: "Themes are for the conditions you work in: Night keeps night vision, Daylight reads in sun." }),
      h("h3", { text: "Theme" }),
      h(
        "div",
        { class: "choices" },
        THEMES.map((t) =>
          choice(
            settings.theme === t.id,
            () => (update({ theme: t.id }), render()),
            h("span", { class: "swatch" }, t.swatch.map((c) => h("span", { style: { background: c } }))),
            h("span", { text: t.name }),
            h("small", { text: t.note }),
          ),
        ),
      ),
      h("h3", { text: "Text size" }),
      h(
        "div",
        { class: "segmented" },
        SIZES.map(([id, label]) =>
          h("button", {
            class: settings.size === id ? "active" : "",
            text: label,
            onclick: () => (update({ size: id }), render()),
          }),
        ),
      ),
      h("h3", { text: "Details" }),
      h(
        "label",
        { class: "checkbox" },
        h("input", {
          type: "checkbox",
          checked: settings.decor,
          onchange: (e) => update({ decor: e.target.checked }),
        }),
        "Theme decoration (brackets, bands, stripes)",
      ),
      h(
        "label",
        { class: "checkbox" },
        h("input", {
          type: "checkbox",
          checked: settings.scanlines,
          onchange: (e) => update({ scanlines: e.target.checked }),
        }),
        "Scanlines",
      ),
      h(
        "label",
        { class: "checkbox" },
        h("input", {
          type: "checkbox",
          checked: settings.coords === "dms",
          onchange: (e) => update({ coords: e.target.checked ? "dms" : "dd" }),
        }),
        "Coordinates in degrees, minutes and seconds",
      ),
    );
  }
  render();
  $("dialog-content").replaceChildren(body);
  $("dialog").showModal();
}
