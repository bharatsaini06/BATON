import { useState } from "react";
import { LuPlay, LuCircleCheck, LuLoaderCircle, LuSparkles, LuCpu, LuEyeOff, LuRefreshCw, LuPlugZap, LuShieldCheck, LuFilter, LuSearch, LuGitMerge, LuSwords, LuListChecks, LuMessageCircleQuestion } from "react-icons/lu";
import type { EvidenceStatus } from "../../core/types";
import { STATUS_LABEL } from "../../core/types";
import { roleCanSee, sourcesFingerprint } from "../../core/permissions";
import { generate, api } from "../api";
import { useHealth } from "../app";
import { useProject, goStep } from "../pages/project";
import { AccessBadge, Button, Callout, Card, Modal, Segmented, SourceIcon, StatusBadge, useToast, cx } from "../ui";

const STAGE: Record<string, { label: string; icon: typeof LuPlay }> = {
  gate: { label: "Permission gate", icon: LuFilter },
  extract: { label: "Extraction", icon: LuSearch },
  verify: { label: "Quote verification", icon: LuShieldCheck },
  merge: { label: "Merge duplicates", icon: LuGitMerge },
  conflicts: { label: "Conflict detection", icon: LuSwords },
  coverage: { label: "Coverage checklist", icon: LuListChecks },
  questions: { label: "Gap Interview questions", icon: LuMessageCircleQuestion },
};

