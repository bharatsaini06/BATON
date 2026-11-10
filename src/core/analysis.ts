// Conflict detection, coverage (missing information) and Gap Interview questions.
import type { Chunk, Claim, ClaimType, GapQuestion } from "./types";
import { tokens, jaccard, uid, nowIso, clip, formatDate, normalizeLoose, capitalize } from "./text";

// ---------------------------------------------------------------- conflicts

function sameSubject(a: Claim, b: Claim): boolean {
  const ta = tokens(a.subject || a.statement), tb = tokens(b.subject || b.statement);
  const shared = ta.filter((t) => tb.includes(t)).length;
  return jaccard(ta, tb) >= 0.5 || (shared >= 2 && jaccard(ta, tb) >= 0.3);
}

function normValue(c: Claim): string {
  return normalizeLoose(c.value || "");
}

/**
 * Two claims conflict when they talk about the same subject and field (owner or date) but assert
 * different values, and come from different chunks. Both are kept and marked; a human decides.
 */
export function detectConflicts(claims: Claim[], chunkIndex: Map<string, Chunk>): Claim[] {
  const candidates = claims.filter((c) => (c.field === "owner" || c.field === "date") && c.value && c.evidence.length);
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i], b = candidates[j];
      if (a.field !== b.field) continue;
      if (a.field === "date" && a.type !== b.type) continue; // a task due date is not the event date
      if (normValue(a) === normValue(b)) continue;
      if (a.evidence.some((e) => b.evidence.some((x) => x.chunkId === e.chunkId))) continue;
      if (!sameSubject(a, b)) continue;
      const group = a.conflictGroup || b.conflictGroup || uid("g");
      for (const [x, other] of [[a, b], [b, a]] as const) {
        x.conflictGroup = group;
        x.status = "conflicting";
        const loc = chunkIndex.get(other.evidence[0].chunkId)?.locator.label || "another source";
        const val = x.field === "date" ? formatDate(other.value) : other.value;
        x.statusReason = `Disagrees with ${loc}, which says ${val}`;
      }
    }
  }
  return claims;
}

// ---------------------------------------------------------------- coverage (missing information)

const ASSETS: { key: string; label: string; re: RegExp }[] = [
  { key: "domain", label: "the domain name (renewal and DNS)", re: /\b(domain|dns|godaddy|namecheap)\b/i },
  { key: "hosting", label: "hosting / deployment", re: /\b(hosting|deploy(?:ment|ed)?|vercel|netlify|render|heroku|server|aws|gcp)\b/i },
  { key: "database", label: "the database", re: /\b(database|firebase|firestore|supabase|mongo(?:db)?|postgres|mysql)\b/i },
  { key: "payments", label: "the payment gateway account", re: /\b(razorpay|stripe|payment gateway|paypal|paytm)\b/i },
  { key: "social", label: "social media accounts", re: /\b(instagram|linkedin page|twitter|social media)\b/i },
  { key: "funds", label: "the budget and reimbursements", re: /\b(budget|funds|reimburse\w*|treasurer|invoice)\b/i },
];

function mentionsPerson(c: Claim): boolean {
  return (c.people?.length || 0) > 0 || c.field === "owner" || c.field === "contact";
}

function missing(type: ClaimType, statement: string, reason: string, subject?: string, field?: Claim["field"]): Claim {
  return {
    id: uid("k"),
    type,
    statement,
    subject,
    field,
    basis: "inferred",
    evidence: [],
    status: "missing",
    statusReason: reason,
    engine: "coverage",
    review: { decision: "pending" },
    createdAt: nowIso(),
  };
}

