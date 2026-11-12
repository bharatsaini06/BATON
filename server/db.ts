// Workspace data layer (Round 3): accounts, organisations, roles, projects, packages, share links,
// connectors and captured events.
//
//   supabase — Supabase Auth + Postgres through PostgREST. Calls made for a signed-in person carry
//              THAT person's token, so Postgres Row-Level Security (supabase/schema.sql) decides what
//              they can read or change. The service key is used only for webhooks, invite acceptance
//              and signed-link resolution, after the server has verified a signature or token.
//   builtin  — the same tables kept in the package store (Upstash / file / memory) with scrypt
//              passwords and HMAC session tokens. Used when Supabase is not configured, and in tests.
//
// The same route code and the same role checks run in both modes.
import { getStore } from "./storage";
import { HttpError } from "./http";
import { checkPassword, hashPassword, randomId, signToken, uuid, verifyToken } from "./crypto";

export type Row = Record<string, any>;
export type Filter = Record<string, string | number | boolean | null | string[]>;
export interface SelectOpts { as?: string; columns?: string; order?: string; limit?: number }
export interface Db {
  mode: "supabase" | "builtin";
  select<T = Row>(table: string, filter: Filter, opts?: SelectOpts): Promise<T[]>;
  insert(table: string, row: Row, as?: string): Promise<void>;
  upsert(table: string, row: Row, as?: string): Promise<void>;
  update(table: string, filter: Filter, patch: Row, as?: string): Promise<number>;
  remove(table: string, filter: Filter, as?: string): Promise<number>;
}
export interface User { id: string; email: string; name: string }
export interface Session { token: string; refresh?: string; expiresAt: number; user: User }
export interface AuthProvider {
  signup(email: string, password: string, name: string): Promise<{ session?: Session; needsConfirm?: boolean }>;
  login(email: string, password: string): Promise<Session>;
  refresh(refresh: string): Promise<Session>;
  user(token: string): Promise<User | null>;
}

// ---------------------------------------------------------------- secret for signed links and sessions

const envSecret = () => process.env.SESSION_SECRET || process.env.SHARE_LINK_SECRET || "";
let secretCache: Promise<string> | null = null;
export function getSecret(): Promise<string> {
  if (envSecret().length >= 16) return Promise.resolve(envSecret());
  return (secretCache ||= (async () => {
    const store = await getStore();
    const cur = await store.get("sys:secret").catch(() => null);
    if (cur) return cur;
    const s = randomId(32);
    await store.set("sys:secret", s).catch(() => {});
    return s;
  })());
}

// ---------------------------------------------------------------- Supabase

export interface SupabaseConfig { url: string; anon: string; service?: string }
export function supabaseConfig(env: NodeJS.ProcessEnv = process.env): SupabaseConfig | null {
  const url = (env.SUPABASE_URL || "").replace(/\/+$/, "");
  const anon = env.SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY || "";
  const service = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || undefined;
  return url && anon ? { url, anon, service } : null;
}

const isJwt = (k: string) => k.startsWith("eyJ");

function enc(v: string | number | boolean) { return encodeURIComponent(String(v)); }
function query(filter: Filter): string[] {
  return Object.entries(filter).map(([k, v]) =>
    v === null ? `${k}=is.null` : Array.isArray(v) ? `${k}=in.(${v.map((x) => `"${String(x).replace(/"/g, '\\"')}"`).map(encodeURIComponent).join(",")})` : `${k}=eq.${enc(v)}`);
}

