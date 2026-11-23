// A PNG of the map with a title band above and the legend, the other shown
// layers and credits below.
import { saveBlob } from "../ui/dom.js";

// Read from the theme so a saved image matches the screen it came from.
function paper() {
  const css = getComputedStyle(document.documentElement);
  const get = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  return {
    bg: get("--print-bg", "#fbfcf7"),
    ink: get("--print-ink", "#204739"),
    title: get("--print-title-font", "Georgia, serif"),
    body: get("--print-font", "Arial, sans-serif"),
  };
}

export async function exportMapImage(map, { title, subtitle, legend, others = [], notes, file = "rumb-map.png" }) {
  await new Promise((resolve) => {
    map.once("idle", resolve);
    map.triggerRepaint();
  });
  const look = paper();
  const canvas = document.createElement("canvas"),
    input = map.getCanvas();
  const ratio = input.width / Math.max(1, input.clientWidth),
    header = 75,
    extra = others.length ? 26 : 0,
    bottom = 74 + extra;
  canvas.width = input.width;
  canvas.height = input.height + (header + bottom) * ratio;
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  const w = canvas.width / ratio,
    h = input.height / ratio;
  ctx.fillStyle = look.bg;
  ctx.fillRect(0, 0, w, h + header + bottom);
  ctx.fillStyle = look.ink;
  ctx.font = "26px " + look.title;
  ctx.fillText(title, 16, 32, w - 32);
  ctx.font = "14px " + look.body;
  ctx.fillText(subtitle, 16, 56, w - 32);
  ctx.drawImage(input, 0, header, w, h);
  ctx.font = "12px " + look.body;
  let x = 16;
  const cell = (w - 32) / Math.max(1, legend.length);
  for (const { color, text } of legend) {
    ctx.fillStyle = color;
    ctx.fillRect(x, h + header + 10, cell - 3, 8);
    ctx.fillStyle = look.ink;
    ctx.fillText(text, x, h + header + 35, cell - 4);
    x += cell;
  }
  // Other shown layers: a swatch of their colors and their names, in one row.
  if (others.length) {
    ctx.font = "12px " + look.body;
    let ox = 16;
    const y = h + header + 52;
    for (const o of others) {
      const colors = o.colors.slice(0, 4);
      colors.forEach((c, i) => {
        ctx.fillStyle = c;
        if (o.kind === "point") {
          ctx.beginPath();
          ctx.arc(ox + 5 + i * 7, y - 4, 4, 0, Math.PI * 2);
          ctx.fill();
        } else ctx.fillRect(ox + i * 6, y - 9, 6, 10);
      });
      ox += colors.length * (o.kind === "point" ? 7 : 6) + 8;
      ctx.fillStyle = look.ink;
      const label = o.name + (o.note ? " (" + o.note + ")" : "");
      ctx.fillText(label, ox, y, w - ox - 16);
      ox += ctx.measureText(label).width + 18;
      if (ox > w - 60) break;
    }
  }
  ctx.font = "11px " + look.body;
  ctx.fillText(notes, 16, h + header + 59 + extra, w - 32);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("This browser could not encode the map image.");
  saveBlob(blob, file);
}
