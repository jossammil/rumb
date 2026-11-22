// A small static server for dist/ that behaves like GitHub Pages: the site
// lives under a subpath (RUMB_BASE, default /bgis/), no special headers are
// sent, and byte ranges are honored (DuckDB and the service worker read
// parquet files in ranges).
//   RUMB_BASE=/rumb/ RUMB_PORT=4180 node scripts/serve.mjs
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.env.RUMB_ROOT || "dist");
const port = Number(process.env.RUMB_PORT || 4180);
const base = (process.env.RUMB_BASE || "/bgis/").replace(/\/?$/, "/");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
  ".geojson": "application/geo+json",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
  ".parquet": "application/octet-stream",
};

http
  .createServer(async (request, response) => {
    try {
      let pathname = decodeURIComponent(
        new URL(request.url, "http://localhost").pathname,
      );
      if (pathname === base.slice(0, -1) || !pathname.startsWith(base)) {
        response.writeHead(302, { Location: base }).end();
        return;
      }
      pathname = pathname.slice(base.length - 1);
      let file = path.resolve(root, `.${pathname}`);
      if (!file.startsWith(root + path.sep) && file !== root) {
        response.writeHead(403).end();
        return;
      }
      if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
      const content = await readFile(file);
      const headers = {
        "Content-Type": types[path.extname(file)] || "application/octet-stream",
        "Cache-Control": "no-cache",
        "Accept-Ranges": "bytes",
      };
      const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range || "");
      if (range && (range[1] || range[2])) {
        const size = content.length;
        let start = range[1] ? Number(range[1]) : size - Number(range[2]);
        let end = range[1] && range[2] ? Number(range[2]) : size - 1;
        start = Math.max(0, start);
        end = Math.min(end, size - 1);
        if (start > end) {
          response.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
          return;
        }
        headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
        headers["Content-Length"] = String(end - start + 1);
        response.writeHead(206, headers);
        response.end(
          request.method === "HEAD" ? undefined : content.subarray(start, end + 1),
        );
        return;
      }
      headers["Content-Length"] = String(content.length);
      response.writeHead(200, headers);
      response.end(request.method === "HEAD" ? undefined : content);
    } catch {
      response.writeHead(404).end("Not found");
    }
  })
  .listen(port, "127.0.0.1", () =>
    console.log(`rumb: http://127.0.0.1:${port}${base}`),
  );
