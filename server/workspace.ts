// Round 3 API: accounts and workspaces, signed share links, live connectors (Discord, Slack, GitHub
// webhook), the capture inbox and Ask Baton. See server/db.ts for how access is enforced.
import { z } from "zod";
import { HttpError, json, limit, parse, type Ctx, type Route } from "./http";
import { getBackend, getSecret, supabaseConfig, type Row, type User } from "./db";
import { getStore } from "./storage";
import { aiConfig, makeCallModel } from "./ai";
import { randomId, signToken, uuid, verifyDiscord, verifyGithub, verifySlack, verifyToken } from "./crypto";
import { buildPackage } from "../src/core/plan";
import { ask } from "../src/core/ask";
import { fromGithub, makeEvent, parseCommand, type ParsedItem } from "../src/core/capture";
import type { AccessTag, AskedQuestion, CaptureEvent, CaptureSource, OrgRole, Project, SectionKey, SharePackage } from "../src/core/types";

const now = () => new Date().toISOString();
const RANK: Record<OrgRole, number> = { member: 1, lead: 2, owner: 3 };
const Email = z.string().trim().toLowerCase().email().max(200);
const OrgRoleZ = z.enum(["owner", "lead", "member"]);
const AccessZ = z.enum(["member", "lead"]);

export function workspaceHealth() {
  return {
    accounts: { mode: getBackend().db.mode, rls: getBackend().db.mode === "supabase", serviceKey: getBackend().db.mode === "builtin" || !!supabaseConfig()?.service },
    connectors: { discord: !!process.env.DISCORD_PUBLIC_KEY, discordAppId: (process.env.DISCORD_APP_ID || process.env.DISCORD_APPLICATION_ID) || null, discordCanRegister: !!((process.env.DISCORD_APP_ID || process.env.DISCORD_APPLICATION_ID) && process.env.DISCORD_BOT_TOKEN), slack: !!process.env.SLACK_SIGNING_SECRET },
    signedLinks: true,
  };
}

// ---------------------------------------------------------------- identity and roles

function bearer(c: Ctx): string | null {
  const h = String(c.req.headers.authorization || "");
  return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : null;
}
async function maybeMe(c: Ctx): Promise<{ user: User; token: string } | null> {
  const token = bearer(c);
  if (!token) return null;
  const user = await getBackend().auth.user(token);
  return user ? { user, token } : null;
}
async function me(c: Ctx): Promise<{ user: User; token: string }> {
  const m = await maybeMe(c);
  if (!m) throw new HttpError(401, "Please sign in.");
  return m;
}
async function roleIn(m: { user: User; token: string }, orgId: string): Promise<OrgRole | null> {
  const [row] = await getBackend().db.select("memberships", { org_id: orgId, user_id: m.user.id }, { as: m.token });
  return (row?.role as OrgRole) || null;
}
async function need(m: { user: User; token: string }, orgId: string, min: OrgRole): Promise<OrgRole> {
  const role = await roleIn(m, orgId);
  if (!role) throw new HttpError(403, "You are not a member of this workspace.");
  if (RANK[role] < RANK[min]) throw new HttpError(403, `Only a workspace ${min === "owner" ? "owner" : "lead or owner"} can do that. Your role is ${role}.`);
  return role;
}
const canSeePackage = (role: OrgRole, pkgRole: string) => pkgRole === "member" || RANK[role] >= RANK.lead;
const canSeeAccess = (role: OrgRole, access: string) => access === "member" || (access === "lead" && RANK[role] >= RANK.lead);

// ---------------------------------------------------------------- packages: access and events

export interface Resolved {
  pkg: SharePackage;
  via: { kind: "link" | "member" | "open"; linkId?: string; expiresAt?: string | null; role?: OrgRole };
  orgId?: string;
  user?: User;
  token?: string;
}

function mergeEvents(pkg: SharePackage, events: Row[]): SharePackage {
  const out: SharePackage = { ...pkg, acknowledgements: {}, flags: [], questions: [] };
  for (const e of [...events].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
    const p = e.payload || {};
    if (e.kind === "ack" && p.section) out.acknowledgements[p.section as SectionKey] = { by: e.by_name, at: e.created_at };
    else if (e.kind === "flag") out.flags.push({ claimId: p.claimId, note: p.note, by: e.by_name, at: e.created_at });
    else if (e.kind === "question") out.questions!.push({ id: e.id, question: p.question, by: e.by_name, at: e.created_at, found: !!p.found });
  }
  return out;
}

async function withEvents(row: Row, as?: string): Promise<SharePackage> {
  const events = await getBackend().db.select("package_events", { package_id: row.id }, { as, order: "created_at.asc", limit: 500 });
  return mergeEvents({ ...(row.data as SharePackage), orgId: row.org_id }, events);
}

const linkToken = async (l: Row) => signToken({ l: l.id, p: l.package_id, exp: l.expires_at ? Math.floor(Date.parse(l.expires_at) / 1000) : 0 }, await getSecret());

