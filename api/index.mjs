// Vercel serverless entry. All /api/* requests are rewritten here (see vercel.json).
import { handle } from "../dist/handler.mjs";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  let body;
  if (req.method !== "GET" && req.method !== "HEAD") {
    try {
      body = req.body; // Vercel parses JSON bodies
    } catch {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ error: "Body is not valid JSON" }));
    }
  }
  return handle(req, res, { body });
}
