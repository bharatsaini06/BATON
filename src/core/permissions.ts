// The permission gate. Every path that reads chunks for a successor goes through here:
// AI extraction, verification, publishing and the successor view.
import type { AccessTag, Chunk, Claim, Project, Source, SuccessorRole } from "./types";

/** Can a successor with `role` see content tagged `tag`? Private content is never visible to a successor. */
export function roleCanSee(role: SuccessorRole, tag: AccessTag): boolean {
  if (tag === "private") return false;
  if (tag === "lead") return role === "lead";
  return true;
}

export interface GateResult {
  visible: Chunk[];
  hiddenChunks: number;
  hiddenSources: Source[];
}

export function gate(sources: Source[], role: SuccessorRole): GateResult {
  const visible: Chunk[] = [];
  let hiddenChunks = 0;
  const hiddenSources: Source[] = [];
  for (const s of sources) {
    let anyHidden = false;
    for (const c of s.chunks) {
      // a chunk can never be more visible than its source
      const tag = strictest(s.access, c.access);
      if (roleCanSee(role, tag)) visible.push({ ...c, access: tag });
      else { hiddenChunks++; anyHidden = true; }
    }
    if (anyHidden && !s.chunks.some((c) => roleCanSee(role, strictest(s.access, c.access)))) hiddenSources.push(s);
  }
  return { visible, hiddenChunks, hiddenSources };
}

const RANK: Record<AccessTag, number> = { member: 0, lead: 1, private: 2 };
export function strictest(a: AccessTag, b: AccessTag): AccessTag {
  return RANK[a] >= RANK[b] ? a : b;
}

/** A claim may be shown to a role only if every piece of evidence it cites is visible to that role. */
export function claimVisible(claim: Claim, chunkIndex: Map<string, Chunk>, role: SuccessorRole): boolean {
  return claim.evidence.every((e) => {
    const c = chunkIndex.get(e.chunkId);
    return !!c && roleCanSee(role, c.access);
  });
}

export function chunkIndex(sources: Source[]): Map<string, Chunk> {
  const m = new Map<string, Chunk>();
  for (const s of sources) for (const c of s.chunks) m.set(c.id, { ...c, access: strictest(s.access, c.access) });
  return m;
}

export function hiddenSourceCount(project: Project): number {
  return project.sources.filter((s) => !roleCanSee(project.successorRole, s.access)).length;
}

/** Changes whenever sources, their access tags, or the successor role change. Used to flag stale results. */
export function sourcesFingerprint(project: Pick<Project, "sources" | "successorRole" | "people">): string {
  return [
    project.successorRole,
    project.people.map((p) => p.name + ":" + p.aliases.join(",")).join("|"),
    ...project.sources.filter((s) => s.kind !== "testimony").map((s) => `${s.id}:${s.access}:${s.chunks.length}:${s.stats.chars}`),
  ].join(";");
}