export function supabaseDb(cfg: SupabaseConfig, fetchImpl: typeof fetch = fetch): Db {
  const headers = (as?: string, prefer?: string): Record<string, string> => {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (as) { h.apikey = cfg.anon; h.authorization = `Bearer ${as}`; }
    else {
      if (!cfg.service) throw new HttpError(503, "SUPABASE_SERVICE_ROLE_KEY is not set on the server. It is needed for webhooks, invitations and share links.");
      h.apikey = cfg.service;
      if (isJwt(cfg.service)) h.authorization = `Bearer ${cfg.service}`; // legacy JWT keys; new sb_secret_ keys go on apikey only
    }
    if (prefer) h.prefer = prefer;
    return h;
  };
  const call = async (method: string, table: string, qs: string[], as?: string, body?: unknown, prefer?: string) => {
    const res = await fetchImpl(`${cfg.url}/rest/v1/${table}${qs.length ? "?" + qs.join("&") : ""}`, { method, headers: headers(as, prefer), body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(12000) });
    const text = await res.text();
    if (!res.ok) {
      let msg = text.slice(0, 300);
      try { const j = JSON.parse(text); msg = j.message || j.msg || j.error || msg; } catch { /* keep text */ }
      if (res.status === 401 || /JWT expired/i.test(msg)) throw new HttpError(401, "Your session has expired. Please sign in again.");
      if (res.status === 403 || /row-level security/i.test(msg)) throw new HttpError(403, "You do not have permission to do that in this workspace.");
      if (res.status === 404 || /schema cache|does not exist/i.test(msg)) throw new HttpError(503, "The Baton tables were not found in Supabase. Run supabase/schema.sql in the SQL editor.");
      throw new HttpError(res.status === 409 ? 409 : 502, `Database error: ${msg}`);
    }
    return text ? JSON.parse(text) : [];
  };
  return {
    mode: "supabase",
    async select(table, filter, o = {}) {
      const qs = [`select=${encodeURIComponent(o.columns || "*")}`, ...query(filter)];
      if (o.order) qs.push(`order=${o.order}`);
      if (o.limit) qs.push(`limit=${o.limit}`);
      return call("GET", table, qs, o.as);
    },
    async insert(table, row, as) { await call("POST", table, [], as, row, "return=minimal"); },
    async upsert(table, row, as) { await call("POST", table, ["on_conflict=id"], as, row, "resolution=merge-duplicates,return=minimal"); },
    async update(table, filter, patch, as) { return ((await call("PATCH", table, query(filter), as, patch, "return=representation")) as unknown[]).length; },
    async remove(table, filter, as) { return ((await call("DELETE", table, query(filter), as, undefined, "return=representation")) as unknown[]).length; },
  };
}

export function supabaseAuth(cfg: SupabaseConfig, fetchImpl: typeof fetch = fetch): AuthProvider {
  const cache = new Map<string, { user: User; until: number }>();
  const call = async (path: string, init: { method?: string; body?: unknown; token?: string }) => {
    const h: Record<string, string> = { apikey: cfg.anon, "content-type": "application/json" };
    if (init.token) h.authorization = `Bearer ${init.token}`;
    else if (isJwt(cfg.anon)) h.authorization = `Bearer ${cfg.anon}`;
    const res = await fetchImpl(`${cfg.url}/auth/v1/${path}`, { method: init.method || "POST", headers: h, body: init.body ? JSON.stringify(init.body) : undefined, signal: AbortSignal.timeout(12000) });
    const text = await res.text();
    let j: Row = {};
    try { j = text ? JSON.parse(text) : {}; } catch { /* non-JSON */ }
    return { ok: res.ok, status: res.status, j };
  };
  const toUser = (u: Row): User => ({ id: u.id, email: String(u.email || "").toLowerCase(), name: u.user_metadata?.name || String(u.email || "").split("@")[0] });
  const toSession = (j: Row): Session => ({ token: j.access_token, refresh: j.refresh_token, expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000, user: toUser(j.user) });
  const fail = (r: { status: number; j: Row }, fallback: string) => {
    const msg = r.j.msg || r.j.error_description || r.j.message || fallback;
    return new HttpError(r.status === 429 ? 429 : r.status >= 500 ? 502 : 400, r.status === 429 ? "Too many attempts. Please wait a minute and try again." : String(msg));
  };
  return {
    async signup(email, password, name) {
      const r = await call("signup", { body: { email, password, data: { name } } });
      if (!r.ok) throw fail(r, "Could not create the account.");
      if (r.j.access_token) return { session: toSession(r.j) };
      return { needsConfirm: true };
    },
    async login(email, password) {
      const r = await call("token?grant_type=password", { body: { email, password } });
      if (!r.ok) throw fail(r, "Wrong email or password.");
      return toSession(r.j);
    },
    async refresh(refresh) {
      const r = await call("token?grant_type=refresh_token", { body: { refresh_token: refresh } });
      if (!r.ok) throw new HttpError(401, "Your session has expired. Please sign in again.");
      return toSession(r.j);
    },
    async user(token) {
      const hit = cache.get(token);
      if (hit && hit.until > Date.now()) return hit.user;
      const r = await call("user", { method: "GET", token });
      if (!r.ok || !r.j.id) return null;
      const user = toUser(r.j);
      if (cache.size > 500) cache.clear();
      cache.set(token, { user, until: Date.now() + 60_000 });
      return user;
    },
  };
}

// ---------------------------------------------------------------- built-in (package store)

