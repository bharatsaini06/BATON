// Continuation plan, decision timeline, readiness score and the published package.
import type { Chunk, Claim, PlanItem, Project, SharePackage, TimelineItem, EvidenceStatus } from "./types";
import { chunkIndex, claimVisible, roleCanSee } from "./permissions";
import { uid, clip, formatDate, nowIso, tokens, findDates } from "./text";

export const isShared = (c: Claim) => c.review.decision === "approved" || c.review.decision === "edited";

export function buildPlan(claims: Claim[], leaver: string, successor: string): PlanItem[] {
  const items: PlanItem[] = [];
  const push = (horizon: PlanItem["horizon"], kind: PlanItem["kind"], title: string, why: string, ids: string[]) =>
    items.push({ id: uid("p"), horizon, kind, title: clip(title, 140), why, claimIds: ids });

  const access = claims.filter((c) => c.type === "dependency" && /\b(account|access|credential|admin|login|key|registered|owner)\b/i.test(c.statement));
  for (const c of access.slice(0, 2)) push("day1", "access", `Get access: ${c.statement}`, "Without access you cannot act on anything else.", [c.id]);

  const leaverOwned = claims.filter((c) => c.field === "owner" && c.value === leaver && !c.resolvedBy);
  for (const c of leaverOwned.slice(0, 3)) push("day1", "reassign", `Take over from ${leaver}: ${c.subject || c.statement}`, `${leaver} owns this today and is leaving.`, [c.id]);

  const conflicts = claims.filter((c) => c.status === "conflicting" && !c.resolvedBy);
  const seen = new Set<string>();
  for (const c of conflicts) {
    if (c.conflictGroup && seen.has(c.conflictGroup)) continue;
    if (c.conflictGroup) seen.add(c.conflictGroup);
    const group = conflicts.filter((x) => x.conflictGroup && x.conflictGroup === c.conflictGroup);
    push("day1", "resolve", `Resolve: sources disagree about ${c.subject || c.statement}`, "Unresolved conflict — confirm with the reviewer before acting.", group.map((g) => g.id));
  }

  for (const c of claims.filter((x) => x.status === "missing" && !x.resolvedBy).slice(0, 4))
    push("day1", "unknown", `Find out: ${c.statement.replace(/^No (owner|contact) found for /, "who is responsible for ")}`, "Nobody has written this down. Ask before it becomes urgent.", [c.id]);

  for (const c of claims.filter((x) => x.type === "recurring_problem").slice(0, 2))
    push("day1", "read", `Know this recurring problem: ${c.statement}`, "It has happened before — learn the workaround first.", [c.id]);

  const open = claims
    .filter((c) => (c.type === "open_task" || c.type === "next_action") && !c.resolvedBy && c.status !== "missing")
    .sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
  for (const c of open.slice(0, 6))
    push("week1", "task", `${c.type === "next_action" ? "Do" : "Continue"}: ${c.statement}${c.date && !findDates(c.statement).length ? ` (by ${formatDate(c.date)})` : ""}`, ownerHint(c, claims, successor), [c.id]);

  const risks = claims.filter((c) => c.type === "risk").sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
  for (const c of risks.slice(0, 3)) push("week1", "risk", `Watch: ${c.statement}`, c.date ? `Date at stake: ${formatDate(c.date)}.` : "Known risk — keep an eye on it.", [c.id]);

  const contacts = claims.filter((c) => c.type === "contact" && c.value);
  const met = new Set<string>();
  for (const c of contacts) {
    if (met.has(c.value!)) continue;
    met.add(c.value!);
    push("week1", "meet", `Meet ${c.value}: ${clip(c.statement, 90)}`, "Introduce yourself as the new owner.", [c.id]);
    if (met.size >= 3) break;
  }
  return items;
}

function ownerHint(task: Claim, claims: Claim[], successor: string): string {
  const tt = tokens(task.subject || task.statement);
  const owner = claims.find((o) => o.field === "owner" && o.value && (o.evidence.some((e) => task.evidence.some((x) => x.chunkId === e.chunkId)) || tokens(o.subject || "").some((t) => tt.includes(t))));
  if (owner?.value) return `Current owner: ${owner.value}. Agree whether ${successor} takes it over.`;
  return "No owner recorded — agree who takes it.";
}

