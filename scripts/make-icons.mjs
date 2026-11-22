// Renders public/rumb.svg into the PNG app icons in public/icons/ (iOS and
// some Android launchers ignore SVG icons). Run after changing the logo:
//   node scripts/make-icons.mjs
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

const svg = await readFile("public/rumb.svg", "utf8");
const browser = await chromium.launch(
  existsSync("/Applications/Google Chrome.app") || process.env.CHROME ? { channel: "chrome" } : {},
);
const page = await browser.newPage();
for (const [name, size, pad] of [
  ["icon-192.png", 192, 0],
  ["icon-512.png", 512, 0],
  ["apple-touch-icon.png", 180, 0],
  // Maskable icons keep the logo inside the central safe zone.
  ["icon-maskable-512.png", 512, 0.12],
]) {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * (1 - 2 * pad));
  await page.setContent(
    `<body style="margin:0;background:#050505;display:grid;place-items:center;height:${size}px">` +
      svg.replace("<svg ", `<svg width="${inner}" height="${inner}" `) +
      "</body>",
  );
  await page.screenshot({ path: "public/icons/" + name });
}
await browser.close();
console.log("Wrote public/icons/");
