// Lokaler Testserver: liefert die statischen Dateien aus und leitet /api/* an die Funktionen.
// Start: DATABASE_URL=postgres://… npm run dev   → http://localhost:3000
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".woff2": "font/woff2", ".gz": "application/gzip", ".js": "text/javascript", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };
const port = Number(process.env.PORT || 3000);
// Kopfzeilen wie auf Vercel (vercel.json), damit z. B. die CSP lokal mitgeprüft wird
const vconf = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
const applyHeaders = (res, p) => { for (const h of vconf.headers || []) if (new RegExp("^" + h.source + "$").test(p)) for (const kv of h.headers) res.setHeader(kv.key, kv.value); };

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  applyHeaders(res, url.pathname);
  if (url.pathname.startsWith("/api/")) {
    const name = url.pathname.slice(5).replace(/[^a-z]/g, "");
    const file = path.join(root, "api", name + ".js");
    if (!name || !fs.existsSync(file)) { res.statusCode = 404; return res.end("{}"); }
    const mod = await import(file);
    return mod.default(req, res);
  }
  let p = path.join(root, decodeURIComponent(url.pathname));
  if (!p.startsWith(root)) { res.statusCode = 403; return res.end(); }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, "index.html");
  if (!fs.existsSync(p)) { res.statusCode = 404; return res.end("Nicht gefunden"); }
  res.setHeader("Content-Type", types[path.extname(p)] || "application/octet-stream");
  fs.createReadStream(p).pipe(res);
}).listen(port, () => console.log(`MaisDoc lokal: http://localhost:${port}`));
