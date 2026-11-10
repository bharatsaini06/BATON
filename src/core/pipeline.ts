// The reconstruction pipeline: permission gate → extraction (AI or rules) → verification →
// de-duplication → conflict detection → coverage check → Gap Interview questions.
import type { Claim, GapQuestion, Person, RunInfo, Source, SuccessorRole } from "./types";
import { gate, chunkIndex } from "./permissions";
import { PeopleIndex } from "./people";
import { extractRules, type Candidate } from "./extract-rules";
import { batchChunks, buildUserPrompt, extractBatch, type CallModel } from "./extract-ai";
import { toClaim, mergeDuplicates, capPerType } from "./verify";
import { detectConflicts, coverage, buildQuestions } from "./analysis";
import { statusCounts } from "./plan";
import { nowIso } from "./text";

export interface PipelineInput {
  project: string;
  leaver: string;
  successor: string;
  successorRole: SuccessorRole;
  people: Person[];
  sources: Source[];
}

export interface PipelineDeps {
  callModel?: CallModel;          // when absent, the rules engine is used
  provider?: string;
  model?: string;
  maxAiBatches?: number;
  concurrency?: number;
  onProgress?: (stage: string, message: string) => void;
}

export interface PipelineOutput { claims: Claim[]; questions: GapQuestion[]; run: RunInfo }

export async function runPipeline(input: PipelineInput, deps: PipelineDeps = {}): Promise<PipelineOutput> {
  const t0 = Date.now();
  const trace: RunInfo["trace"] = [];
  const warnings: string[] = [];
  let last = t0;
  const step = (stage: string, message: string) => {
    const now = Date.now();
    trace.push({ stage, message, ms: now - last });
    last = now;
    deps.onProgress?.(stage, message);
  };

  // 1. permission gate — nothing the successor may not see goes any further
  const g = gate(input.sources, input.successorRole);
  const visible = new Map(g.visible.map((c) => [c.id, c]));
  step("gate", `${g.visible.length} chunks visible to a ${input.successorRole}; ${g.hiddenChunks} hidden (${g.hiddenSources.length} source${g.hiddenSources.length === 1 ? "" : "s"} withheld)`);

  const people = new PeopleIndex(input.people, g.visible);
  const sourceNames = new Map(input.sources.map((s) => [s.id, s.name]));

  // 2. extraction
  let candidates: Candidate[] = [];
  let engine: RunInfo["engine"] = "rules";
  let batchesRun = 0;
  const aiCandidates: Candidate[] = [];
  const ruleChunks = [...g.visible];
  if (deps.callModel && g.visible.length) {
    engine = "ai";
    const batches = batchChunks(g.visible);
    const max = deps.maxAiBatches ?? 8;
    const run = batches.slice(0, max);
    if (batches.length > max) warnings.push(`Only the first ${max} of ${batches.length} batches were analysed by the AI model; the rest were processed by the rules engine.`);
    ruleChunks.length = 0;
    batches.slice(max).forEach((b) => ruleChunks.push(...b));
    step("extract", `Sending ${run.length} batch${run.length === 1 ? "" : "es"} to ${deps.provider || "the AI model"} (${deps.model || "default model"})`);
    const conc = Math.max(1, deps.concurrency ?? 3);
    let failed = 0;
    for (let i = 0; i < run.length; i += conc) {
      const slice = run.slice(i, i + conc);
      const results = await Promise.allSettled(
        slice.map((b) => extractBatch(deps.callModel!, buildUserPrompt({ project: input.project, leaver: input.leaver, successor: input.successor, people, chunks: b, sourceNames }), new Set(b.map((c) => c.id)), people)),
      );
      results.forEach((r, k) => {
        batchesRun++;
        if (r.status === "fulfilled") {
          aiCandidates.push(...r.value.candidates);
          if (r.value.dropped) warnings.push(`AI batch ${i + k + 1}: ${r.value.dropped} malformed claim(s) dropped by schema validation.`);
        } else {
          failed++;
          ruleChunks.push(...slice[k]);
          warnings.push(`AI batch ${i + k + 1} failed (${clipErr(r.reason)}); its chunks were processed by the rules engine instead.`);
        }
      });
      step("extract", `AI batches done: ${Math.min(i + conc, run.length)}/${run.length}`);
    }
    if (failed === run.length) {
      engine = "rules";
      warnings.unshift("The AI model could not be reached, so the offline rules engine produced this handover.");
    }
  }
  candidates = [...aiCandidates];
  if (ruleChunks.length) {
    const rc = extractRules(ruleChunks, people);
    candidates.push(...rc);
    step("extract", `Rules engine proposed ${rc.length} candidate claims from ${ruleChunks.length} chunks`);
  }
  // structured work-log entries are always read by the rules engine too: they are explicit statements
  if (engine === "ai") {
    const logChunks = g.visible.filter((c) => c.meta?.logKind && c.meta.logKind !== "note");
    const lc = extractRules(logChunks, people);
    candidates.push(...lc);
  }

  // 3. verification — status decided by code
  const engineOf = (c: Candidate) => {
    const ch = visible.get(c.chunkId);
    if (ch?.meta?.logKind) return "worklog" as const;
    return aiCandidates.includes(c) ? ("ai" as const) : ("rules" as const);
  };
  let claims = candidates.map((c) => toClaim(c, visible, people, engineOf(c)));
  const verifiedNow = claims.filter((c) => c.status === "verified").length;
  step("verify", `${candidates.length} candidates checked against sources: ${verifiedNow} quotes verified, ${claims.length - verifiedNow} downgraded to inferred`);

  // 4. merge and cap
  claims = capPerType(mergeDuplicates(claims));
  step("merge", `${claims.length} claims after merging duplicates`);

  // 5. conflicts
  const idx = chunkIndex(input.sources);
  detectConflicts(claims, idx);
  const conflictGroups = new Set(claims.filter((c) => c.conflictGroup).map((c) => c.conflictGroup)).size;
  step("conflicts", conflictGroups ? `${conflictGroups} conflict${conflictGroups === 1 ? "" : "s"} found between sources` : "No conflicts between sources");

  // 6. coverage
  const gaps = coverage(claims, g.visible);
  claims.push(...gaps);
  step("coverage", gaps.length ? `${gaps.length} expected item${gaps.length === 1 ? "" : "s"} missing from all sources` : "Handover checklist fully covered");

  // 7. questions
  const questions = buildQuestions(claims, idx);
  step("questions", `${questions.length} Gap Interview question${questions.length === 1 ? "" : "s"} prepared for ${input.leaver}`);

  return {
    claims,
    questions,
    run: {
      at: nowIso(),
      engine,
      provider: engine === "ai" ? deps.provider : undefined,
      model: engine === "ai" ? deps.model : undefined,
      role: input.successorRole,
      visibleChunks: g.visible.length,
      hiddenChunks: g.hiddenChunks,
      hiddenSources: g.hiddenSources.length,
      batches: batchesRun,
      warnings,
      trace,
      durationMs: Date.now() - t0,
      counts: statusCounts(claims),
    },
  };
}

function clipErr(e: unknown): string {
  const m = (e as Error)?.message || String(e);
  return m.length > 140 ? m.slice(0, 139) + "…" : m;
}
