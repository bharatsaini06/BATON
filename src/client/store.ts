// Local-first storage. Projects (work in progress, including raw sources) stay in this browser's
// IndexedDB; only approved handover packages are sent to the server when published.
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Project, SharePackage } from "../core/types";

const DB = "baton";
const VERSION = 1;
type StoreName = "projects" | "packages";

let dbPromise: Promise<IDBDatabase | null> | null = null;
function openDb(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB, VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects", { keyPath: "id" });
          if (!db.objectStoreNames.contains("packages")) db.createObjectStore("packages", { keyPath: "id" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

// memory fallback (private browsing modes without IndexedDB)
const mem: Record<StoreName, Map<string, unknown>> = { projects: new Map(), packages: new Map() };

async function all<T>(store: StoreName): Promise<T[]> {
  const db = await openDb();
  if (!db) return [...mem[store].values()] as T[];
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}
async function put(store: StoreName, value: { id: string }): Promise<void> {
  const db = await openDb();
  if (!db) { mem[store].set(value.id, value); return; }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function del(store: StoreName, id: string): Promise<void> {
  const db = await openDb();
  if (!db) { mem[store].delete(id); return; }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------------------------------------------------------- reactive cache

type State = { ready: boolean; projects: Map<string, Project>; packages: Map<string, SharePackage> };
let state: State = { ready: false, projects: new Map(), packages: new Map() };
const listeners = new Set<() => void>();
const emit = () => { state = { ...state }; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };

let loading: Promise<void> | null = null;
export function loadStore(): Promise<void> {
  if (!loading) {
    loading = (async () => {
      const [ps, pk] = await Promise.all([all<Project>("projects"), all<SharePackage>("packages")]);
      state.projects = new Map(ps.map((p) => [p.id, migrate(p)]));
      state.packages = new Map(pk.map((p) => [p.id, p]));
      state.ready = true;
      emit();
    })().catch(() => { state.ready = true; emit(); });
  }
  return loading;
}

function migrate(p: Project): Project {
  return { ...p, worklog: p.worklog || [], versions: p.versions || [], audit: p.audit || [], questions: p.questions || [], claims: p.claims || [] };
}

export function useStore(): State {
  useEffect(() => { void loadStore(); }, []);
  return useSyncExternalStore(subscribe, () => state);
}

export function getProject(id: string): Project | undefined {
  return state.projects.get(id);
}

/** Called after every local save; the workspace layer uses it to sync projects that belong to a workspace. */
let afterSave: ((p: Project) => void) | null = null;
export function onProjectSaved(fn: (p: Project) => void) { afterSave = fn; }

export async function saveProject(p: Project, opts: { sync?: boolean } = {}): Promise<Project> {
  const next = { ...p, updatedAt: new Date().toISOString() };
  state.projects = new Map(state.projects).set(next.id, next);
  emit();
  await put("projects", next);
  if (opts.sync !== false && next.orgId) afterSave?.(next);
  return next;
}

/** Functional update with an audit entry. */
export async function updateProject(id: string, fn: (p: Project) => Project, audit?: { actor: string; action: string; detail?: string }): Promise<Project | undefined> {
  const cur = state.projects.get(id);
  if (!cur) return undefined;
  let next = fn(cur);
  if (audit) next = { ...next, audit: [...next.audit, { at: new Date().toISOString(), ...audit }] };
  return saveProject(next);
}

export async function deleteProject(id: string) {
  const m = new Map(state.projects);
  m.delete(id);
  state.projects = m;
  emit();
  await del("projects", id);
}

export async function savePackage(pkg: SharePackage) {
  state.packages = new Map(state.packages).set(pkg.id, pkg);
  emit();
  await put("packages", pkg);
}

export async function forgetPackage(id: string) {
  const m = new Map(state.packages);
  m.delete(id);
  state.packages = m;
  emit();
  await del("packages", id);
}

export function getPackage(id: string): SharePackage | undefined {
  return state.packages.get(id);
}

export function packagesFor(projectId: string): SharePackage[] {
  return [...state.packages.values()].filter((p) => p.projectId === projectId).sort((a, b) => a.version - b.version);
}

/** Small per-browser preference (e.g. plan checkboxes). Never throws. */
export function usePref<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem("baton:" + key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = (nv: T) => {
    setV(nv);
    try { localStorage.setItem("baton:" + key, JSON.stringify(nv)); } catch { /* storage unavailable */ }
  };
  return [v, set];
}