/** Who may open a handover: a valid signed link, a signed-in workspace member with the right role, or (demo packages only) anyone with the id. */
export async function resolvePackage(c: Ctx, id: string): Promise<Resolved> {
  const { db } = getBackend();
  const k = c.query.get("k") || String(c.req.headers["x-baton-link"] || "");
  if (k) {
    const v = verifyToken<{ l: string; p: string; exp: number }>(k, await getSecret());
    if (!v.ok) throw new HttpError(v.reason === "expired" ? 410 : 403, v.reason === "expired" ? "This share link has expired. Ask the reviewer for a new one." : "This share link is not valid.");
    if (v.payload.p !== id) throw new HttpError(403, "This share link is for a different handover.");
    const [link] = await db.select("share_links", { id: v.payload.l });
    if (!link || link.package_id !== id) throw new HttpError(403, "This share link is not valid.");
    if (link.revoked_at) throw new HttpError(410, "This share link was revoked by the reviewer.");
    if (link.expires_at && Date.parse(link.expires_at) < Date.now()) throw new HttpError(410, "This share link has expired. Ask the reviewer for a new one.");
    const [row] = await db.select("packages", { id });
    if (!row) throw new HttpError(404, "Handover not found.");
    db.update("share_links", { id: link.id }, { opens: (Number(link.opens) || 0) + 1, last_opened_at: now() }).catch(() => {});
    return { pkg: await withEvents(row), via: { kind: "link", linkId: link.id, expiresAt: link.expires_at || null }, orgId: row.org_id };
  }
  const m = await maybeMe(c);
  if (m) {
    const [row] = await db.select("packages", { id }, { as: m.token });
    if (row) {
      const role = await roleIn(m, row.org_id);
      if (role && canSeePackage(role, row.role)) return { pkg: await withEvents(row, m.token), via: { kind: "member", role }, orgId: row.org_id, user: m.user, token: m.token };
    }
  }
  const raw = await (await getStore()).get(`pkg:${id}`).catch(() => null);
  if (raw) return { pkg: JSON.parse(raw) as SharePackage, via: { kind: "open" } };
  // Does a workspace handover with this id exist? Then say access is needed rather than "not found".
  const exists = await db.select("packages", { id }, { columns: "id" }).catch(() => []);
  if (exists.length) throw new HttpError(m ? 403 : 401, m ? "Your workspace role does not allow opening this handover." : "This handover belongs to a workspace. Open it with its share link, or sign in.");
  throw new HttpError(404, "Handover not found on the server.");
}

export async function recordEvent(r: Resolved, kind: "ack" | "flag" | "question", payload: Row, byName: string): Promise<SharePackage> {
  const by = r.user?.name || byName;
  if (r.orgId) {
    const { db } = getBackend();
    const row = { id: uuid(), org_id: r.orgId, package_id: r.pkg.id, kind, payload, by_user: r.user?.id || null, by_name: by, link_id: r.via.linkId || null, created_at: now() };
    await db.insert("package_events", row, r.token); // members write as themselves (RLS); link holders through the verified link
    const [fresh] = await db.select("packages", { id: r.pkg.id });
    return fresh ? withEvents(fresh) : r.pkg;
  }
  const pkg = r.pkg;
  if (kind === "ack") pkg.acknowledgements[payload.section as SectionKey] = { by, at: now() };
  else if (kind === "flag") pkg.flags.push({ claimId: payload.claimId, note: payload.note, by, at: now() });
  else pkg.questions = [...(pkg.questions || []), { id: uuid(), question: payload.question, by, at: now(), found: !!payload.found } as AskedQuestion].slice(-50);
  await (await getStore()).set(`pkg:${pkg.id}`, JSON.stringify(pkg));
  return pkg;
}

// ---------------------------------------------------------------- capture helpers

const toEvent = (r: Row): CaptureEvent => ({ id: r.id, orgId: r.org_id, connectorId: r.connector_id, source: r.source, kind: r.kind, text: r.text, why: r.why || undefined, owner: r.owner || undefined, due: r.due || undefined, author: r.author, access: r.access, url: r.url || undefined, ref: r.ref || undefined, projectId: r.project_id || undefined, status: r.status, at: r.created_at });
const toRow = (e: CaptureEvent): Row => ({ id: e.id, org_id: e.orgId, connector_id: e.connectorId, source: e.source, kind: e.kind, text: e.text, why: e.why || null, owner: e.owner || null, due: e.due || null, author: e.author, access: e.access, url: e.url || null, ref: e.ref || null, project_id: e.projectId || null, status: e.status, created_at: e.at });

async function capture(conn: Row, source: CaptureSource, item: ParsedItem & { author: string; url?: string }, ref?: string, access?: AccessTag) {
  const { event } = makeEvent({ orgId: conn.org_id, connectorId: conn.id, source, access: access || conn.default_access || "member", projectId: conn.project_id || undefined, ref }, item);
  await getBackend().db.insert("capture_events", toRow(event));
  return event;
}

