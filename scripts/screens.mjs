// Review screenshots for design/screens/<stage>/: every theme on the cluster
// map, then Compare, SQL, the palette and a phone, as numbered JPEGs. Not a
// test; run after `npm run build` when the look changes:
//   node scripts/screens.mjs foundation
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";

const stage = process.argv[2] || "latest";
const dir = `design/screens/stage-${stage}`;
await mkdir(dir, { recursive: true });
const port = 4600 + Math.floor(Math.random() * 300);
const server = spawn(process.execPath, ["scripts/serve.mjs"], {
  env: { ...process.env, RUMB_PORT: String(port) },
  stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 500));
const browser = await chromium.launch({
  ...(existsSync("/Applications/Google Chrome.app") ? { channel: "chrome" } : {}),
  args: ["--use-angle=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`http://127.0.0.1:${port}/rumb/`);
await page.waitForFunction(() => window.rumb?.timings.firstMap, null, { timeout: 60000 });
let n = 0;
const shot = (name) => page.screenshot({ path: `${dir}/${++n}-${name}.jpg`, type: "jpeg", quality: 82 });

await page.click("#analyze");
await page.locator("#inspect-panel", { hasText: "0.2768" }).waitFor();
await page.evaluate(() => window.rumb.app.selectFeature("28049010100"));
for (const theme of ["terminal", "terminal-night", "terminal-day", "hud", "fieldkit", "starship"]) {
  await page.evaluate((t) => window.rumb.appearance({ theme: t }), theme);
  await page.waitForTimeout(400);
  await shot("theme-" + theme);
}
await page.evaluate(() => window.rumb.appearance({ theme: "terminal" }));
await page.keyboard.press("2");
await page.locator("#cmp-count", { hasText: "870" }).waitFor();
await page.waitForTimeout(400);
await shot("compare");
await page.keyboard.press("4");
await page.click("#run-query");
await page.locator("#query-grid table").waitFor({ timeout: 60000 });
await shot("sql");
await page.keyboard.press("1");
await page.keyboard.press("Control+k");
await page.keyboard.type("hinds");
await page.waitForTimeout(200);
await shot("palette");
await page.keyboard.press("Escape");
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(500);
await shot("phone");
await browser.close();
server.kill();
console.log(`Wrote ${n} screenshots to ${dir}/`);
