// Workspace sync (Round 3). A project that belongs to a workspace is saved to the server after each
// local change. Private sources and Private work-log entries are removed before upload — they stay
// only in the author's browser (the server strips them again as a second check).
import { useSyncExternalStore } from "react";
import type { Project } from "../core/types";
import { api } from "./api";
import { getSession } from "./session";
import { getProject, onProjectSaved, saveProject } from "./store";

export type SyncState = { status: "idle" | "saving" | "saved" | "error"; message?: string; at?: string };
let states: Record<string, SyncState> = {};
const listeners = new Set<() => void>();
const set = (id: string, s: SyncState) => { states = { ...states, [id]: s }; listeners.forEach((l) => l()); };
export function useSync(id: string): SyncState {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => states[id] || IDLE);
}
const IDLE: SyncState = { status: "idle" };

export const withoutPrivate = (p: Project): Project => ({ ...p, sources: p.sources.filter((s) => s.access !== "private"), worklog: p.worklog.filter((w) => w.access !== "private") });

const timers = new Map<string, ReturnType<typeof setTimeout>>();
async function push(p: Project) {
  if (!p.orgId || !getSession()) return;
  set(p.id, { status: "saving" });
  try {
    await api.wsSaveProject(p.orgId, withoutPrivate(p));
    set(p.id, { status: "saved", at: new Date().toISOString() });
  } catch (e) {
    set(p.id, { status: "error", message: (e as Error).message });
  }
}
onProjectSaved((p) => {
  clearTimeout(timers.get(p.id));
  timers.set(p.id, setTimeout(() => { const cur = getProject(p.id); if (cur) void push(cur); }, 1200));
});

/** Attach a local project to a workspace and upload it now. */
export async function attachToWorkspace(p: Project, orgId: string): Promise<void> {
  const next = await saveProject({ ...p, orgId, audit: [...p.audit, { at: new Date().toISOString(), actor: getSession()?.user.name || "You", action: "Saved to workspace", detail: "Private sources stay in this browser" }] }, { sync: false });
  await api.wsSaveProject(orgId, withoutPrivate(next));
  set(p.id, { status: "saved", at: new Date().toISOString() });
}

/** Open a workspace project on this device. Private material that only exists locally is kept. */
export async function openFromWorkspace(id: string): Promise<Project> {
  const local = getProject(id);
  const remote = await api.wsProject(id);
  if (local && local.updatedAt >= remote.project.updatedAt) return local;
  const merged: Project = {
    ...remote.project,
    worklog: [...(remote.project.worklog || []), ...(local?.worklog.filter((w) => w.access === "private") || [])],
    sources: [...remote.project.sources, ...(local?.sources.filter((s) => s.access === "private") || [])],
    versions: remote.project.versions || [], audit: remote.project.audit || [], questions: remote.project.questions || [], claims: remote.project.claims || [],
  };
  return saveProject(merged, { sync: false });
}