const KIND_WORD: Record<string, string> = { decision: "decision", risk: "risk", task: "task", contact: "contact", note: "note" };
const confirm = (e: CaptureEvent) => `Logged ${KIND_WORD[e.kind]}: “${e.text}”${e.why ? ` — ${e.why}` : ""}${e.owner ? ` · owner ${e.owner}` : ""}${e.due ? ` · due ${e.due}` : ""} · visible to ${e.access === "lead" ? "Leads only" : "Members"}. It is now in Baton's capture inbox.`;
const HELP = "Try: `decision Use Razorpay because fees are lower` · `risk Domain expires in March @riya` · `task Fix the webhook @arjun due 2026-12-01` · `owner payments -> Riya` · `note …`";

async function linkChat(kind: "discord" | "slack", code: string, externalId: string, label: string): Promise<string> {
  const { db } = getBackend();
  const [conn] = await db.select("connectors", { kind, secret: code.trim().toUpperCase() });
  if (!conn) return "That link code was not found. In Baton open Workspace → Connectors, add a connector and copy its code.";
  await db.update("connectors", { id: conn.id }, { external_id: externalId, label: conn.label || label, linked_at: now() });
  const [org] = await db.select("orgs", { id: conn.org_id });
  return `Linked to the Baton workspace “${org?.name || "workspace"}”. ${HELP}`;
}

const DISCORD_COMMAND = (() => {
  const s = (name: string, description: string, required = false) => ({ type: 3, name, description, required });
  const vis = { type: 3, name: "visibility", description: "Who may see this in a handover (default: the connector's setting)", choices: [{ name: "Member", value: "member" }, { name: "Lead only", value: "lead" }] };
  const sub = (name: string, description: string, options: unknown[]) => ({ type: 1, name, description, options });
  return {
    name: "baton",
    description: "Log project knowledge to Baton while the work is happening",
    options: [
      sub("decision", "Log a decision and its reason", [s("text", "What was decided", true), s("why", "Why — the reasoning successors usually lose"), vis]),
      sub("risk", "Log a risk", [s("text", "What could go wrong", true), s("impact", "What happens if it does"), s("owner", "Who is watching it"), vis]),
      sub("task", "Log an open task", [s("text", "What needs doing", true), s("owner", "Who owns it"), s("due", "Due date, YYYY-MM-DD"), vis]),
      sub("owner", "Record who owns an area", [s("area", "What is owned (e.g. payments, the domain)", true), s("person", "Who owns it now", true), vis]),
      sub("note", "Log anything else worth keeping", [s("text", "The note", true), vis]),
      sub("link", "Link this server to a Baton workspace", [s("code", "The code shown in Baton → Workspace → Connectors", true)]),
    ],
  };
})();

// ---------------------------------------------------------------- schemas

const SignupBody = z.object({ email: Email, password: z.string().min(8, "must be at least 8 characters").max(200), name: z.string().trim().min(1).max(80) });
const LoginBody = z.object({ email: Email, password: z.string().min(1).max(200) });
const OrgBody = z.object({ name: z.string().trim().min(2).max(80) });
const InviteBody = z.object({ email: Email, role: OrgRoleZ });
const ProjectBody = z.object({ orgId: z.string().max(80), project: z.any() });
const PublishBody = z.object({ project: z.any(), previous: z.any().optional() });
const LinkBody = z.object({ days: z.number().int().min(1).max(365).nullable(), label: z.string().trim().max(80).optional() });
const ConnectorBody = z.object({ kind: z.enum(["discord", "slack", "github"]), label: z.string().trim().max(80).optional(), projectId: z.string().max(80).optional(), defaultAccess: AccessZ.default("member"), repo: z.string().trim().max(140).optional() });
const CaptureUpdate = z.object({ ids: z.array(z.string().max(80)).min(1).max(200), status: z.enum(["new", "added", "dismissed"]), projectId: z.string().max(80).optional() });
const AskBody = z.object({ id: z.string().max(140), question: z.string().trim().min(3).max(500), by: z.string().trim().max(100).optional(), package: z.any().optional() });

const ID = "([\\w-]{3,120})";
const R = (method: string, path: string, fn: Route[2]): Route => [method, new RegExp(`^/api/${path}$`), fn];

async function orgsOf(m: { user: User; token: string }) {
  const { db } = getBackend();
  const mine = await db.select("memberships", { user_id: m.user.id }, { as: m.token });
  if (!mine.length) return [];
  const orgs = await db.select("orgs", { id: mine.map((x) => x.org_id) }, { as: m.token });
  return orgs.map((o) => ({ id: o.id, name: o.name, role: mine.find((x) => x.org_id === o.id)!.role as OrgRole }));
}

// ---------------------------------------------------------------- routes

