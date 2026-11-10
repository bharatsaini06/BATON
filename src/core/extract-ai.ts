// AI extraction layer. Provider-agnostic: it builds the prompt, calls `callModel`, and validates
// the JSON reply. The model only *proposes* claims; status is decided later by the verifier.
import { z } from "zod";
import type { Chunk } from "./types";
import type { Candidate } from "./extract-rules";
import type { PeopleIndex } from "./people";

export type CallModel = (system: string, user: string) => Promise<string>;

export const CLAIM_TYPES = ["decision", "owner", "open_task", "deadline", "risk", "dependency", "contact", "recurring_problem", "next_action"] as const;

const ClaimSchema = z.object({
  type: z.enum(CLAIM_TYPES),
  statement: z.string().min(4).max(400),
  subject: z.string().max(160).optional().nullable(),
  field: z.enum(["owner", "date", "choice", "status", "contact", "other"]).optional().nullable(),
  value: z.string().max(160).optional().nullable(),
  basis: z.enum(["stated", "inferred"]).optional().default("stated"),
  quote: z.string().min(1).max(600),
  chunk_id: z.string().min(1),
  confidence: z.number().min(0).max(1).optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});
const ReplySchema = z.object({ claims: z.array(z.unknown()) });

export const SYSTEM_PROMPT = `You are the extraction engine of Baton, a knowledge-handover tool.
You read authorised project sources and extract what an incoming team member must know, as small, checkable claims.

STRICT RULES
1. Use ONLY the chunks provided. Never use outside knowledge. Never invent names, dates, numbers or facts.
2. Every claim must include "quote": words copied EXACTLY, character for character, from ONE chunk (8-200 characters), and "chunk_id": the id of that chunk in square brackets, e.g. "s2:c14".
3. If the claim is your interpretation, combines several chunks, or is not stated directly, set "basis": "inferred". Otherwise "stated".
4. Never output secrets, passwords, keys, phone numbers or email addresses, even if present.
5. Statements: plain English, present tense, under 25 words, specific (who / what / when).

CLAIM TYPES
- decision: a choice the team made, with the reason if given ("Payments use Razorpay instead of Stripe because of UPI support").
- owner: who is responsible for a component, task or asset. field "owner", value = the person's name.
- open_task: unfinished work, open issues, pending items.
- deadline: a dated milestone or due date (demo day, submission, registration close). field "date".
- risk: something that could go wrong, deadlines at stake, expiring accounts, quotas, single points of failure.
- dependency: an external account, vendor, sponsor, system or person the work relies on.
- contact: who to go to for what. field "contact", value = the person's name.
- recurring_problem: a problem that has happened more than once, and its workaround if known.
- next_action: a concrete next step someone stated.

STRUCTURE
- subject: a short noun phrase naming what the claim is about ("sponsor demo date", "payment webhook").
- For claims tied to a calendar date, set field "date", value and date = "YYYY-MM-DD".
- If two chunks disagree (different owners or dates for the same thing), output BOTH as separate claims with the same subject. Do not pick one.
- Prefer fewer, high-value claims over many trivial ones. At most 40 claims.

Reply with JSON only: {"claims":[{"type":"...","statement":"...","subject":"...","field":"...","value":"...","basis":"stated","quote":"...","chunk_id":"...","confidence":0.0,"date":"YYYY-MM-DD"}]}`;

export function buildUserPrompt(opts: { project: string; leaver: string; successor: string; people: PeopleIndex; chunks: Chunk[]; sourceNames: Map<string, string> }): string {
  const lines: string[] = [];
  lines.push(`Project: ${opts.project}`);
  lines.push(`Person leaving: ${opts.leaver}. Incoming person: ${opts.successor}.`);
  lines.push(`Known people: ${opts.people.names.join(", ") || "unknown"}.`);
  lines.push("");
  lines.push("CHUNKS");
  for (const c of opts.chunks) {
    const meta = [opts.sourceNames.get(c.sourceId), c.locator.label, c.author && `author: ${c.author}`, c.time && `time: ${c.time.slice(0, 16)}`].filter(Boolean).join(" | ");
    lines.push(`[${c.id}] (${meta})`);
    lines.push(c.text);
    lines.push("---");
  }
  return lines.join("\n");
}

/** Split chunks into prompt-sized batches. */
export function batchChunks(chunks: Chunk[], maxChars = 12000): Chunk[][] {
  const batches: Chunk[][] = [];
  let cur: Chunk[] = [];
  let size = 0;
  for (const c of chunks) {
    const n = c.text.length + 120;
    if (size + n > maxChars && cur.length) {
      batches.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(c);
    size += n;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

/** Tolerant JSON extraction: strips code fences / prose around the object. */
export function parseJsonReply(text: string): unknown {
  let t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const start = t.search(/[[{]/);
  if (start > 0) t = t.slice(start);
  const lastObj = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (lastObj >= 0) t = t.slice(0, lastObj + 1);
  const parsed = JSON.parse(t);
  return Array.isArray(parsed) ? { claims: parsed } : parsed;
}

export interface AiBatchResult { candidates: Candidate[]; dropped: number }

export function mapReply(raw: unknown, allowedIds: Set<string>, people: PeopleIndex): AiBatchResult {
  const reply = ReplySchema.parse(raw);
  const candidates: Candidate[] = [];
  let dropped = 0;
  for (const item of reply.claims) {
    const r = ClaimSchema.safeParse(item);
    if (!r.success) { dropped++; continue; }
    const c = r.data;
    const chunkId = c.chunk_id.replace(/^\[|\]$/g, "").trim();
    let value = c.value ?? undefined;
    if ((c.field === "owner" || c.field === "contact") && value) value = people.resolve(value) || value;
    candidates.push({
      type: c.type,
      statement: c.statement.trim(),
      subject: c.subject ?? undefined,
      field: c.field ?? undefined,
      value,
      basis: c.basis,
      quote: c.quote.trim(),
      // unknown ids are kept: the verifier tries to relocate the quote, and downgrades the claim if it cannot
      chunkId: allowedIds.has(chunkId) ? chunkId : chunkId,
      confidence: c.confidence ?? 0.7,
      date: c.date ?? (c.field === "date" && value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined),
      people: people.mentions(c.statement),
    });
  }
  return { candidates, dropped };
}

/** Run one batch with one retry on invalid JSON. Throws if the provider itself fails. */
export async function extractBatch(call: CallModel, user: string, allowedIds: Set<string>, people: PeopleIndex): Promise<AiBatchResult> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await call(SYSTEM_PROMPT, attempt === 0 ? user : user + "\n\nYour previous reply was not valid JSON. Reply with the JSON object only.");
    try {
      return mapReply(parseJsonReply(text), allowedIds, people);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Model reply was not valid JSON after a retry (${(lastErr as Error)?.message || lastErr})`);
}