const HEAVY = new Set(["projects", "packages"]); // tables whose `data` column is stored separately
const locks = new Map<string, Promise<unknown>>();
function lock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const next = (locks.get(key) || Promise.resolve()).then(fn, fn);
  locks.set(key, next.catch(() => {}));
  return next;
}
const matches = (row: Row, f: Filter) => Object.entries(f).every(([k, v]) => (v === null ? row[k] == null : Array.isArray(v) ? v.includes(String(row[k])) : String(row[k]) === String(v)));

export function builtinDb(): Db {
  const load = async (table: string): Promise<Row[]> => { const raw = await (await getStore()).get(`tb:${table}`); return raw ? JSON.parse(raw) : []; };
  const save = async (table: string, rows: Row[]) => (await getStore()).set(`tb:${table}`, JSON.stringify(rows));
  const put = async (table: string, row: Row, replace: boolean) => lock(table, async () => {
    const rows = await load(table);
    const { data, ...light } = row;
    const i = row.id === undefined ? -1 : rows.findIndex((r) => r.id === row.id);
    if (i >= 0 && !replace) throw new HttpError(409, "Already exists");
    if (i >= 0) rows[i] = { ...rows[i], ...light }; else rows.push(light);
    if (HEAVY.has(table) && data !== undefined) await (await getStore()).set(`td:${table}:${row.id}`, JSON.stringify(data));
    await save(table, rows);
  });
  return {
    mode: "builtin",
    async select(table, filter, o = {}) {
      let rows = (await load(table)).filter((r) => matches(r, filter));
      if (o.order) { const [col, dir] = o.order.split("."); rows.sort((a, b) => String(a[col] ?? "").localeCompare(String(b[col] ?? "")) * (dir === "desc" ? -1 : 1)); }
      if (o.limit) rows = rows.slice(0, o.limit);
      if (HEAVY.has(table) && (!o.columns || o.columns === "*" || /\bdata\b/.test(o.columns))) {
        const store = await getStore();
        rows = await Promise.all(rows.map(async (r) => { const d = await store.get(`td:${table}:${r.id}`); return { ...r, data: d ? JSON.parse(d) : null }; }));
      }
      return rows as never;
    },
    insert: (table, row) => put(table, row, false),
    upsert: (table, row) => put(table, row, true),
    update: (table, filter, patch) => lock(table, async () => {
      const rows = await load(table);
      let n = 0;
      for (const r of rows) if (matches(r, filter)) { Object.assign(r, patch); n++; }
      if (n) await save(table, rows);
      return n;
    }),
    remove: (table, filter) => lock(table, async () => {
      const rows = await load(table);
      const keep = rows.filter((r) => !matches(r, filter));
      if (HEAVY.has(table)) { const store = await getStore(); for (const r of rows) if (matches(r, filter)) await store.del(`td:${table}:${r.id}`); }
      if (keep.length !== rows.length) await save(table, keep);
      return rows.length - keep.length;
    }),
  };
}

const SESSION_DAYS = 7;
export function builtinAuth(db: Db): AuthProvider {
  const session = async (u: Row): Promise<Session> => {
    const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
    return { token: signToken({ uid: u.id, exp }, await getSecret()), expiresAt: exp * 1000, user: { id: u.id, email: u.email, name: u.name } };
  };
  return {
    async signup(email, password, name) {
      if ((await db.select("users", { email })).length) throw new HttpError(400, "An account with this email already exists. Sign in instead.");
      const u = { id: uuid(), email, name, pass: hashPassword(password), created_at: new Date().toISOString() };
      await db.insert("users", u);
      return { session: await session(u) };
    },
    async login(email, password) {
      const [u] = await db.select("users", { email });
      if (!u || !checkPassword(password, u.pass)) throw new HttpError(400, "Wrong email or password.");
      return session(u);
    },
    async refresh() { throw new HttpError(401, "Your session has expired. Please sign in again."); },
    async user(token) {
      const v = verifyToken<{ uid: string; exp: number }>(token, await getSecret());
      if (!v.ok) return null;
      const [u] = await db.select("users", { id: v.payload.uid });
      return u ? { id: u.id, email: u.email, name: u.name } : null;
    },
  };
}

// ---------------------------------------------------------------- selection

let backend: { db: Db; auth: AuthProvider } | null = null;
export function getBackend(): { db: Db; auth: AuthProvider } {
  if (!backend) {
    const cfg = supabaseConfig();
    if (cfg) backend = { db: supabaseDb(cfg), auth: supabaseAuth(cfg) };
    else { const db = builtinDb(); backend = { db, auth: builtinAuth(db) }; }
  }
  return backend;
}
/** Tests only. */
export function resetBackend() { backend = null; secretCache = null; }