export const workspaceRoutes: Route[] = [
  // ---- accounts
  R("POST", "auth/signup", async (c) => {
    limit(c.req, "auth", 30);
    const b = parse(SignupBody, await c.body());
    const r = await getBackend().auth.signup(b.email, b.password, b.name);
    json(c.res, 200, r.session ? { session: r.session } : { needsConfirm: true, message: "Check your email to confirm the account, then sign in." });
  }),
  R("POST", "auth/login", async (c) => {
    limit(c.req, "auth", 30);
    const b = parse(LoginBody, await c.body());
    json(c.res, 200, { session: await getBackend().auth.login(b.email, b.password) });
  }),
  R("POST", "auth/refresh", async (c) => {
    const b = parse(z.object({ refresh: z.string().min(10).max(2000) }), await c.body());
    json(c.res, 200, { session: await getBackend().auth.refresh(b.refresh) });
  }),
  R("GET", "auth/me", async (c) => {
    const m = await me(c);
    const { db } = getBackend();
    const invites = (await db.select("invites", { email: m.user.email, accepted_at: null }).catch(() => [])) as Row[];
    const names = invites.length ? await db.select("orgs", { id: invites.map((i) => i.org_id) }).catch(() => []) : [];
    json(c.res, 200, { user: m.user, orgs: await orgsOf(m), invites: invites.map((i) => ({ token: i.token, orgName: names.find((o) => o.id === i.org_id)?.name || "a workspace", role: i.role, invitedBy: i.invited_by_name })) });
  }),

  // ---- workspaces, members, invitations
  R("POST", "orgs", async (c) => {
    const m = await me(c);
    const b = parse(OrgBody, await c.body());
    const { db } = getBackend();
    const org = { id: uuid(), name: b.name, created_by: m.user.id, created_at: now() };
    // creating a workspace and its first owner is a trusted server step (the caller's identity is verified above)
    await db.insert("orgs", org);
    await db.insert("memberships", { org_id: org.id, user_id: m.user.id, role: "owner", email: m.user.email, name: m.user.name, created_at: now() });
    json(c.res, 200, { org: { id: org.id, name: org.name, role: "owner" } });
  }),
  R("GET", `orgs/${ID}`, async (c) => {
    const m = await me(c);
    const role = await need(m, c.params[0], "member");
    const { db } = getBackend();
    const [org] = await db.select("orgs", { id: c.params[0] }, { as: m.token });
    const members = await db.select("memberships", { org_id: c.params[0] }, { as: m.token, order: "created_at.asc" });
    const invites = RANK[role] >= RANK.lead ? await db.select("invites", { org_id: c.params[0], accepted_at: null }, { as: m.token, order: "created_at.desc" }) : [];
    json(c.res, 200, {
      org: { id: org.id, name: org.name, role },
      members: members.map((x) => ({ userId: x.user_id, name: x.name, email: x.email, role: x.role, joinedAt: x.created_at })),
      invites: invites.map((i) => ({ id: i.id, email: i.email, role: i.role, invitedBy: i.invited_by_name, at: i.created_at, url: `${c.origin}/join/${i.token}` })),
    });
  }),
  R("POST", `orgs/${ID}/invites`, async (c) => {
    const m = await me(c);
    const b = parse(InviteBody, await c.body());
    const role = await need(m, c.params[0], "lead");
    if (role !== "owner" && b.role !== "member") throw new HttpError(403, "Only an owner can invite Leads or Owners.");
    const { db } = getBackend();
    const members = await db.select("memberships", { org_id: c.params[0] }, { as: m.token });
    if (members.some((x) => String(x.email).toLowerCase() === b.email)) throw new HttpError(400, "That person is already a member.");
    await db.remove("invites", { org_id: c.params[0], email: b.email, accepted_at: null }, m.token);
    const inv = { id: uuid(), org_id: c.params[0], email: b.email, role: b.role, token: randomId(18), invited_by: m.user.id, invited_by_name: m.user.name, created_at: now(), accepted_at: null };
    await db.insert("invites", inv, m.token);
    json(c.res, 200, { invite: { id: inv.id, email: inv.email, role: inv.role, invitedBy: m.user.name, at: inv.created_at, url: `${c.origin}/join/${inv.token}` } });
  }),
  R("DELETE", `orgs/${ID}/invites/${ID}`, async (c) => {
    const m = await me(c);
    await need(m, c.params[0], "lead");
    await getBackend().db.remove("invites", { id: c.params[1], org_id: c.params[0] }, m.token);
    json(c.res, 200, { ok: true });
  }),
  R("GET", `invites/${ID}`, async (c) => {
    const { db } = getBackend();
    const [inv] = await db.select("invites", { token: c.params[0] });
    if (!inv || inv.accepted_at) throw new HttpError(404, "This invitation was not found or has already been used.");
    const [org] = await db.select("orgs", { id: inv.org_id });
    json(c.res, 200, { invite: { orgName: org?.name, role: inv.role, email: inv.email, invitedBy: inv.invited_by_name } });
  }),
  R("POST", `invites/${ID}/accept`, async (c) => {
    const m = await me(c);
    const { db } = getBackend();
    const [inv] = await db.select("invites", { token: c.params[0] });
    if (!inv || inv.accepted_at) throw new HttpError(404, "This invitation was not found or has already been used.");
    if (String(inv.email).toLowerCase() !== m.user.email) throw new HttpError(403, `This invitation is for ${inv.email}. Sign in with that email to accept it.`);
    const existing = await db.select("memberships", { org_id: inv.org_id, user_id: m.user.id });
    if (!existing.length) await db.insert("memberships", { org_id: inv.org_id, user_id: m.user.id, role: inv.role, email: m.user.email, name: m.user.name, created_at: now() });
    await db.update("invites", { id: inv.id }, { accepted_at: now() });
    const [org] = await db.select("orgs", { id: inv.org_id });
    json(c.res, 200, { org: { id: org.id, name: org.name, role: existing[0]?.role || inv.role } });
  }),
  R("PATCH", `orgs/${ID}/members/${ID}`, async (c) => {
    const m = await me(c);
    const b = parse(z.object({ role: OrgRoleZ }), await c.body());
    await need(m, c.params[0], "owner");
    const { db } = getBackend();
    const members = await db.select("memberships", { org_id: c.params[0] }, { as: m.token });
    const target = members.find((x) => x.user_id === c.params[1]);
    if (!target) throw new HttpError(404, "Member not found.");
    if (target.role === "owner" && b.role !== "owner" && members.filter((x) => x.role === "owner").length === 1) throw new HttpError(400, "A workspace needs at least one owner.");
    await db.update("memberships", { org_id: c.params[0], user_id: c.params[1] }, { role: b.role }, m.token);
    json(c.res, 200, { ok: true });
  }),
  R("DELETE", `orgs/${ID}/members/${ID}`, async (c) => {
    const m = await me(c);
    const self = c.params[1] === m.user.id;
    await need(m, c.params[0], self ? "member" : "owner");
    const { db } = getBackend();
    const members = await db.select("memberships", { org_id: c.params[0] }, { as: m.token });
    const target = members.find((x) => x.user_id === c.params[1]);
    if (!target) throw new HttpError(404, "Member not found.");
    if (target.role === "owner" && members.filter((x) => x.role === "owner").length === 1) throw new HttpError(400, "A workspace needs at least one owner.");
    // leaving yourself is allowed for every role; the server performs it after checking who is asking
    await db.remove("memberships", { org_id: c.params[0], user_id: c.params[1] }, self ? undefined : m.token);
    json(c.res, 200, { ok: true });
  }),

  // ---- workspace projects (Private sources never reach the server)
  R("GET", `orgs/${ID}/projects`, async (c) => {
    const m = await me(c);
    const role = await need(m, c.params[0], "member");
    const rows = RANK[role] >= RANK.lead ? await getBackend().db.select("projects", { org_id: c.params[0] }, { as: m.token, columns: "id,org_id,title,updated_by_name,updated_at", order: "updated_at.desc" }) : [];
    json(c.res, 200, { projects: rows.map((r) => ({ id: r.id, title: r.title, updatedBy: r.updated_by_name, updatedAt: r.updated_at })) });
  }),
  R("GET", `projects/${ID}`, async (c) => {
    const m = await me(c);
    const [row] = await getBackend().db.select("projects", { id: c.params[0] }, { as: m.token });
    if (!row) throw new HttpError(404, "Project not found in your workspaces.");
    await need(m, row.org_id, "lead");
    json(c.res, 200, { project: { ...row.data, orgId: row.org_id }, updatedBy: row.updated_by_name, updatedAt: row.updated_at });
  }),
  R("PUT", `projects/${ID}`, async (c) => {
    const m = await me(c);
    const b = parse(ProjectBody, await c.body());
    await need(m, b.orgId, "lead");
    const p = b.project as Project;
    if (!p || p.id !== c.params[0] || !Array.isArray(p.sources) || !Array.isArray(p.claims)) throw new HttpError(400, "Invalid project");
    const { db } = getBackend();
    const [existing] = await db.select("projects", { id: p.id }, { columns: "id,org_id" });
    if (existing && existing.org_id !== b.orgId) throw new HttpError(409, "This project is already saved in another workspace.");
    // defence in depth: Private material is stripped again on the server even if a client sent it
    const data: Project = { ...p, orgId: b.orgId, sources: p.sources.filter((s) => s.access !== "private"), worklog: (p.worklog || []).filter((w) => w.access !== "private") };
    await db.upsert("projects", { id: p.id, org_id: b.orgId, title: String(p.title || "Untitled project").slice(0, 200), data, updated_by: m.user.id, updated_by_name: m.user.name, updated_at: now() }, m.token);
    json(c.res, 200, { ok: true, updatedAt: now(), withheldPrivate: p.sources.length - data.sources.length });
  }),
  R("DELETE", `projects/${ID}`, async (c) => {
    const m = await me(c);
    const [row] = await getBackend().db.select("projects", { id: c.params[0] }, { as: m.token, columns: "id,org_id" });
    if (!row) throw new HttpError(404, "Project not found in your workspaces.");
    await need(m, row.org_id, "lead");
    await getBackend().db.remove("projects", { id: row.id }, m.token);
    json(c.res, 200, { ok: true });
  }),

  // ---- publishing into a workspace: the approver is the signed-in person
  R("POST", `orgs/${ID}/publish`, async (c) => {
    const m = await me(c);
    const b = parse(PublishBody, await c.body());
    await need(m, c.params[0], "lead");
    const project = b.project as Project;
    if (!project?.id || !Array.isArray(project.claims) || !Array.isArray(project.sources)) throw new HttpError(400, "Invalid project");
    const pkg = buildPackage(project, m.user.name, b.previous as SharePackage | undefined);
    if (!pkg.claims.length) throw new HttpError(400, "Approve at least one claim before publishing.");
    pkg.orgId = c.params[0];
    await getBackend().db.upsert("packages", { id: pkg.id, org_id: c.params[0], project_id: project.id, version: pkg.version, role: pkg.role, title: pkg.title, data: pkg, published_by: m.user.id, published_by_name: m.user.name, created_at: now() }, m.token);
    json(c.res, 200, { package: pkg, stored: true, durable: true, storage: getBackend().db.mode === "supabase" ? "workspace (Postgres)" : "workspace" });
  }),
  R("GET", `orgs/${ID}/packages`, async (c) => {
    const m = await me(c);
    const role = await need(m, c.params[0], "member");
    const rows = await getBackend().db.select("packages", { org_id: c.params[0] }, { as: m.token, columns: "id,org_id,project_id,version,role,title,published_by_name,created_at", order: "created_at.desc" });
    json(c.res, 200, { packages: rows.filter((r) => canSeePackage(role, r.role)).map((r) => ({ id: r.id, projectId: r.project_id, version: r.version, role: r.role, title: r.title, publishedBy: r.published_by_name, at: r.created_at })) });
  }),

  // ---- signed share links
  R("GET", `packages/${ID}/links`, async (c) => {
    const m = await me(c);
    const { db } = getBackend();
    const [pkg] = await db.select("packages", { id: c.params[0] }, { as: m.token, columns: "id,org_id" });
    if (!pkg) throw new HttpError(404, "Handover not found in your workspaces.");
    await need(m, pkg.org_id, "lead");
    const links = await db.select("share_links", { package_id: pkg.id }, { as: m.token, order: "created_at.desc" });
    json(c.res, 200, { links: await Promise.all(links.map(async (l) => ({ id: l.id, label: l.label || "", createdBy: l.created_by_name, at: l.created_at, expiresAt: l.expires_at || null, revokedAt: l.revoked_at || null, opens: Number(l.opens) || 0, lastOpenedAt: l.last_opened_at || null, url: `${c.origin}/h/${pkg.id}?k=${await linkToken(l)}` }))) });
  }),
  R("POST", `packages/${ID}/links`, async (c) => {
    const m = await me(c);
    const b = parse(LinkBody, await c.body());
    const { db } = getBackend();
    const [pkg] = await db.select("packages", { id: c.params[0] }, { as: m.token, columns: "id,org_id" });
    if (!pkg) throw new HttpError(404, "Publish this handover to the workspace first.");
    await need(m, pkg.org_id, "lead");
    const l = { id: uuid(), org_id: pkg.org_id, package_id: pkg.id, label: b.label || null, expires_at: b.days ? new Date(Date.now() + b.days * 86400_000).toISOString() : null, revoked_at: null, created_by: m.user.id, created_by_name: m.user.name, created_at: now(), opens: 0, last_opened_at: null };
    await db.insert("share_links", l, m.token);
    json(c.res, 200, { link: { id: l.id, label: l.label || "", createdBy: m.user.name, at: l.created_at, expiresAt: l.expires_at, revokedAt: null, opens: 0, lastOpenedAt: null, url: `${c.origin}/h/${pkg.id}?k=${await linkToken(l)}` } });
  }),
  R("POST", `links/${ID}/revoke`, async (c) => {
    const m = await me(c);
    const { db } = getBackend();
    const [l] = await db.select("share_links", { id: c.params[0] }, { as: m.token });
    if (!l) throw new HttpError(404, "Share link not found.");
    await need(m, l.org_id, "lead");
    await db.update("share_links", { id: l.id }, { revoked_at: now() }, m.token);
    json(c.res, 200, { ok: true });
  }),

  // ---- Ask Baton
  R("POST", "ask", async (c) => {
    limit(c.req, "ask", 60);
    const b = parse(AskBody, await c.body());
    let r: Resolved;
    try {
      r = await resolvePackage(c, b.id);
    } catch (e) {
      // a handover that only exists in the asker's browser: answer from the copy they already hold
      const p = b.package as SharePackage | undefined;
      if (!(e instanceof HttpError) || e.status !== 404 || !p || p.id !== b.id || !Array.isArray(p.claims) || !Array.isArray(p.chunks)) throw e;
      r = { pkg: p, via: { kind: "open" } };
    }
    const ai = aiConfig();
    const answer = await ask(r.pkg, b.question, ai ? makeCallModel(ai) : undefined);
    let pkg: SharePackage | undefined;
    try { if (r.orgId || !b.package) pkg = await recordEvent(r, "question", { question: b.question, found: answer.found }, b.by || r.pkg.successor); } catch { /* logging the question must never block the answer */ }
    json(c.res, 200, { answer, questions: pkg?.questions });
  }),

  // ---- connectors
  R("GET", `orgs/${ID}/connectors`, async (c) => {
    const m = await me(c);
    await need(m, c.params[0], "lead");
    const rows = await getBackend().db.select("connectors", { org_id: c.params[0] }, { as: m.token, order: "created_at.asc" });
    json(c.res, 200, { connectors: rows.map((r) => connectorView(r, c.origin)) });
  }),
  R("POST", `orgs/${ID}/connectors`, async (c) => {
    const m = await me(c);
    const b = parse(ConnectorBody, await c.body());
    await need(m, c.params[0], "lead");
    const row = {
      id: uuid(), org_id: c.params[0], kind: b.kind, label: b.label || (b.kind === "github" ? b.repo || "GitHub repository" : null),
      external_id: b.kind === "github" ? b.repo || null : null,
      secret: b.kind === "github" ? randomId(24) : `BTN-${randomId(5).replace(/[^A-Za-z0-9]/g, "X").toUpperCase()}`,
      project_id: b.projectId || null, default_access: b.defaultAccess, created_by: m.user.id, created_by_name: m.user.name, created_at: now(), linked_at: null,
    };
    await getBackend().db.insert("connectors", row, m.token);
    json(c.res, 200, { connector: connectorView(row, c.origin) });
  }),
  R("DELETE", `connectors/${ID}`, async (c) => {
    const m = await me(c);
    const { db } = getBackend();
    const [row] = await db.select("connectors", { id: c.params[0] }, { as: m.token });
    if (!row) throw new HttpError(404, "Connector not found.");
    await need(m, row.org_id, "lead");
    await db.remove("connectors", { id: row.id }, m.token);
    json(c.res, 200, { ok: true });
  }),
  R("POST", "connectors/discord/register", async (c) => {
    const m = await me(c);
    if (!(await orgsOf(m)).some((o) => RANK[o.role] >= RANK.lead)) throw new HttpError(403, "Only a workspace lead or owner can do that.");
    const app = (process.env.DISCORD_APP_ID || process.env.DISCORD_APPLICATION_ID), bot = process.env.DISCORD_BOT_TOKEN;
    if (!app || !bot) throw new HttpError(400, "Set DISCORD_APP_ID and DISCORD_BOT_TOKEN on the server first.");
    const res = await fetch(`https://discord.com/api/v10/applications/${app}/commands`, { method: "PUT", headers: { authorization: `Bot ${bot}`, "content-type": "application/json" }, body: JSON.stringify([DISCORD_COMMAND]), signal: AbortSignal.timeout(10000) }).catch((e) => { throw new HttpError(502, `Could not reach Discord: ${(e as Error).message}`); });
    if (!res.ok) throw new HttpError(502, `Discord refused the command registration (${res.status}): ${(await res.text()).slice(0, 200)}`);
    json(c.res, 200, { ok: true, message: "The /baton command is registered. Discord can take a minute to show it." });
  }),

  // ---- capture inbox
  R("GET", `orgs/${ID}/capture`, async (c) => {
    const m = await me(c);
    const role = await need(m, c.params[0], "member");
    const filter: Record<string, string> = { org_id: c.params[0] };
    const status = c.query.get("status");
    if (status && ["new", "added", "dismissed"].includes(status)) filter.status = status;
    const rows = await getBackend().db.select("capture_events", filter, { as: m.token, order: "created_at.desc", limit: 300 });
    const project = c.query.get("project");
    json(c.res, 200, { events: rows.map(toEvent).filter((e) => canSeeAccess(role, e.access) && (!project || !e.projectId || e.projectId === project)) });
  }),
  R("POST", `orgs/${ID}/capture/update`, async (c) => {
    const m = await me(c);
    const b = parse(CaptureUpdate, await c.body());
    await need(m, c.params[0], "lead");
    const patch: Row = { status: b.status };
    if (b.projectId) patch.project_id = b.projectId;
    const n = await getBackend().db.update("capture_events", { org_id: c.params[0], id: b.ids }, patch, m.token);
    json(c.res, 200, { updated: n });
  }),

  // ---- inbound webhooks (verified by signature; no session)
  R("POST", "hooks/discord", async (c) => {
    const key = process.env.DISCORD_PUBLIC_KEY;
    if (!key) throw new HttpError(503, "DISCORD_PUBLIC_KEY is not set on the server.");
    const raw = await c.raw();
    if (!verifyDiscord(key, String(c.req.headers["x-signature-ed25519"] || ""), String(c.req.headers["x-signature-timestamp"] || ""), raw)) throw new HttpError(401, "Bad request signature");
    const i = JSON.parse(raw);
    if (i.type === 1) return json(c.res, 200, { type: 1 });
    const reply = (content: string) => json(c.res, 200, { type: 4, data: { content: content.slice(0, 1900), flags: 64 } });
    if (i.type !== 2 || i.data?.name !== "baton") return reply("Unknown command.");
    const sub = i.data.options?.[0];
    const o: Record<string, string> = Object.fromEntries((sub?.options || []).map((x: Row) => [x.name, String(x.value)]));
    const guild = i.guild_id;
    if (!guild) return reply("Use /baton inside a server, not in a direct message.");
    if (sub?.name === "link") return reply(await linkChat("discord", o.code || "", guild, "Discord server"));
    const [conn] = await getBackend().db.select("connectors", { kind: "discord", external_id: guild });
    if (!conn) return reply("This server is not linked to a Baton workspace yet. In Baton open Workspace → Connectors, add a Discord connector, then run `/baton link <code>` here.");
    const item: ParsedItem | null =
      sub?.name === "decision" ? { kind: "decision", text: o.text, why: o.why } :
      sub?.name === "risk" ? { kind: "risk", text: o.text, why: o.impact, owner: o.owner } :
      sub?.name === "task" ? { kind: "task", text: o.text, owner: o.owner, due: /^\d{4}-\d{2}-\d{2}$/.test(o.due || "") ? o.due : undefined } :
      sub?.name === "owner" ? parseCommand(`owner ${o.area} -> ${o.person}`) :
      sub?.name === "note" ? { kind: "note", text: o.text } : null;
    if (!item?.text) return reply("Nothing to log. " + HELP);
    const author = i.member?.nick || i.member?.user?.global_name || i.member?.user?.username || "Discord user";
    const e = await capture(conn, "discord", { ...item, author }, `discord:${i.id}`, o.visibility === "lead" || o.visibility === "member" ? o.visibility : undefined);
    reply(confirm(e) + (sub?.name === "task" && o.due && !e.due ? " (The due date was ignored — use YYYY-MM-DD.)" : ""));
  }),
  R("POST", "hooks/slack", async (c) => {
    const secret = process.env.SLACK_SIGNING_SECRET;
    if (!secret) throw new HttpError(503, "SLACK_SIGNING_SECRET is not set on the server.");
    const raw = await c.raw();
    if (!verifySlack(secret, String(c.req.headers["x-slack-request-timestamp"] || ""), raw, String(c.req.headers["x-slack-signature"] || ""))) throw new HttpError(401, "Bad request signature");
    const f = new URLSearchParams(raw);
    const reply = (text: string) => json(c.res, 200, { response_type: "ephemeral", text });
    const text = (f.get("text") || "").trim(), team = f.get("team_id") || "";
    const link = /^link\s+(\S+)/i.exec(text);
    if (link) return reply(await linkChat("slack", link[1], team, f.get("team_domain") || "Slack workspace"));
    const [conn] = await getBackend().db.select("connectors", { kind: "slack", external_id: team });
    if (!conn) return reply("This Slack workspace is not linked to Baton yet. In Baton open Workspace → Connectors, add a Slack connector, then run `/baton link <code>`.");
    const item = parseCommand(text);
    if (!item) return reply("Nothing to log. " + HELP);
    reply(confirm(await capture(conn, "slack", { ...item, author: f.get("user_name") || "Slack user" }, `slack:${f.get("trigger_id") || uuid()}`)));
  }),
  R("POST", `hooks/github/${ID}`, async (c) => {
    limit(c.req, "ghhook", 600);
    const { db } = getBackend();
    const [conn] = await db.select("connectors", { id: c.params[0], kind: "github" });
    if (!conn) throw new HttpError(404, "Unknown webhook.");
    const raw = await c.raw();
    if (!verifyGithub(conn.secret, raw, String(c.req.headers["x-hub-signature-256"] || ""))) throw new HttpError(401, "Bad webhook signature. Check the secret in the repository's webhook settings.");
    const event = String(c.req.headers["x-github-event"] || "");
    const delivery = String(c.req.headers["x-github-delivery"] || uuid());
    let payload: Row;
    try { payload = raw.startsWith("payload=") ? JSON.parse(new URLSearchParams(raw).get("payload") || "{}") : JSON.parse(raw); } catch { throw new HttpError(400, "Body is not valid JSON"); }
    if (event === "ping") {
      await db.update("connectors", { id: conn.id }, { linked_at: now(), external_id: payload.repository?.full_name || conn.external_id });
      return json(c.res, 200, { ok: true, pong: true });
    }
    if ((await db.select("capture_events", { connector_id: conn.id, ref: `gh:${delivery}:0` }, { columns: "id" })).length) return json(c.res, 200, { ok: true, captured: 0, duplicate: true });
    const items = fromGithub(event, payload);
    let n = 0;
    for (const item of items) await capture(conn, "github", item, `gh:${delivery}:${n++}`);
    if (!conn.linked_at) await db.update("connectors", { id: conn.id }, { linked_at: now(), external_id: payload.repository?.full_name || conn.external_id });
    json(c.res, 200, { ok: true, captured: n });
  }),
];

function connectorView(r: Row, origin: string) {
  const base = { id: r.id, kind: r.kind as CaptureSource, label: r.label || "", projectId: r.project_id || undefined, defaultAccess: r.default_access as AccessTag, linked: !!r.linked_at, externalId: r.external_id || undefined, createdBy: r.created_by_name, at: r.created_at };
  return r.kind === "github"
    ? { ...base, webhookUrl: `${origin}/api/hooks/github/${r.id}`, secret: r.secret as string }
    : { ...base, linkCode: r.secret as string, endpointUrl: `${origin}/api/hooks/${r.kind}` };
}