export function coverage(claims: Claim[], visible: Chunk[]): Claim[] {
  const out: Claim[] = [];
  const owners = claims.filter((c) => c.type === "owner" || c.field === "owner");
  const contacts = claims.filter((c) => c.type === "contact" || c.type === "owner" || mentionsPerson(c));

  // 1. open work with no owner
  for (const t of claims.filter((c) => c.type === "open_task")) {
    if (t.people?.length) continue;
    const tt = tokens(t.subject || t.statement);
    const owned = owners.some((o) => o.evidence.some((e) => t.evidence.some((x) => x.chunkId === e.chunkId)) || jaccard(tokens(o.subject || o.statement), tt) >= 0.3);
    const dupGap = out.some((g) => jaccard(tokens(g.subject || ""), tt) >= 0.3);
    if (!owned && !dupGap) out.push(missing("owner", `No owner found for open work: "${clip((t.subject || t.statement).replace(/[.!]+$/, ""), 70)}"`, "Checklist: every open task needs an owner. No source names one.", t.subject || t.statement, "owner"));
    if (out.length >= 5) break;
  }

  // 2. dependencies with no contact
  let deps = 0;
  for (const d of claims.filter((c) => c.type === "dependency")) {
    if (d.people?.length) continue;
    const dt = tokens(d.statement);
    const covered = contacts.some((c) => c !== d && jaccard(tokens(c.statement), dt) >= 0.25);
    if (!covered) {
      out.push(missing("contact", `No contact found for dependency: "${clip(d.statement.replace(/[.!]+$/, ""), 70)}"`, "Checklist: every external dependency needs a person to contact.", d.subject || d.statement, "contact"));
      if (++deps >= 3) break;
    }
  }

  // 3. assets mentioned in sources but nobody named as responsible
  const corpus = visible.map((c) => c.text).join("\n");
  let assets = 0;
  for (const a of ASSETS) {
    if (!a.re.test(corpus)) continue;
    const covered = claims.some((c) => a.re.test(c.statement + " " + (c.subject || "")) && mentionsPerson(c) && c.status !== "missing");
    if (!covered) {
      out.push(missing("owner", `Who owns ${a.label}?`, `Sources mention ${a.key}, but no source says who is responsible for it.`, a.label, "owner"));
      if (++assets >= 4) break;
    }
  }

  // 4. access transfer
  const access = /\b(access|admin|credential|password|permission|collaborator|owner rights|login)\b/i;
  if (!claims.some((c) => access.test(c.statement) && c.status !== "missing"))
    out.push(missing("next_action", "How will admin access (repository, hosting, accounts) be transferred to the successor?", "No source describes how access is handed over.", "admin access transfer"));

  // 5. empty categories
  if (!claims.some((c) => c.type === "decision"))
    out.push(missing("decision", "No recorded decisions were found. What are the most important decisions taken, and why?", "No decision was found in any visible source.", "key decisions"));
  if (!claims.some((c) => c.type === "open_task" || c.type === "next_action"))
    out.push(missing("open_task", "No open work was found. Is anything unfinished?", "No open task or next step was found in any visible source.", "open work"));
  return out;
}

// ---------------------------------------------------------------- Gap Interview questions

export function buildQuestions(claims: Claim[], chunkIndex: Map<string, Chunk>): GapQuestion[] {
  const qs: GapQuestion[] = [];
  const groups = new Map<string, Claim[]>();
  for (const c of claims) if (c.status === "conflicting" && c.conflictGroup && !c.resolvedBy) (groups.get(c.conflictGroup) || groups.set(c.conflictGroup, []).get(c.conflictGroup)!).push(c);
  for (const [, list] of groups) {
    const field = list[0].field;
    const subject = list.map((c) => c.subject || c.statement).sort((x, y) => x.length - y.length)[0];
    const options = [...new Set(list.map((c) => (field === "date" ? formatDate(c.value) : c.value || "")))].filter(Boolean);
    const context = list
      .map((c) => `${chunkIndex.get(c.evidence[0]?.chunkId)?.locator.label || "source"}: "${clip(c.evidence[0]?.quote || c.statement, 90)}"`)
      .join("\n");
    qs.push({
      id: uid("q"),
      kind: "conflict",
      claimIds: list.map((c) => c.id),
      question: field === "date" ? `Sources give different dates for ${clip(subject, 60)}. Which is correct?` : `Sources name different owners for ${clip(subject, 60)}. Who owns it now?`,
      context,
      options: [...options, "Neither / something else"],
    });
  }
  for (const c of claims.filter((x) => x.status === "missing" && !x.resolvedBy)) {
    qs.push({ id: uid("q"), kind: "missing", claimIds: [c.id], question: c.statement.replace(/^No (owner|contact) found for ([^:]+): (.+)$/, (_m, what, kind, s) => (what === "owner" ? `Who owns this ${kind}: ${s}?` : `Who is the contact for this ${kind}: ${s}?`)), context: c.statusReason });
  }
  const inferred = claims
    .filter((c) => c.status === "inferred" && c.evidence.length && !c.resolvedBy)
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
    .slice(0, 5);
  for (const c of inferred) {
    qs.push({
      id: uid("q"),
      kind: "inferred",
      claimIds: [c.id],
      question: `Is this correct? "${clip(c.statement, 140)}"`,
      context: c.statusReason,
      options: ["Yes, correct", "No, not true", "Partly — let me correct it"],
    });
  }
  return qs;
}

export function capitalizeFirst(s: string) { return capitalize(s); }
