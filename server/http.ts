// Shared HTTP helpers for the route modules.
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";

export const MAX_BODY = 8 * 1024 * 1024;

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export function readRaw(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, "Request is too large (limit 8 MB). Split large exports into smaller files.")); req.destroy(); return; }
      parts.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(parts).toString("utf8")));
    req.on("error", reject);
  });
}

export function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(400, "Invalid request: " + r.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "body"} ${i.message}`).join("; "));
  return r.data;
}

// simple fixed-window rate limiter per client IP (protects the AI key, sign-in and GitHub quota on public demos)
const hits = new Map<string, { n: number; reset: number }>();
export function limit(req: IncomingMessage, bucket: string, max: number, windowMs = 10 * 60 * 1000) {
  if (process.env.BATON_NO_RATE_LIMIT === "1") return;
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "local").split(",")[0].trim();
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const h = hits.get(key);
  if (!h || h.reset < now) { hits.set(key, { n: 1, reset: now + windowMs }); return; }
  if (++h.n > max) throw new HttpError(429, `Too many requests. Please wait ${Math.ceil((h.reset - now) / 60000)} minute(s).`);
}

export type Ctx = {
  req: IncomingMessage;
  res: ServerResponse;
  /** parsed JSON body */
  body: () => Promise<unknown>;
  /** exact request bytes as text (needed to verify webhook signatures) */
  raw: () => Promise<string>;
  params: string[];
  query: URLSearchParams;
  /** public origin of this deployment, e.g. https://baton.example.app */
  origin: string;
};
export type Route = [method: string, pattern: RegExp, fn: (c: Ctx) => Promise<void>];
