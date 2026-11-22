// The command palette (Ctrl/⌘ K or ":"): type to find any command, layer,
// field, feature or theme, then Enter to run it. The ranking is Plank's.
import { $, h, report } from "./dom.js";

const WORD_START = /[\s:_.\-/(·]/;

/**
 * How well `query` matches `text`: higher is better, -1 for no match. A
 * substring scores highest (earlier and at a word start is better); otherwise
 * the query's letters must appear in order, and runs and word starts count.
 */
export function fuzzyScore(query, text) {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const t = text.toLowerCase();
  const at = t.indexOf(q);
  if (at >= 0)
    return 1000 - at * 2 - (t.length - q.length) * 0.1 + (at === 0 || WORD_START.test(t[at - 1]) ? 200 : 0);
  let from = 0,
    prev = -2,
    score = 0;
  for (const ch of q) {
    if (ch === " ") continue;
    const j = t.indexOf(ch, from);
    if (j < 0) return -1;
    score += j === prev + 1 ? 8 : 1;
    if (j === 0 || WORD_START.test(t[j - 1])) score += 6;
    prev = j;
    from = j + 1;
  }
  return score - t.length * 0.05;
}

/** Items matching `query`, best first; without a query, in their given order. */
export function rankItems(items, query, limit = 60) {
  if (!query.trim()) return items.slice(0, limit);
  const scored = [];
  for (const it of items) {
    const s = fuzzyScore(query, (it.group ? it.group + " " : "") + it.label);
    if (s >= 0) scored.push([s, it]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, limit).map((x) => x[1]);
}

/**
 * The palette over the page. `source(query)` returns items
 * { label, group?, hint?, keys?, run() }, already ranked.
 */
export function createPalette(source) {
  const dialog = $("palette"),
    input = $("palette-input"),
    list = $("palette-list");
  let shown = [],
    sel = 0,
    back = null;

  function render() {
    shown = source(input.value);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    list.replaceChildren(
      ...shown.map((it, k) =>
        h(
          "li",
          {
            id: "pal-" + k,
            role: "option",
            "aria-selected": String(k === sel),
            onpointerdown: (e) => e.preventDefault(),
            onclick: () => run(k),
          },
          h("span", { class: "group", text: it.group || "" }),
          h("span", { class: "text", text: it.label }),
          it.hint && h("span", { class: "hint", text: it.hint }),
          it.keys && h("kbd", { text: it.keys }),
        ),
      ),
    );
    if (!shown.length) list.append(h("li", { class: "empty", text: "Nothing matches." }));
    if (shown.length) input.setAttribute("aria-activedescendant", "pal-" + sel);
    else input.removeAttribute("aria-activedescendant");
  }
  function move(d) {
    if (!shown.length) return;
    sel = (sel + d + shown.length) % shown.length;
    for (const row of list.children) row.setAttribute("aria-selected", String(row.id === "pal-" + sel));
    input.setAttribute("aria-activedescendant", "pal-" + sel);
    list.children[sel]?.scrollIntoView?.({ block: "nearest" });
  }
  function run(k) {
    const it = shown[k];
    if (!it) return;
    // Close first, so whatever the command opens is not closed with the palette.
    back = null;
    close();
    Promise.resolve()
      .then(() => it.run())
      .catch(report);
  }
  input.addEventListener("input", () => {
    sel = 0;
    render();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") move(1);
    else if (e.key === "ArrowUp") move(-1);
    else if (e.key === "PageDown") move(Math.min(8, shown.length - 1 - sel) || 0);
    else if (e.key === "PageUp") move(-Math.min(8, sel) || 0);
    else if (e.key === "Enter") run(sel);
    else if (e.key === "Escape") close();
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  dialog.addEventListener("close", () => {
    // Leave no focus in the closed palette, or the next key would type into it.
    if (dialog.contains(document.activeElement)) document.activeElement.blur();
    if (back?.isConnected && back !== document.body) back.focus();
    back = null;
  });
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) close();
  });
  // Blur before closing: a focused input in a closed dialog would keep taking keys.
  function close() {
    if (dialog.contains(document.activeElement)) document.activeElement.blur();
    if (dialog.open) dialog.close();
  }

  return {
    open(prefill = "") {
      if (dialog.open) return;
      back = document.activeElement;
      input.value = prefill;
      sel = 0;
      dialog.showModal();
      render();
      input.focus();
    },
    close,
    get isOpen() {
      return dialog.open;
    },
  };
}
