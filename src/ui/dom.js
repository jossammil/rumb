// Small DOM helpers shared by every panel (the same shapes as Pocket R's ui/dom.js).
import { icons } from "./icons.js";

export const $ = (id) => document.getElementById(id);

function apply(el, props) {
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.setAttribute("class", value);
    else if (key === "text") el.textContent = value;
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key === "style" && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) el.style.setProperty(k, v);
    } else if (key.startsWith("on") && typeof value === "function")
      el.addEventListener(key.slice(2), value);
    else if (key in el && typeof value !== "string" && !(el instanceof SVGElement))
      el[key] = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  return el;
}
function append(el, children) {
  for (const child of children.flat(Infinity))
    if (child !== null && child !== undefined && child !== false) el.append(child);
  return el;
}

/** Replaces el's children, skipping null, undefined and false (conditional parts). */
export const fill = (el, ...children) => {
  el.replaceChildren();
  return append(el, children);
};

/** h("button", { class: "x", text: "Go", onclick }, ...children) */
export const h = (tag, props, ...children) =>
  append(apply(document.createElement(tag), props), children);

/** The same for SVG elements: s("circle", { cx: 3, cy: 4, r: 2 }) */
export const s = (tag, props, ...children) =>
  append(
    apply(document.createElementNS("http://www.w3.org/2000/svg", tag), props),
    children,
  );

/** An icon from icons.js as an inline SVG element. */
export function icon(name, size = 18) {
  const el = s("svg", {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.65",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  });
  el.innerHTML = icons[name] || "";
  return el;
}

/** Fills every <i data-icon="name"> placeholder under root. */
export function addIcons(root = document) {
  for (const el of root.querySelectorAll("[data-icon]"))
    if (!el.querySelector(":scope > svg")) el.replaceChildren(icon(el.dataset.icon));
}

let toastTimer = 0;
/**
 * One message at a time; errors use role=alert and stay longer. An `action`
 * adds a button (label, default "Undo") and keeps the message up longer.
 */
export function toast(message, { error = false, ms, action, label = "Undo" } = {}) {
  const el = $("toast");
  clearTimeout(toastTimer);
  el.classList.toggle("error", error);
  el.setAttribute("role", error ? "alert" : "status");
  el.replaceChildren(message);
  if (action)
    el.append(
      h("button", {
        class: "toast-action",
        text: label,
        onclick: () => {
          el.hidden = true;
          action();
        },
      }),
    );
  el.hidden = false;
  toastTimer = setTimeout(() => (el.hidden = true), ms ?? (action ? 12000 : error ? 11000 : 5200));
}

export function report(error) {
  console.error(error);
  toast(error?.message || String(error), { error: true });
}

/** Adds an event handler whose thrown errors (sync or async) become toasts. */
export function on(target, event, action) {
  const el = typeof target === "string" ? $(target) : target;
  el.addEventListener(event, (e) => {
    Promise.resolve()
      .then(() => action(e))
      .catch(report);
  });
}

export function debounce(fn, ms) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** Downloads a Blob under a file name. */
export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob),
    a = h("a", { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** <select> options from [value, label] pairs or plain strings. */
export const options = (items, selected) =>
  items.map((item) => {
    const [value, label] = Array.isArray(item) ? item : [item, item];
    return h("option", { value, text: label, selected: value === selected });
  });
