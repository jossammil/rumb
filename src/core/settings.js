// Appearance preferences and the themes they choose from. normalizeSettings
// turns whatever was stored (or nothing) into a complete, valid set.

/** Themes, in the order T cycles through them. `swatch` previews them in Appearance. */
export const THEMES = [
  {
    id: "terminal",
    name: "Field Terminal",
    note: "Amber and phosphor on black",
    swatch: ["#050505", "#ffb000", "#33ff99", "#ece6d6"],
    themeColor: "#050505",
  },
  {
    id: "terminal-night",
    name: "Terminal · Night",
    note: "Dim red, keeps night vision",
    swatch: ["#030000", "#c8342a", "#9a3027", "#c4443a"],
    themeColor: "#030000",
  },
  {
    id: "terminal-day",
    name: "Terminal · Daylight",
    note: "High contrast for sunlight",
    swatch: ["#f7f3e8", "#000000", "#a34f00", "#00703c"],
    themeColor: "#f7f3e8",
  },
  {
    id: "hud",
    name: "Tactical HUD",
    note: "Cyan and magenta, bracketed",
    swatch: ["#070c16", "#22e5ff", "#ff2bd6", "#d7f3ff"],
    themeColor: "#070c16",
  },
  {
    id: "fieldkit",
    name: "Rugged Field Kit",
    note: "Olive, charcoal, safety orange",
    swatch: ["#171a14", "#4b5320", "#ff6a13", "#e8e3d0"],
    themeColor: "#171a14",
  },
  {
    id: "starship",
    name: "Starship",
    note: "Plank's console theme",
    swatch: ["#000000", "#ff9900", "#cc99cc", "#9999ff"],
    themeColor: "#000000",
  },
];

export const SIZES = [
  ["small", "Small"],
  ["medium", "Medium"],
  ["large", "Large"],
];

export function normalizeSettings(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  return {
    theme: THEMES.some((t) => t.id === s.theme) ? s.theme : "terminal",
    size: SIZES.some(([id]) => id === s.size) ? s.size : "medium",
    decor: s.decor !== false,
    scanlines: s.scanlines === true,
    coords: s.coords === "dms" ? "dms" : "dd",
  };
}

/** The theme after `id`, wrapping around. */
export const nextTheme = (id) =>
  THEMES[(THEMES.findIndex((t) => t.id === id) + 1) % THEMES.length].id;

/** 32.3001, -90.1834 → "32.30010 N  90.18340 W" or "32°18′00″N 90°11′00″W". */
export function formatPosition(lat, lng, style = "dd") {
  const hemi = (v, pos, neg) => (v >= 0 ? pos : neg);
  if (style === "dms") {
    const dms = (v) => {
      const a = Math.abs(v),
        d = Math.floor(a),
        mFloat = (a - d) * 60,
        m = Math.floor(mFloat),
        sec = Math.round((mFloat - m) * 60);
      // 59.6″ rounds to 60″: carry it into the minutes (and degrees).
      const [dd, mm, ss] =
        sec === 60 ? (m === 59 ? [d + 1, 0, 0] : [d, m + 1, 0]) : [d, m, sec];
      return `${dd}°${String(mm).padStart(2, "0")}′${String(ss).padStart(2, "0")}″`;
    };
    return dms(lat) + hemi(lat, "N", "S") + " " + dms(lng) + hemi(lng, "E", "W");
  }
  return (
    Math.abs(lat).toFixed(5) + " " + hemi(lat, "N", "S") + "  " + Math.abs(lng).toFixed(5) + " " + hemi(lng, "E", "W")
  );
}
