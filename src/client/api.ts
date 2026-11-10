// Typed client for the Baton API.
import type { AccessTag, Claim, GapQuestion, LogEntry, Person, Project, RunInfo, SharePackage, Source, SuccessorRole, SectionKey } from "../core/types";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init?.method || (init?.body ? "POST" : "GET"),
      headers: init?.body ? { "content-type": "application/json" } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Cannot reach the Baton server. Check your connection and try again.");
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
}

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
  share: (id: string) => call<{ package: SharePackage }>(`/api/share/${encodeURIComponent(id)}`),
  ack: (id: string, section: SectionKey, by: string) => call<{ package: SharePackage }>(`/api/share/${encodeURIComponent(id)}/ack`, { body: { section, by } }),
  flag: (id: string, claimId: string, note: string, by: string) => call<{ package: SharePackage }>(`/api/share/${encodeURIComponent(id)}/flag`, { body: { claimId, note, by } }),
};

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
