// The verifier. Turns proposed candidates into claims with an evidence status that is decided by
// code, never by the model:
//   verified  = basis "stated" AND the quote is found in a chunk the successor may see AND the
//               statement does not go beyond that chunk (no unseen people, enough word overlap)
//   inferred  = anything else that still has some evidence
import type { Candidate } from "./extract-rules";
import type { Chunk, Claim, Engine, Evidence } from "./types";
import { normalizeForMatch, normalizeLoose, tokens, uid, nowIso, jaccard } from "./text";
import type { PeopleIndex } from "./people";

export interface QuoteMatch { match: Evidence["match"]; chunk?: Chunk }

export function findQuote(quote: string, chunk: Chunk): Evidence["match"] {
  const q = quote.trim();
  if (q.length < 8) return "none";
  if (chunk.text.includes(q)) return "exact";
  const nq = normalizeForMatch(q), nt = normalizeForMatch(chunk.text);
  if (nt.includes(nq)) return "normalized";
  // tolerate ellipses inside quotes: every fragment must appear, in order
  if (/\.\.\.|…/.test(q)) {
    const frags = nq.split(/\.\.\.|…/).map((f) => f.trim()).filter((f) => f.length >= 4);
    let pos = 0;
    let ok = frags.length > 0;
    for (const f of frags) {
      const i = nt.indexOf(f, pos);
      if (i < 0) { ok = false; break; }
      pos = i + f.length;
    }
    if (ok) return "normalized";
  }
  const lq = normalizeLoose(q), lt = normalizeLoose(chunk.text);
  if (lq.length >= 8 && lt.includes(lq)) return "normalized";
  return "none";
}

/** Look for the quote in the cited chunk, then (if the id is wrong) in any visible chunk. */
export function locateQuote(quote: string, chunkId: string, visible: Map<string, Chunk>): QuoteMatch {
  const cited = visible.get(chunkId);
  if (cited) {
    const m = findQuote(quote, cited);
    if (m !== "none") return { match: m, chunk: cited };
  }
  for (const c of visible.values()) {
    const m = findQuote(quote, c);
    if (m !== "none") return { match: m, chunk: c };
  }
  return { match: "none", chunk: cited };
}

/** Does the statement stay within what the evidence chunk actually says? */
export function statementSupported(statement: string, chunk: Chunk, people: PeopleIndex): { ok: boolean; reason?: string } {
  const named = people.mentions(statement);
  const inChunk = new Set([...people.mentions(chunk.text), ...(chunk.author ? [people.resolve(chunk.author) || chunk.author] : [])]);
  const stranger = named.find((n) => !inChunk.has(n));
  if (stranger) return { ok: false, reason: `Names ${stranger}, who does not appear in the cited source` };
  const st = tokens(statement);
  if (st.length >= 4) {
    const ct = new Set(tokens(chunk.text + " " + (chunk.author || "")));
    const covered = st.filter((t) => ct.has(t) || [...ct].some((c) => c.length > 4 && (c.startsWith(t.slice(0, 5)) || t.startsWith(c.slice(0, 5))))).length;
    if (covered / st.length < 0.34) return { ok: false, reason: "Statement goes beyond the words in the cited source" };
  }
  return { ok: true };
}

export function toClaim(c: Candidate, visible: Map<string, Chunk>, people: PeopleIndex, engine: Engine): Claim {
  const loc = locateQuote(c.quote, c.chunkId, visible);
  const evidence: Evidence[] = [];
  let status: Claim["status"] = "inferred";
  let statusReason = "";
  if (loc.match !== "none" && loc.chunk) {
    evidence.push({ chunkId: loc.chunk.id, sourceId: loc.chunk.sourceId, quote: c.quote, match: loc.match });
    const support = statementSupported(c.statement, loc.chunk, people);
    if (c.basis === "inferred") statusReason = "Marked as an interpretation, not stated directly in the source";
    else if (!support.ok) statusReason = support.reason!;
    else {
      status = "verified";
      statusReason = loc.match === "exact" ? `Exact quote found in ${loc.chunk.locator.label}` : `Quote found in ${loc.chunk.locator.label} (after normalising spacing/punctuation)`;
      if (loc.chunk.id !== c.chunkId && engine === "ai") statusReason += " — model cited a different chunk id; corrected";
    }
  } else {
    statusReason = visible.has(c.chunkId)
      ? "Quoted words were not found in the cited source"
      : "Cited source is not visible to this role or does not exist";
  }
  return {
    id: uid("k"),
    type: c.type,
    statement: c.statement,
    subject: c.subject,
    field: c.field,
    value: c.value,
    basis: c.basis,
    evidence,
    status,
    statusReason,
    engine,
    confidence: c.confidence,
    date: c.date,
    people: c.people,
    review: { decision: "pending" },
    createdAt: nowIso(),
  };
}

/** Merge near-duplicate claims (same type, same meaning) and pool their evidence. */
export function mergeDuplicates(claims: Claim[]): Claim[] {
  const out: Claim[] = [];
  for (const c of claims) {
    const ct = tokens(c.statement);
    const dup = out.find(
      (o) =>
        o.type === c.type &&
        (o.evidence.some((e) => c.evidence.some((x) => x.chunkId === e.chunkId && normalizeLoose(x.quote) === normalizeLoose(e.quote))) ||
          jaccard(tokens(o.statement), ct) >= 0.72) &&
        (o.field !== "owner" || o.value === c.value) &&
        (o.field !== "date" || o.value === c.value),
    );
    if (!dup) { out.push(c); continue; }
    for (const e of c.evidence) if (!dup.evidence.some((x) => x.chunkId === e.chunkId)) dup.evidence.push(e);
    if (c.status === "verified" && dup.status !== "verified") {
      dup.status = "verified";
      dup.statusReason = c.statusReason;
      dup.basis = "stated";
    }
    dup.confidence = Math.max(dup.confidence || 0, c.confidence || 0);
    if (!dup.date && c.date) dup.date = c.date;
  }
  return out;
}

/** Keep the most useful claims per type so the reviewer is not flooded. */
export function capPerType(claims: Claim[], max = 14): Claim[] {
  const byType = new Map<string, Claim[]>();
  for (const c of claims) (byType.get(c.type) || byType.set(c.type, []).get(c.type)!).push(c);
  const keep = new Set<Claim>();
  for (const list of byType.values()) {
    list
      .sort((a, b) => rank(b) - rank(a))
      .slice(0, max)
      .forEach((c) => keep.add(c));
  }
  return claims.filter((c) => keep.has(c));
}

function rank(c: Claim): number {
  return (c.status === "verified" ? 1 : 0) + (c.confidence || 0) + Math.min(c.evidence.length, 3) * 0.1;
}
