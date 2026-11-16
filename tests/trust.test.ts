// Trust challenge: a mock model proposes facts about the synthetic sample project. Some are true;
// others carry the mistakes a real model makes (invented quote, reversed meaning, wrong date,
// wrong amount, wrong person, a quote from a source the successor may not see, a dropped "not").
// The verifier must mark only the true ones Verified. Run: npx tsx --test tests/trust.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSampleProject } from "../src/core/sample";
import { runPipeline } from "../src/core/pipeline";
import type { Claim } from "../src/core/types";

type Case = { id: string; kind: "true" | "planted"; label: string; role: "member" | "lead"; find: string; claim: Record<string, unknown> };

export const CASES: Case[] = [
  { id: "T1", kind: "true", label: "Owner, quoted correctly", role: "member", find: "Kabir will handle", claim: { type: "owner", statement: "Kabir Khan owns the leaderboard and the admin dashboard", field: "owner", value: "Kabir", quote: "Kabir will handle the leaderboard and the admin dashboard" } },
  { id: "T2", kind: "true", label: "Contact, quoted correctly", role: "member", find: "ping Prof. Rao", claim: { type: "contact", statement: "Ask Prof. Anita Rao before changing the payment flow", quote: "ping Prof. Rao before changing anything in the payment flow" } },
  { id: "T3", kind: "true", label: "Deadline, quoted correctly", role: "member", find: "Registration closes on 5 Dec", claim: { type: "deadline", statement: "Registration closes on 5 Dec 2026", field: "date", value: "2026-12-05", quote: "Registration closes on 5 Dec 2026" } },
  { id: "T4", kind: "true", label: "Amount, quoted correctly (Lead successor)", role: "lead", find: "second tranche", claim: { type: "dependency", statement: "The second sponsorship tranche of Rs 40,000 is released after the demo", quote: "The second tranche of Rs 40,000 is released only after the demo on 20 Dec" } },
  { id: "P1", kind: "planted", label: "Invented quote", role: "member", find: "Kabir will handle", claim: { type: "decision", statement: "The team moved hosting to AWS", quote: "We moved everything to AWS last week" } },
  { id: "P2", kind: "planted", label: "Meaning reversed (added \"not\")", role: "member", find: "ping Prof. Rao", claim: { type: "contact", statement: "Payment changes do not need Prof. Rao's approval", quote: "ping Prof. Rao before changing anything in the payment flow" } },
  { id: "P3", kind: "planted", label: "Meaning reversed (dropped \"not\")", role: "member", find: "not sure who handles", claim: { type: "owner", statement: "Kabir Khan handles the domain renewal", quote: "Got the domain renewal reminder for techfest-codecraft.in, not sure who handles that" } },
  { id: "P4", kind: "planted", label: "Wrong date, real quote", role: "member", find: "Registration closes on 5 Dec", claim: { type: "deadline", statement: "Registration closes on 15 Dec 2026", field: "date", value: "2026-12-15", quote: "Registration closes on 5 Dec 2026" } },
  { id: "P5", kind: "planted", label: "Wrong amount, real quote (Lead successor)", role: "lead", find: "second tranche", claim: { type: "dependency", statement: "The second sponsorship tranche of Rs 50,000 is released after the demo", quote: "The second tranche of Rs 40,000 is released only after the demo on 20 Dec" } },
  { id: "P6", kind: "planted", label: "Wrong person, real quote", role: "member", find: "Kabir will handle", claim: { type: "owner", statement: "Neha Iyer owns the leaderboard and the admin dashboard", field: "owner", value: "Neha", quote: "Kabir will handle the leaderboard and the admin dashboard" } },
  { id: "P7", kind: "planted", label: "Quote from a Lead-only source (Member successor)", role: "member", find: "", claim: { type: "dependency", statement: "The sponsorship is Rs 75,000", quote: "confirming the sponsorship of Rs 75,000 for TechFest 2026", chunk_id: "hidden-email" } },
  { id: "P8", kind: "planted", label: "Guess presented as fact", role: "member", find: "free plan", claim: { type: "risk", statement: "Firebase will definitely run out in January", basis: "inferred", quote: "Firebase free plan might run out in January" } },
];

export async function runCase(c: Case): Promise<Claim | undefined> {
  const p = createSampleProject("trust");
  const callModel = async (_s: string, user: string) => {
    const blocks = user.split(/\n(?=\[s[^\]]+\])/);
    const hit = c.find ? blocks.find((b) => b.includes(c.find)) : undefined;
    const id = hit ? /^\[([^\]]+)\]/.exec(hit.trim())?.[1] : undefined;
    if (c.find && !id) return JSON.stringify({ claims: [] });
    return JSON.stringify({ claims: [{ basis: "stated", ...c.claim, chunk_id: c.claim.chunk_id || id }] });
  };
  const out = await runPipeline({ project: p.title, leaver: p.leaver, successor: p.successor, successorRole: c.role, people: p.people, sources: p.sources, engine: "ai" } as any, { callModel, provider: "Mock", model: "mock" });
  return out.claims.find((k) => k.engine === "ai" && k.statement === c.claim.statement);
}

test("trust challenge: only true facts are Verified", async () => {
  const rows: string[] = [];
  let caught = 0, kept = 0;
  for (const c of CASES) {
    const k = await runCase(c);
    const status = k?.status || "dropped";
    if (c.kind === "planted" && status !== "verified") caught++;
    if (c.kind === "true" && status === "verified") kept++;
    rows.push(`${c.id}  ${c.label.padEnd(50)} ${status.padEnd(10)} ${k?.statusReason || ""}`);
    if (c.kind === "true") assert.equal(status, "verified", `${c.id} ${c.label}: ${k?.statusReason}`);
    else assert.notEqual(status, "verified", `${c.id} ${c.label} must not be Verified`);
  }
  console.log(rows.join("\n"));
  console.log(`planted mistakes caught: ${caught} / ${CASES.filter((c) => c.kind === "planted").length}; true facts verified: ${kept} / ${CASES.filter((c) => c.kind === "true").length}`);
});
