// Signed-in session (Round 3). The token lives in this browser; the server checks it on every call.
import { useEffect, useSyncExternalStore } from "react";
import type { OrgRole } from "../core/types";

export interface SessionUser { id: string; email: string; name: string }
export interface Session { token: string; refresh?: string; expiresAt: number; user: SessionUser }
export interface OrgRef { id: string; name: string; role: OrgRole }
export interface PendingInvite { token: string; orgName: string; role: OrgRole; invitedBy?: string }
interface State { session: Session | null; orgs: OrgRef[]; invites: PendingInvite[]; orgId: string | null; loaded: boolean }

const KEY = "baton:session", ORG_KEY = "baton:org";
function read(): Session | null {
  try { const s = JSON.parse(localStorage.getItem(KEY) || "null") as Session | null; return s && s.token && s.user ? s : null; } catch { return null; }
}
let state: State = { session: read(), orgs: [], invites: [], orgId: (() => { try { return localStorage.getItem(ORG_KEY); } catch { return null; } })(), loaded: false };
const listeners = new Set<() => void>();
const emit = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };

export const getSession = () => state.session;
export function setSession(s: Session | null) {
  try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch { /* storage unavailable: session lasts for this tab */ }
  emit(s ? { session: s } : { session: null, orgs: [], invites: [], loaded: false });
}
export function setOrg(id: string) {
  try { localStorage.setItem(ORG_KEY, id); } catch { /* ignore */ }
  emit({ orgId: id });
}
export function setMe(orgs: OrgRef[], invites: PendingInvite[]) {
  const orgId = orgs.some((o) => o.id === state.orgId) ? state.orgId : orgs[0]?.id || null;
  emit({ orgs, invites, orgId, loaded: true });
}

let loader: (() => Promise<void>) | null = null;
/** api.ts registers how to load /auth/me (avoids a circular import). */
export function registerMeLoader(fn: () => Promise<void>) { loader = fn; }
export const refreshMe = () => (state.session && loader ? loader().catch(() => {}) : Promise.resolve());

export function useSession() {
  const s = useSyncExternalStore(subscribe, () => state);
  useEffect(() => { if (s.session && !s.loaded) void refreshMe(); }, [s.session, s.loaded]);
  const org = s.orgs.find((o) => o.id === s.orgId) || null;
  return { ...s, user: s.session?.user || null, org, canEdit: !!org && org.role !== "member" };
}
export const currentOrg = () => state.orgs.find((o) => o.id === state.orgId) || null;
