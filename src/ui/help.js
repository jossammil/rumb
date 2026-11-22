// The help sheet: what rumb is and every keyboard shortcut, from core/keys.js.
import { ABOUT } from "../core/about.js";
import { SHORTCUTS } from "../core/keys.js";
import { $, h } from "./dom.js";

export function openHelp(version) {
  const table = h(
    "table",
    { class: "keys" },
    h(
      "tbody",
      null,
      SHORTCUTS.map(([, keys, what]) =>
        h("tr", null, h("td", null, keys.split("  or  ").map((k, i) => [i ? " or " : null, h("kbd", { text: k })])), h("td", { text: what })),
      ),
    ),
  );
  $("dialog-content").replaceChildren(
    h(
      "div",
      { class: "dialog-body help-sheet" },
      h("h2", { text: "About rumb " + version }),
      h("p", { text: ABOUT.lead }),
      h("p", { text: ABOUT.file + " " + ABOUT.name }),
      h("p", null, h("em", { text: ABOUT.credit })),
      h("h3", { text: "Keyboard" }),
      table,
      h("p", { class: "subtle", text: "Single-letter keys work when the cursor is not in a text box." }),
    ),
  );
  $("dialog").showModal();
}