export function ReconstructStep() {
  const { project, update, stale } = useProject();
  const health = useHealth();
  const toast = useToast();
  const aiOn = !!health?.ai.configured;
  const [engine, setEngine] = useState<"auto" | "ai" | "rules">("auto");
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<{ stage: string; message: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [testing, setTesting] = useState(false);

  const visible = project.sources.filter((s) => roleCanSee(project.successorRole, s.access) && s.kind !== "testimony");
  const hidden = project.sources.filter((s) => !roleCanSee(project.successorRole, s.access));
  const reviewed = project.claims.filter((c) => c.review.decision !== "pending" && !c.resolvedBy).length;

  const run = async () => {
    setConfirm(false);
    setRunning(true);
    setEvents([]);
    setError(null);
    try {
      // testimony from an earlier interview is replaced by a fresh interview after re-running
      const sources = project.sources.filter((s) => s.kind !== "testimony");
      const out = await generate(
        { project: project.title, leaver: project.leaver, successor: project.successor, successorRole: project.successorRole, people: project.people, sources, engine },
        (stage, message) => setEvents((e) => [...e, { stage, message }]),
      );
      await update(
        (p) => ({ ...p, sources, claims: out.claims, questions: out.questions, run: out.run, runFingerprint: sourcesFingerprint({ ...p, sources }), stage: "generated" }),
        { actor: "Baton", action: "Handover reconstructed", detail: `${out.run.engine === "ai" ? `AI (${out.run.provider}, ${out.run.model})` : "Rules engine"} · ${out.claims.length} claims · ${out.questions.length} questions · ${out.run.hiddenSources} sources withheld` },
      );
      toast("success", `${out.claims.length} claims reconstructed`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const testAi = async () => {
    setTesting(true);
    try {
      const r = await api.aiTest();
      toast(r.ok ? "success" : "danger", `${r.ok ? "AI connection works" : "AI test failed"}: ${r.message} (${r.ms} ms)`);
    } catch (e) {
      toast("danger", (e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const runInfo = project.run;
  const stageList = running || events.length ? groupEvents(events) : runInfo ? groupEvents(runInfo.trace.map((t) => ({ stage: t.stage, message: t.message }))) : [];

  return (
    <div className="step-body">
      {stale && <Callout tone="warn" title="Results are out of date">Sources, access tags, people or the successor role changed after the last run. Run again to refresh.</Callout>}
      <div className="two-col">
        <Card>
          <h2 className="card-title">Reconstruct the handover for {project.successor || "the successor"}</h2>
          <p className="muted">Baton builds the handover <b>as a {project.successorRole === "lead" ? "Lead" : "Member"} would be allowed to see it</b>. Withheld sources are never read by the extractor or the AI.</p>
          <div className="gate-box">
            <div>
              <div className="small strong">Read ({visible.length})</div>
              {visible.map((s) => <div key={s.id} className="gate-item"><SourceIcon kind={s.kind} /> {s.name} <AccessBadge access={s.access} /></div>)}
            </div>
            <div>
              <div className="small strong"><LuEyeOff aria-hidden /> Withheld ({hidden.length})</div>
              {hidden.length ? hidden.map((s) => <div key={s.id} className="gate-item muted"><SourceIcon kind={s.kind} /> {s.name} <AccessBadge access={s.access} /></div>) : <div className="muted small">Nothing withheld for this role.</div>}
            </div>
          </div>
          <div className="engine-row">
            <div>
              <div className="small strong">Extraction engine</div>
              <Segmented
                label="Extraction engine"
                value={engine}
                onChange={setEngine}
                options={[
                  { value: "auto", label: "Auto" },
                  { value: "ai", label: <><LuSparkles aria-hidden /> AI</>, disabled: !aiOn, title: aiOn ? undefined : "No AI key configured on this server" },
                  { value: "rules", label: <><LuCpu aria-hidden /> Rules</> },
                ]}
              />
              <div className="muted xsmall mt-xs">
                {aiOn ? `Auto uses ${health?.ai.providerLabel} (${health?.ai.model}) and falls back to the offline rules engine if the model is unavailable.` : "No AI key on this server: the offline rules engine extracts claims. Verification, permissions and review work exactly the same."}
              </div>
            </div>
            {aiOn && <Button size="sm" variant="ghost" icon={<LuPlugZap />} loading={testing} onClick={testAi}>Test AI</Button>}
          </div>
          <div className="row gap mt">
            <Button variant="primary" size="lg" icon={runInfo ? <LuRefreshCw /> : <LuPlay />} loading={running} disabled={!visible.length} onClick={() => (reviewed > 0 ? setConfirm(true) : run())}>
              {running ? "Reconstructing…" : runInfo ? "Run again" : "Run reconstruction"}
            </Button>
            {!visible.length && <span className="muted small">No sources are visible to this role.</span>}
          </div>
          {error && <Callout tone="danger" title="Reconstruction failed">{error}</Callout>}
        </Card>

        <Card>
          <h2 className="card-title">Pipeline</h2>
          {!stageList.length ? (
            <p className="muted">Each stage will appear here as it runs: permission gate → extraction → quote verification → merge → conflicts → coverage → questions.</p>
          ) : (
            <ol className="pipeline">
              {stageList.map((s, i) => {
                const meta = STAGE[s.stage] || { label: s.stage, icon: LuPlay };
                const active = running && i === stageList.length - 1;
                return (
                  <li key={s.stage} className={cx(active ? "active" : "done")}>
                    <span className="pipe-icon">{active ? <LuLoaderCircle className="spin" /> : <LuCircleCheck />}</span>
                    <div>
                      <div className="strong small"><meta.icon aria-hidden /> {meta.label}</div>
                      {s.messages.map((m, k) => <div key={k} className="muted small">{m}</div>)}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          {runInfo && !running && <div className="muted xsmall mt">{runInfo.engine === "ai" ? `AI · ${runInfo.provider} · ${runInfo.model}` : "Rules engine (offline)"} · {(runInfo.durationMs / 1000).toFixed(1)} s · {new Date(runInfo.at).toLocaleString("en-IN")}</div>}
        </Card>
      </div>

      {runInfo && !running && (
        <>
          {runInfo.warnings.map((w) => <Callout key={w} tone="warn">{w}</Callout>)}
          <div className="status-tiles">
            {(["verified", "inferred", "conflicting", "missing"] as EvidenceStatus[]).map((s) => (
              <div key={s} className={cx("status-tile", `tile-${s}`)}>
                <div className="tile-num">{project.claims.filter((c) => c.status === s).length}</div>
                <StatusBadge status={s} />
                <div className="muted xsmall">{s === "verified" ? "quote found in a visible source" : s === "inferred" ? "interpretation — needs confirmation" : s === "conflicting" ? "sources disagree" : "expected but not in any source"}</div>
              </div>
            ))}
          </div>
          <div className="step-footer">
            <Button variant="ghost" onClick={() => goStep(project, "review")}>Skip to review</Button>
            <Button variant="primary" onClick={() => goStep(project, "interview")}>
              {project.questions.length ? `Answer ${project.questions.length} Gap Interview question${project.questions.length === 1 ? "" : "s"} →` : "Continue →"}
            </Button>
          </div>
        </>
      )}

      <Modal open={confirm} onClose={() => setConfirm(false)} title="Run reconstruction again?" footer={<><Button onClick={() => setConfirm(false)}>Cancel</Button><Button variant="primary" onClick={run}>Run again</Button></>}>
        <p>This replaces the current {project.claims.length} claims, {reviewed} review decision{reviewed === 1 ? "" : "s"} and Gap Interview answers with a fresh reconstruction. Published versions are not affected.</p>
        <p className="muted small">Labels: {Object.entries(STATUS_LABEL).map(([k, v]) => `${v} ${project.claims.filter((c) => c.status === k).length}`).join(" · ")}</p>
      </Modal>
    </div>
  );
}

function groupEvents(events: { stage: string; message: string }[]) {
  const out: { stage: string; messages: string[] }[] = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (last && last.stage === e.stage) last.messages.push(e.message);
    else out.push({ stage: e.stage, messages: [e.message] });
  }
  return out;
}
