// Standalone server: serves the built web app from /public and the API from /api.
// Usage: node dist/server.mjs   (PORT defaults to 3000)
import http from "node:http";
import { promises as fs, createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handle, securityHeaders, VERSION } from "./handler";
import { aiConfig, PROVIDER_LABEL } from "./ai";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = process.env.PUBLIC_DIR || path.resolve(here, "../public");
const PORT = Number(process.env.PORT) || 3000;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json",
  ".woff2": "font/woff2", ".otf": "font/otf", ".ttf": "font/ttf", ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8", ".webmanifest": "application/manifest+json",
};

async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  securityHeaders(res);
  const url = new URL(req.url || "/", "http://local");
  let rel = decodeURIComponent(url.pathname);
  if (rel.includes("\0")) { res.statusCode = 400; return res.end(); }
  let file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) { res.statusCode = 403; return res.end(); }
  let stat = await fs.stat(file).catch(() => null);
  if (stat?.isDirectory()) { file = path.join(file, "index.html"); stat = await fs.stat(file).catch(() => null); }
  if (!stat) {
    // single-page app: unknown paths without an extension get index.html
    if (path.extname(rel)) { res.statusCode = 404; res.setHeader("Content-Type", "text/plain"); return res.end("Not found"); }
    file = path.join(PUBLIC, "index.html");
    rel = "/index.html";
    stat = await fs.stat(file).catch(() => null);
    if (!stat) { res.statusCode = 500; return res.end("Build missing: run npm run build"); }
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", TYPES[path.extname(file).toLowerCase()] || "application/octet-stream");
  res.setHeader("Cache-Control", rel.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
  if (req.method === "HEAD") return res.end();
  createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const p = (req.url || "/").split("?")[0];
  if (p.startsWith("/api/")) return void handle(req, res);
  if (req.method !== "GET" && req.method !== "HEAD") { res.statusCode = 405; return res.end(); }
  serveStatic(req, res).catch((e) => { console.error(e); res.statusCode = 500; res.end(); });
});

server.listen(PORT, () => {
  const ai = aiConfig();
  console.log(`Baton ${VERSION} running on http://localhost:${PORT}`);
  console.log(ai ? `AI engine: ${PROVIDER_LABEL[ai.provider]} (${ai.model})` : "AI engine: not configured — using the offline rules engine");
});
