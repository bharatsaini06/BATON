// Vercel serverless entry. All /api/* requests are rewritten here (see vercel.json).
import { handle } from "../dist/handler.mjs";

export const config = { maxDuration: 60 };

// Webhook signatures (Discord, Slack, GitHub) are computed over the exact request bytes, so for
// /api/hooks/* the raw body is read from the stream instead of using Vercel's parsed `req.body`.
function readRaw(req, ms = 2500) {
  return new Promise((resolve) => {
    const parts = [];
    const done = (v) => { clearTimeout(t); resolve(v); };
    const t = setTimeout(() => done(null), ms);
    req.on("data", (c) => parts.push(Buffer.from(c)));
    req.on("end", () => done(Buffer.concat(parts).toString("utf8")));
    req.on("error", () => done(null));
  });
}

export default async function handler(req, res) {
  const isHook = /[?&]__path=hooks(\/|%2F)/i.test(req.url || "") || /\/api\/hooks\//.test(req.url || "");
  if (req.method !== "GET" && req.method !== "HEAD") {
    if (isHook) {
      let raw = typeof req.rawBody === "string" ? req.rawBody : Buffer.isBuffer(req.rawBody) ? req.rawBody.toString("utf8") : await readRaw(req);
      if (raw === null || raw === "") {
        // last resort: rebuild the body from what the platform parsed
        try {
          const b = req.body;
          raw = typeof b === "string" ? b : Buffer.isBuffer(b) ? b.toString("utf8") : b && String(req.headers["content-type"] || "").includes("urlencoded") ? new URLSearchParams(b).toString() : JSON.stringify(b ?? {});
        } catch { raw = ""; }
      }
      return handle(req, res, { raw });
    }
    let body;
    try {
      body = req.body; // Vercel parses JSON bodies
    } catch {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ error: "Body is not valid JSON" }));
    }
    return handle(req, res, { body });
  }
  return handle(req, res, {});
}