export function buildTimeline(claims: Claim[], chunks: Map<string, Chunk>): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const c of claims) {
    if (c.type !== "decision" && !c.date) continue;
    const when = c.type === "decision" ? chunks.get(c.evidence[0]?.chunkId)?.time?.slice(0, 10) || c.date : c.date;
    if (!when) continue;
    items.push({ date: when, claimId: c.id, label: c.statement, status: c.status });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

export interface Readiness { score: number; verifiedShare: number; reviewedShare: number; unresolvedConflicts: number; openGaps: number; label: string }

export function readiness(claims: Claim[]): Readiness {
  const live = claims.filter((c) => !c.resolvedBy || c.status === "verified");
  if (!live.length) return { score: 0, verifiedShare: 0, reviewedShare: 0, unresolvedConflicts: 0, openGaps: 0, label: "Not started" };
  const withEvidence = live.filter((c) => c.status !== "missing");
  const verifiedShare = withEvidence.length ? withEvidence.filter((c) => c.status === "verified").length / withEvidence.length : 0;
  const reviewedShare = live.filter((c) => c.review.decision !== "pending").length / live.length;
  const unresolvedConflicts = new Set(live.filter((c) => c.status === "conflicting" && !c.resolvedBy).map((c) => c.conflictGroup)).size;
  const openGaps = live.filter((c) => c.status === "missing" && !c.resolvedBy).length;
  const score = Math.round(verifiedShare * 45 + reviewedShare * 35 + (unresolvedConflicts ? 0 : 10) + Math.max(0, 10 - openGaps * 2.5));
  const label = score >= 85 ? "Ready to hand over" : score >= 60 ? "Almost ready" : score >= 30 ? "Needs review" : "Early draft";
  return { score, verifiedShare, reviewedShare, unresolvedConflicts, openGaps, label };
}

export function statusCounts(claims: Claim[]): Record<EvidenceStatus, number> {
  const out: Record<EvidenceStatus, number> = { verified: 0, inferred: 0, conflicting: 0, missing: 0 };
  for (const c of claims) out[c.status]++;
  return out;
}

/**
 * Build the package the successor receives. Only approved/edited claims are included, and only if
 * every chunk they cite is visible to the successor's role. Only cited chunks travel with it.
 */
export function buildPackage(p: Project, approvedBy: string, previous?: SharePackage): SharePackage {
  const idx = chunkIndex(p.sources);
  const shared = p.claims.filter(isShared);
  const visibleClaims = shared.filter((c) => claimVisible(c, idx, p.successorRole));
  const cited = new Map<string, Chunk>();
  for (const c of visibleClaims) for (const e of c.evidence) { const ch = idx.get(e.chunkId); if (ch && roleCanSee(p.successorRole, ch.access)) cited.set(ch.id, ch); }
  const usedSources = new Set([...cited.values()].map((c) => c.sourceId));
  const version = (p.versions.at(-1)?.version || 0) + 1;
  const pkg: SharePackage = {
    id: `${p.id}-v${version}`,
    projectId: p.id,
    version,
    title: `${p.title} — handover to ${p.successor}`,
    project: p.title,
    leaver: p.leaver,
    successor: p.successor,
    role: p.successorRole,
    reviewer: p.reviewer,
    approvedBy,
    approvedAt: nowIso(),
    claims: visibleClaims,
    chunks: [...cited.values()],
    sources: p.sources.filter((s) => usedSources.has(s.id)).map(({ id, name, kind, format, access }) => ({ id, name, kind, format, access })),
    plan: buildPlan(visibleClaims, p.leaver, p.successor),
    timeline: buildTimeline(visibleClaims, idx),
    hiddenSources: p.sources.filter((s) => !roleCanSee(p.successorRole, s.access)).length,
    excluded: { rejected: p.claims.filter((c) => c.review.decision === "rejected").length, pending: p.claims.filter((c) => c.review.decision === "pending").length + (shared.length - visibleClaims.length) },
    engine: p.run ? (p.run.engine === "ai" ? `AI (${p.run.provider} · ${p.run.model})` : "Rules engine (offline)") : "—",
    acknowledgements: {},
    flags: [],
  };
  if (previous) {
    const prev = new Map(previous.claims.map((c) => [c.id, c]));
    const cur = new Map(pkg.claims.map((c) => [c.id, c]));
    pkg.changes = {
      fromVersion: previous.version,
      added: pkg.claims.filter((c) => !prev.has(c.id)).map((c) => c.id),
      removed: previous.claims.filter((c) => !cur.has(c.id)).map((c) => c.statement),
      edited: pkg.claims.filter((c) => prev.has(c.id) && prev.get(c.id)!.statement !== c.statement).map((c) => c.id),
    };
  }
  return pkg;
}

/** Plain-text export of a package (Markdown). */
export function packageMarkdown(pkg: SharePackage): string {
  const chunk = new Map(pkg.chunks.map((c) => [c.id, c]));
  const src = (c: Claim) => c.evidence.map((e) => chunk.get(e.chunkId)?.locator.label).filter(Boolean).join("; ") || "no source";
  const L: string[] = [];
  L.push(`# ${pkg.title}`, "", `Version ${pkg.version} · approved by ${pkg.approvedBy} on ${formatDate(pkg.approvedAt)} · role: ${pkg.role}`, "");
  const sec = (title: string, list: Claim[]) => {
    if (!list.length) return;
    L.push(`## ${title}`, "");
    for (const c of list) L.push(`- **[${c.status.toUpperCase()}]** ${c.statement}  _(source: ${src(c)})_`);
    L.push("");
  };
  sec("Owners & contacts", pkg.claims.filter((c) => c.type === "owner" || c.type === "contact"));
  sec("Open work", pkg.claims.filter((c) => c.type === "open_task" || c.type === "next_action"));
  sec("Risks, dependencies & recurring problems", pkg.claims.filter((c) => ["risk", "dependency", "recurring_problem"].includes(c.type)));
  sec("Decisions", pkg.claims.filter((c) => c.type === "decision"));
  L.push("## Day 1 / Week 1 plan", "");
  for (const i of pkg.plan) L.push(`- [ ] (${i.horizon === "day1" ? "Day 1" : "Week 1"}) ${i.title} — ${i.why}`);
  return L.join("\n");
}
