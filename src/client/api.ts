// Typed client for the Baton API.
import type { AccessTag, AskedQuestion, CaptureEvent, CaptureSource, Claim, GapQuestion, LogEntry, OrgRole, Person, Project, RunInfo, SharePackage, Source, SuccessorRole, SectionKey } from "../core/types";
import type { AskResult } from "../core/ask";
import { getSession, setSession, setMe, registerMeLoader, type Session, type OrgRef, type PendingInvite, type SessionUser } from "./session";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

type Init = { method?: string; body?: unknown; link?: string | null };

async function send(path: string, init: Init | undefined, token: string | undefined): Promise<Response> {
  const headers: Record<string, string> = {};
  if (init?.body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  if (init?.link) headers["x-baton-link"] = init.link;
  try {
    return await fetch(path, { method: init?.method || (init?.body !== undefined ? "POST" : "GET"), headers, body: init?.body !== undefined ? JSON.stringify(init.body) : undefined });
  } catch {
    throw new ApiError(0, "Cannot reach the Baton server. Check your connection and try again.");
  }
}

async function call<T>(path: string, init?: Init): Promise<T> {
  const session = getSession();
  let res = await send(path, init, session?.token);
  if (res.status === 401 && session && !/^\/api\/auth\/(login|signup|refresh)/.test(path)) {
    // the session token expired: renew it once, otherwise sign out
    let renewed: Session | null = null;
    if (session.refresh) {
      const r = await send("/api/auth/refresh", { body: { refresh: session.refresh } }, undefined).catch(() => null);
      if (r?.ok) renewed = ((await r.json()) as { session: Session }).session;
    }
    setSession(renewed);
    res = await send(path, init, renewed?.token);
  }
  const text = await res.text();
  let data: unknown = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const msg = (data as { error?: string }).error || (res.status === 413 ? "Upload is too large for the server. Split it into smaller files." : `Request failed (${res.status})`);
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export interface Health {
  ok: boolean;
  version: string;
  ai: { configured: boolean; provider?: string; providerLabel?: string; model?: string };
  storage: { mode: string; durable: boolean };
  github: { token: boolean };
  accounts?: { mode: "supabase" | "builtin"; rls: boolean; serviceKey: boolean };
  connectors?: { discord: boolean; discordAppId: string | null; discordCanRegister: boolean; slack: boolean };
}

export interface Member { userId: string; name: string; email: string; role: OrgRole; joinedAt: string }
export interface Invite { id: string; email: string; role: OrgRole; invitedBy?: string; at: string; url: string }
export interface ShareLink { id: string; label: string; createdBy?: string; at: string; expiresAt: string | null; revokedAt: string | null; opens: number; lastOpenedAt: string | null; url: string }
export interface Connector { id: string; kind: CaptureSource; label: string; projectId?: string; defaultAccess: AccessTag; linked: boolean; externalId?: string; createdBy?: string; at: string; webhookUrl?: string; secret?: string; linkCode?: string; endpointUrl?: string }
export interface PackageAccess { kind: "link" | "member" | "open"; linkId?: string; expiresAt?: string | null; role?: OrgRole }
export interface WorkspaceProject { id: string; title: string; updatedBy?: string; updatedAt: string }
export interface WorkspacePackage { id: string; projectId: string; version: number; role: SuccessorRole; title: string; publishedBy?: string; at: string }

export const api = {
  health: () => call<Health>("/api/health"),
  aiTest: () => call<{ ok: boolean; ms: number; message: string }>("/api/ai/test", { method: "POST", body: {} }),
  sample: () => call<{ project: Project }>("/api/sample"),
  upload: (b: { name: string; text?: string; pages?: string[]; sourceFormat?: "pdf" | "docx"; access: AccessTag; addedBy?: string }) =>
    call<{ source: Source }>("/api/ingest/upload", { body: b }),
  github: (b: { repo: string; access: AccessTag; addedBy?: string }) => call<{ source: Source }>("/api/ingest/github", { body: b }),
  worklog: (entries: LogEntry[], existingIds: Partial<Record<AccessTag, string>>) => call<{ sources: Source[] }>("/api/ingest/worklog", { body: { entries, existingIds } }),
  interview: (b: { leaver: string; successorRole: SuccessorRole; sources: Source[]; claims: Claim[]; questions: GapQuestion[]; answers: Record<string, string> }) =>
    call<{ sources: Source[]; claims: Claim[]; questions: GapQuestion[]; resolved: number; unknown: number }>("/api/interview", { body: b }),
  publish: (project: Project, approvedBy: string, previous?: SharePackage) =>
    call<{ package: SharePackage; stored: boolean; durable: boolean; storage: string }>("/api/publish", { body: { project, approvedBy, previous } }),
  share: (id: string, link?: string | null) => call<{ package: SharePackage; access: PackageAccess }>(`/api/share/${encodeURIComponent(id)}`, { link }),
  ack: (id: string, section: SectionKey, by: string, link?: string | null) => call<{ package: SharePackage }>(`/api/share/${encodeURIComponent(id)}/ack`, { body: { section, by }, link }),
  flag: (id: string, claimId: string, note: string, by: string, link?: string | null) => call<{ package: SharePackage }>(`/api/share/${encodeURIComponent(id)}/flag`, { body: { claimId, note, by }, link }),

  // ---- Round 3: Ask Baton
  ask: (b: { id: string; question: string; by?: string; package?: SharePackage }, link?: string | null) => call<{ answer: AskResult; questions?: AskedQuestion[] }>("/api/ask", { body: b, link }),

  // ---- Round 3: accounts and workspaces
  signup: (b: { email: string; password: string; name: string }) => call<{ session?: Session; needsConfirm?: boolean; message?: string }>("/api/auth/signup", { body: b }),
  login: (b: { email: string; password: string }) => call<{ session: Session }>("/api/auth/login", { body: b }),
  me: () => call<{ user: SessionUser; orgs: OrgRef[]; invites: PendingInvite[] }>("/api/auth/me"),
  createOrg: (name: string) => call<{ org: OrgRef }>("/api/orgs", { body: { name } }),
  org: (id: string) => call<{ org: OrgRef; members: Member[]; invites: Invite[] }>(`/api/orgs/${id}`),
  invite: (orgId: string, email: string, role: OrgRole) => call<{ invite: Invite }>(`/api/orgs/${orgId}/invites`, { body: { email, role } }),
  cancelInvite: (orgId: string, id: string) => call<{ ok: boolean }>(`/api/orgs/${orgId}/invites/${id}`, { method: "DELETE" }),
  inviteInfo: (token: string) => call<{ invite: { orgName: string; role: OrgRole; email: string; invitedBy?: string } }>(`/api/invites/${encodeURIComponent(token)}`),
  acceptInvite: (token: string) => call<{ org: OrgRef }>(`/api/invites/${encodeURIComponent(token)}/accept`, { body: {} }),
  setRole: (orgId: string, userId: string, role: OrgRole) => call<{ ok: boolean }>(`/api/orgs/${orgId}/members/${userId}`, { method: "PATCH", body: { role } }),
  removeMember: (orgId: string, userId: string) => call<{ ok: boolean }>(`/api/orgs/${orgId}/members/${userId}`, { method: "DELETE" }),

  // ---- Round 3: workspace projects, publishing and signed links
  wsProjects: (orgId: string) => call<{ projects: WorkspaceProject[] }>(`/api/orgs/${orgId}/projects`),
  wsProject: (id: string) => call<{ project: Project; updatedBy?: string; updatedAt: string }>(`/api/projects/${encodeURIComponent(id)}`),
  wsSaveProject: (orgId: string, project: Project) => call<{ ok: boolean; withheldPrivate: number }>(`/api/projects/${encodeURIComponent(project.id)}`, { method: "PUT", body: { orgId, project } }),
  wsDeleteProject: (id: string) => call<{ ok: boolean }>(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" }),
  wsPublish: (orgId: string, project: Project, previous?: SharePackage) => call<{ package: SharePackage; stored: boolean; durable: boolean; storage: string }>(`/api/orgs/${orgId}/publish`, { body: { project, previous } }),
  wsPackages: (orgId: string) => call<{ packages: WorkspacePackage[] }>(`/api/orgs/${orgId}/packages`),
  links: (pkgId: string) => call<{ links: ShareLink[] }>(`/api/packages/${encodeURIComponent(pkgId)}/links`),
  createLink: (pkgId: string, days: number | null, label?: string) => call<{ link: ShareLink }>(`/api/packages/${encodeURIComponent(pkgId)}/links`, { body: { days, label } }),
  revokeLink: (id: string) => call<{ ok: boolean }>(`/api/links/${id}/revoke`, { body: {} }),

  // ---- Round 3: live connectors and the capture inbox
  connectors: (orgId: string) => call<{ connectors: Connector[] }>(`/api/orgs/${orgId}/connectors`),
  addConnector: (orgId: string, b: { kind: CaptureSource; label?: string; projectId?: string; defaultAccess: AccessTag; repo?: string }) => call<{ connector: Connector }>(`/api/orgs/${orgId}/connectors`, { body: b }),
  removeConnector: (id: string) => call<{ ok: boolean }>(`/api/connectors/${id}`, { method: "DELETE" }),
  registerDiscord: () => call<{ ok: boolean; message: string }>("/api/connectors/discord/register", { body: {} }),
  capture: (orgId: string, q: { status?: string; project?: string } = {}) => call<{ events: CaptureEvent[] }>(`/api/orgs/${orgId}/capture?${new URLSearchParams(q as Record<string, string>).toString()}`),
  captureUpdate: (orgId: string, ids: string[], status: CaptureEvent["status"], projectId?: string) => call<{ updated: number }>(`/api/orgs/${orgId}/capture/update`, { body: { ids, status, projectId } }),
};

registerMeLoader(async () => { const r = await api.me(); setMe(r.orgs, r.invites); });

export interface GenerateInput {
  project: string; leaver: string; successor: string; successorRole: SuccessorRole; people: Person[]; sources: Source[]; engine: "auto" | "ai" | "rules";
}
export interface GenerateResult { claims: Claim[]; questions: GapQuestion[]; run: RunInfo }

/** Streams NDJSON progress events from /api/generate. */
export async function generate(input: GenerateInput, onProgress: (stage: string, message: string) => void): Promise<GenerateResult> {
  let res: Response;
  try {
    res = await fetch("/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  } catch {
    throw new ApiError(0, "Cannot reach the Baton server.");
  }
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => "");
    let msg = `Generation failed (${res.status})`;
    try { msg = JSON.parse(t).error || msg; } catch { /* keep default */ }
    throw new ApiError(res.status, msg);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let result: GenerateResult | null = null;
  const handle = (line: string) => {
    if (!line.trim()) return;
    const ev = JSON.parse(line);
    if (ev.type === "progress") onProgress(ev.stage, ev.message);
    else if (ev.type === "result") result = { claims: ev.claims, questions: ev.questions, run: ev.run };
    else if (ev.type === "error") throw new ApiError(500, ev.message);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      handle(buf.slice(0, i));
      buf = buf.slice(i + 1);
    }
    if (done) break;
  }
  if (buf.trim()) handle(buf);
  if (!result) throw new ApiError(500, "The server closed the connection before finishing. Please try again.");
  return result;
}
