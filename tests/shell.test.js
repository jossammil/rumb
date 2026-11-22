import test from "node:test";
import assert from "node:assert/strict";
import { COMMANDS, bindCommands } from "../src/core/commands.js";
import { KEY_OF, SHORTCUTS, isTyping, keyHint, shortcutFor } from "../src/core/keys.js";
import { THEMES, formatPosition, nextTheme, normalizeSettings } from "../src/core/settings.js";
import { fuzzyScore, rankItems } from "../src/ui/palette.js";

const ids = new Set(COMMANDS.map((c) => c.id));

test("every shortcut runs a known command, and no key does two things", () => {
  assert.equal(ids.size, COMMANDS.length, "duplicate command ids");
  for (const [id] of SHORTCUTS) if (id !== "escape") assert.ok(ids.has(id), id);
  for (const id of Object.values(KEY_OF)) assert.ok(ids.has(id), id);
  const keys = Object.keys(KEY_OF);
  assert.equal(new Set(keys.map((k) => k.toLowerCase())).size, keys.length, "keys differ only by case");
  // The help sheet lists every single key that does something.
  const listed = SHORTCUTS.flatMap(([, keys]) => keys.split("  or  "));
  for (const [key, id] of Object.entries(KEY_OF))
    assert.ok(listed.includes(key.toUpperCase()) || listed.includes(key) || id === "zoom-in" || id === "zoom-out", key);
  assert.equal(keyHint("export"), "E");
});

test("key presses map to commands except while typing", () => {
  const press = (key, extra = {}) => shortcutFor({ key, target: { tagName: "DIV" }, ...extra });
  assert.equal(press("e"), "export");
  assert.equal(press("E"), "export");
  assert.equal(press("2"), "view-compare");
  assert.equal(press("?"), "help");
  assert.equal(press("k", { metaKey: true }), "palette");
  assert.equal(press("s", { ctrlKey: true }), "save");
  assert.equal(press("c", { metaKey: true }), null);
  assert.equal(press("e", { altKey: true }), null);
  assert.equal(press("e", { repeat: true }), null);
  assert.equal(shortcutFor({ key: "e", target: { tagName: "TEXTAREA" } }), null);
  assert.equal(shortcutFor({ key: "k", metaKey: true, target: { tagName: "TEXTAREA" } }), "palette");
  assert.equal(isTyping({ tagName: "INPUT", type: "checkbox" }), false);
  assert.equal(isTyping({ tagName: "INPUT", type: "search" }), true);
});

test("commands dispatch to bound handlers", () => {
  const seen = [];
  const run = bindCommands({ export: () => seen.push("export") });
  run("export");
  run("nope");
  assert.deepEqual(seen, ["export"]);
});

test("settings are normalized and themes cycle", () => {
  assert.deepEqual(normalizeSettings(null), {
    theme: "terminal",
    size: "medium",
    decor: true,
    scanlines: false,
    coords: "dd",
  });
  assert.deepEqual(normalizeSettings({ theme: "hud", size: "huge", decor: false, scanlines: 1, coords: "dms" }), {
    theme: "hud",
    size: "medium",
    decor: false,
    scanlines: false,
    coords: "dms",
  });
  assert.equal(nextTheme("terminal"), THEMES[1].id);
  assert.equal(nextTheme(THEMES.at(-1).id), "terminal");
  assert.equal(new Set(THEMES.map((t) => t.id)).size, THEMES.length);
});

test("positions in decimal degrees and degrees-minutes-seconds", () => {
  assert.equal(formatPosition(32.3, -90.18), "32.30000 N  90.18000 W");
  assert.equal(formatPosition(32.3, -90.18, "dms"), "32°18′00″N 90°10′48″W");
  assert.equal(formatPosition(-0.5, 0.25, "dms"), "0°30′00″S 0°15′00″E");
  // 59.99″ rounds up into the next minute rather than showing 60″.
  assert.equal(formatPosition(10.99999, 0, "dms").slice(0, 10), "11°00′00″N");
});

test("palette ranking prefers substrings at word starts", () => {
  assert.equal(fuzzyScore("", "anything"), 0);
  assert.equal(fuzzyScore("xyz", "Export the map"), -1);
  assert.ok(fuzzyScore("exp", "Export the map") > fuzzyScore("exp", "Take an expert view"));
  assert.ok(fuzzyScore("etm", "Export the map") > 0);
  const items = [
    { label: "Zoom in", group: "Map" },
    { label: "Find clusters", group: "Analysis" },
    { label: "Find a feature", group: "Map" },
  ];
  assert.deepEqual(rankItems(items, "").map((x) => x.label), items.map((x) => x.label));
  assert.equal(rankItems(items, "clus")[0].label, "Find clusters");
  assert.equal(rankItems(items, "analysis")[0].label, "Find clusters");
});
