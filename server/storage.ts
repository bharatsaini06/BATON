// Storage for published handover packages (the only thing the server keeps).
//   upstash — Upstash Redis REST (durable; recommended on Vercel)
//   file    — JSON files on local disk (durable on a normal server / Render with a disk)
//   memory  — process memory (fallback; lost on restart)
// Work-in-progress projects never reach the server's storage: they live in the user's browser.
import { promises as fs } from "node:fs";
import path from "node:path";

export interface Store {
  mode: "upstash" | "file" | "memory";
  durable: boolean;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

const TTL_SECONDS = 60 * 60 * 24 * 180; // published packages expire after 180 days

function upstash(url: string, token: string): Store {
  const base = url.replace(/\/$/, "");
  const call = async (p: string, body?: string) => {
    const res = await fetch(`${base}${p}`, { method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${token}` }, body, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Upstash ${res.status}`);
    return (await res.json()) as { result: string | null };
  };
  return {
    mode: "upstash",
    durable: true,
    async get(key) { return (await call(`/get/${encodeURIComponent(key)}`)).result; },
    async set(key, value) { await call(`/set/${encodeURIComponent(key)}?EX=${TTL_SECONDS}`, value); },
    async del(key) { await call(`/del/${encodeURIComponent(key)}`); },
  };
}

function memory(): Store {
  const m = new Map<string, string>();
  return { mode: "memory", durable: false, async get(k) { return m.get(k) ?? null; }, async set(k, v) { m.set(k, v); }, async del(k) { m.delete(k); } };
}

async function fileStore(dir: string): Promise<Store | null> {
  try {
    await fs.mkdir(dir, { recursive: true });
    const probe = path.join(dir, ".write-test");
    await fs.writeFile(probe, "ok");
    await fs.unlink(probe);
  } catch {
    return null;
  }
  const safe = (k: string) => path.join(dir, k.replace(/[^a-zA-Z0-9_-]/g, "_") + ".json");
  return {
    mode: "file",
    durable: !process.env.VERCEL,
    async get(k) { try { return await fs.readFile(safe(k), "utf8"); } catch { return null; } },
    async set(k, v) { await fs.writeFile(safe(k), v, "utf8"); },
    async del(k) { await fs.unlink(safe(k)).catch(() => {}); },
  };
}

let cached: Promise<Store> | null = null;
/** Tests only: forget the cached store so a new DATA_DIR takes effect. */
export function resetStore() { cached = null; }
export function getStore(): Promise<Store> {
  if (!cached) {
    cached = (async () => {
      const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
      const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
      if (url && token) return upstash(url, token);
      const dir = process.env.DATA_DIR || (process.env.VERCEL ? "/tmp/baton-data" : path.join(process.cwd(), ".data"));
      return (await fileStore(dir)) || memory();
    })();
  }
  return cached;
}
