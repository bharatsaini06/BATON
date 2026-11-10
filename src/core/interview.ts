// Gap Interview: the leaver answers targeted questions about missing, conflicting and uncertain
// claims. Each answer becomes a dated "leaver testimony" chunk, so it is cited like any other source.
import type { Claim, GapQuestion, Project, Source } from "./types";
import { buildSource } from "./parsers";
import { uid, nowIso, findDates, formatDate, clip, capitalize } from "./text";

const UNKNOWN = /^(i don'?t know|dont know|not sure|unknown|no idea|n\/a|na|-)\.?$/i;

export interface InterviewResult { sources: Source[]; claims: Claim[]; questions: GapQuestion[]; resolved: number; unknown: number }

export function applyInterview(p: Pick<Project, "sources" | "claims" | "questions" | "leaver" | "successorRole">, answers: Record<string, string>): InterviewResult {
  const at = nowIso();
  const questions = p.questions.map((q) => (answers[q.id] !== undefined ? { ...q, answer: answers[q.id].trim(), answeredAt: at } : q));
  const answered = questions.filter((q) => q.answer && answers[q.id] !== undefined && !UNKNOWN.test(q.answer));
  const unknownQs = questions.filter((q) => q.answer && answers[q.id] !== undefined && UNKNOWN.test(q.answer));

  // one testimony source per interview round
  const testimonyId = uid("s");
  const testimony = buildSource(
    { name: `Leaver testimony · ${p.leaver} · ${formatDate(at)}`, kind: "testimony", format: "testimony", access: p.successorRole === "lead" ? "lead" : "member", addedBy: p.leaver },
    answered.map((q) => ({
      text: q.answer!,
      author: p.leaver,
      time: at,
      locator: { label: `Gap Interview · ${p.leaver} · ${formatDate(at)}`, question: q.question },
      meta: { questionId: q.id },
    })),
    testimonyId,
  );
  const chunkFor = new Map(testimony.chunks.map((c) => [String(c.meta?.questionId), c]));

  const claims = p.claims.map((c) => ({ ...c, review: { ...c.review }, evidence: [...c.evidence] }));
  const byId = new Map(claims.map((c) => [c.id, c]));
  let resolved = 0;

  for (const q of answered) {
    const chunk = chunkFor.get(q.id)!;
    const ev = { chunkId: chunk.id, sourceId: testimonyId, quote: chunk.text, match: "exact" as const };
    const targets = q.claimIds.map((id) => byId.get(id)).filter(Boolean) as Claim[];
    if (!targets.length) continue;
    const first = targets[0];

    if (q.kind === "inferred") {
      if (/^yes/i.test(q.answer!)) {
        first.evidence.push(ev);
        first.status = "verified";
        first.basis = "stated";
        first.statusReason = `Confirmed by ${p.leaver} in the Gap Interview`;
        first.resolvedBy = chunk.id;
        resolved++;
        continue;
      }
      if (/^no\b/i.test(q.answer!)) {
        first.review = { decision: "rejected", by: p.leaver, at, note: `${p.leaver} said this is not true in the Gap Interview` };
        first.resolvedBy = chunk.id;
        resolved++;
        continue;
      }
    }

    // conflict, missing, or a correction: create a new claim backed by testimony
    let statement: string;
    let value: string | undefined;
    let date: string | undefined;
    if (q.kind === "conflict") {
      const subject = first.subject || first.statement;
      date = first.field === "date" ? findDates(q.answer!, first.value ? +first.value.slice(0, 4) : new Date().getFullYear())[0]?.iso : undefined;
      value = first.field === "date" ? date || q.answer : q.answer;
      statement = `${capitalize(clip(subject, 80))}: ${first.field === "date" && date ? formatDate(date) : q.answer} (confirmed by ${p.leaver})`;
    } else if (q.kind === "missing") {
      statement = first.field === "owner" || first.field === "contact"
        ? `${capitalize(clip(first.subject || "This item", 80))} — ${first.field === "owner" ? "owner" : "contact"}: ${q.answer}`
        : `${clip(first.statement.replace(/\?$/, ""), 100)}: ${q.answer}`;
      value = first.field === "owner" || first.field === "contact" ? q.answer : undefined;
    } else {
      statement = q.answer!;
    }
    const fresh: Claim = {
      id: uid("k"),
      type: first.type,
      statement,
      subject: first.subject,
      field: first.field,
      value,
      basis: "stated",
      evidence: [ev],
      status: "verified",
      statusReason: `Answered by ${p.leaver} in the Gap Interview (leaver testimony)`,
      engine: "testimony",
      confidence: 0.95,
      date,
      people: [p.leaver],
      review: { decision: "pending" },
      createdAt: at,
    };
    claims.push(fresh);
    for (const t of targets) {
      t.resolvedBy = fresh.id;
      t.review = { decision: "rejected", by: p.leaver, at, note: q.kind === "missing" ? "Answered in the Gap Interview" : "Superseded by the leaver's answer in the Gap Interview" };
    }
    resolved++;
  }

  for (const q of unknownQs) {
    for (const id of q.claimIds) {
      const c = byId.get(id);
      if (c && c.status === "missing") c.statusReason = `${p.leaver} confirmed this is unknown — the successor must find out`;
    }
  }

  const sources = p.sources.filter((s) => s.kind !== "testimony" || s.chunks.length);
  if (testimony.chunks.length) sources.push(testimony);
  return { sources, claims, questions, resolved, unknown: unknownQs.length };
}
