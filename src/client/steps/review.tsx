import { useMemo, useState } from "react";
import { LuCheckCheck, LuSearch, LuEye, LuChevronDown, LuChevronRight } from "react-icons/lu";
import type { Claim, EvidenceStatus, SectionKey, ClaimType } from "../../core/types";
import { SECTION_OF, SECTION_LABEL, CLAIM_TYPE_LABEL, STATUS_LABEL } from "../../core/types";
import { chunkIndex } from "../../core/permissions";
import { readiness } from "../../core/plan";
import { useProject, StepFooter } from "../pages/project";
import { packagesFor } from "../store";
import { ClaimCard, EvidenceDrawer } from "../components/claim";
import { Button, Callout, Card, Empty, Meter, Modal, cx, useToast } from "../ui";

const ORDER: SectionKey[] = ["owners", "open", "risks", "timeline"];

export function ReviewStep() {
  const { project, update, stale } = useProject();
  const toast = useToast();
  const [ev, setEv] = useState<Claim | null>(null);
  const [status, setStatus] = useState<EvidenceStatus | "all">("all");
  const [decision, setDecision] = useState<"all" | "pending" | "approved" | "rejected">("all");
  const [type, setType] = useState<ClaimType | "all">("all");
  const [q, setQ] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const [bulk, setBulk] = useState(false);

  const chunks = useMemo(() => chunkIndex(project.sources), [project.sources]);
  const sources = useMemo(() => new Map(project.sources.map((s) => [s.id, s])), [project.sources]);
  const r = readiness(project.claims);
  const flags = packagesFor(project.id).flatMap((p) => p.flags);

  const live = project.claims.filter((c) => !c.resolvedBy || c.status === "verified");
  const resolved = project.claims.filter((c) => c.resolvedBy && c.status !== "verified");
  const filtered = live.filter(
    (c) =>
      (status === "all" || c.status === status) &&
      (type === "all" || c.type === type) &&
      (decision === "all" || (decision === "approved" ? c.review.decision === "approved" || c.review.decision === "edited" : c.review.decision === decision)) &&
      (!q.trim() || c.statement.toLowerCase().includes(q.toLowerCase())),
  );
  const verifiedPending = live.filter((c) => c.status === "verified" && c.review.decision === "pending");
  const counts = { approved: live.filter((c) => c.review.decision === "approved" || c.review.decision === "edited").length, rejected: live.filter((c) => c.review.decision === "rejected").length, pending: live.filter((c) => c.review.decision === "pending").length };

  const decide = async (c: Claim, d: "approved" | "rejected" | "pending" | "edited", patch?: { statement?: string; note?: string }) => {
    const at = new Date().toISOString();
    await update(
      (p) => ({
        ...p,
        stage: "reviewed",
        claims: p.claims.map((x) =>
          x.id !== c.id ? x : {
            ...x,
            statement: d === "edited" && patch?.statement ? patch.statement : d === "pending" && x.review.original ? x.review.original : x.statement,
            review: d === "pending" ? { decision: "pending" } : { decision: d, by: project.reviewer, at, note: patch?.note || undefined, original: d === "edited" ? x.review.original || x.statement : undefined },
          },
        ),
      }),
      { actor: project.reviewer, action: d === "pending" ? "Review undone" : d === "edited" ? "Claim edited and approved" : d === "approved" ? "Claim approved" : "Claim rejected", detail: d === "edited" ? `“${c.statement}” → “${patch?.statement}”` : `${c.statement}${patch?.note ? ` — ${patch.note}` : ""}` },
    );
  };

  const approveVerified = async () => {
    const at = new Date().toISOString();
    const ids = new Set(verifiedPending.map((c) => c.id));
    await update((p) => ({ ...p, stage: "reviewed", claims: p.claims.map((c) => (ids.has(c.id) ? { ...c, review: { decision: "approved", by: project.reviewer, at } } : c)) }), {
      actor: project.reviewer, action: "Bulk approval", detail: `${ids.size} verified claims approved`,
    });
    setBulk(false);
    toast("success", `${ids.size} verified claims approved`);
  };

  if (!project.claims.length) return <div className="step-body"><Card><Empty title="Nothing to review yet">Run Reconstruct to generate claims.</Empty></Card></div>;

  const peersOf = (c: Claim) => (c.conflictGroup ? live.filter((x) => x.conflictGroup === c.conflictGroup && x.id !== c.id) : []);

  return (
    <div className="step-body">
      {stale && <Callout tone="warn" title="Sources changed after reconstruction">These claims may be out of date. Re-run Reconstruct before publishing.</Callout>}
      {flags.length > 0 && (
        <Callout tone="danger" title={`${project.successor} flagged ${flags.length} item${flags.length === 1 ? "" : "s"} in a published version`}>
          {flags.map((f, i) => <div key={i}>“{f.note}” — {f.by}</div>)}
          <div className="small">Correct the claims below and publish a new version.</div>
        </Callout>
      )}

      <div className="review-top">
        <Card className="readiness-card">
          <Meter value={r.score} size={84} label="Readiness" />
          <div className="readiness-body">
            <div className="strong">{r.label}</div>
            <div className="readiness-grid">
              <span>Verified evidence</span><b>{Math.round(r.verifiedShare * 100)}%</b>
              <span>Reviewed</span><b>{Math.round(r.reviewedShare * 100)}%</b>
              <span>Unresolved conflicts</span><b className={r.unresolvedConflicts ? "text-red" : ""}>{r.unresolvedConflicts}</b>
              <span>Open gaps</span><b className={r.openGaps ? "text-amber" : ""}>{r.openGaps}</b>
            </div>
          </div>
        </Card>
        <Card className="review-actions-card">
          <div className="decision-counts">
            <div><b className="text-green">{counts.approved}</b><span>approved</span></div>
            <div><b className="text-red">{counts.rejected}</b><span>rejected</span></div>
            <div><b>{counts.pending}</b><span>pending</span></div>
          </div>
          <div className="row gap wrap">
            <Button variant="success" icon={<LuCheckCheck />} disabled={!verifiedPending.length} onClick={() => setBulk(true)}>Approve all verified ({verifiedPending.length})</Button>
            <span className="muted xsmall">Inferred, conflicting and missing items need an individual decision.</span>
          </div>
        </Card>
      </div>

      <div className="filters">
        <div className="filter-chips" role="group" aria-label="Filter by status">
          {(["all", "verified", "inferred", "conflicting", "missing"] as const).map((s) => (
            <button key={s} className={cx("fchip", status === s && "on", s !== "all" && `fchip-${s}`)} onClick={() => setStatus(s)}>
              {s === "all" ? "All" : STATUS_LABEL[s]} <span className="fcount">{s === "all" ? live.length : live.filter((c) => c.status === s).length}</span>
            </button>
          ))}
        </div>
        <select className="select select-sm" value={decision} onChange={(e) => setDecision(e.target.value as typeof decision)} aria-label="Filter by decision">
          <option value="all">Any decision</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option>
        </select>
        <select className="select select-sm" value={type} onChange={(e) => setType(e.target.value as typeof type)} aria-label="Filter by type">
          <option value="all">All types</option>
          {(Object.keys(CLAIM_TYPE_LABEL) as ClaimType[]).map((t) => <option key={t} value={t}>{CLAIM_TYPE_LABEL[t]}</option>)}
        </select>
        <div className="search"><LuSearch aria-hidden /><input className="input input-sm" placeholder="Search claims" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search claims" /></div>
      </div>

      {ORDER.map((sec) => {
        const list = filtered.filter((c) => SECTION_OF[c.type] === sec).sort(sortClaims);
        if (!list.length) return null;
        return (
          <section key={sec} className="claim-section">
            <h2 className="section-title">{SECTION_LABEL[sec]} <span className="muted">({list.length})</span></h2>
            <div className="claims">
              {list.map((c) => (
                <ClaimCard key={c.id} claim={c} chunks={chunks} sources={sources} onEvidence={setEv} onDecide={decide} conflictPeers={peersOf(c)} flagged={flags.filter((f) => f.claimId === c.id)} />
              ))}
            </div>
          </section>
        );
      })}
      {!filtered.length && <Card><Empty icon={<LuEye />} title="No claims match these filters" /></Card>}

      {resolved.length > 0 && (
        <section className="claim-section">
          <button className="collapse-btn" onClick={() => setShowResolved(!showResolved)}>
            {showResolved ? <LuChevronDown /> : <LuChevronRight />} Resolved by the Gap Interview ({resolved.length})
          </button>
          {showResolved && <div className="claims">{resolved.map((c) => <ClaimCard key={c.id} claim={c} chunks={chunks} sources={sources} onEvidence={setEv} onDecide={decide} />)}</div>}
        </section>
      )}

      <StepFooter back="interview" next="publish" nextLabel="Prepare the handover" nextDisabled={!counts.approved} nextHint={!counts.approved ? "Approve at least one claim" : `${counts.approved} approved will be shared`} />

      <EvidenceDrawer claim={ev ? project.claims.find((c) => c.id === ev.id) || ev : null} chunks={chunks} sources={sources} onClose={() => setEv(null)} />
      <Modal open={bulk} onClose={() => setBulk(false)} title="Approve all verified claims?" footer={<><Button onClick={() => setBulk(false)}>Cancel</Button><Button variant="success" onClick={approveVerified}>Approve {verifiedPending.length}</Button></>}>
        <p>Each of these {verifiedPending.length} claims quotes words that were found in a source the successor may see. You can still undo any single approval.</p>
      </Modal>
    </div>
  );
}

const STATUS_ORDER: Record<EvidenceStatus, number> = { conflicting: 0, missing: 1, inferred: 2, verified: 3 };
function sortClaims(a: Claim, b: Claim) {
  return STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.conflictGroup || "").localeCompare(b.conflictGroup || "") || (a.date || "9").localeCompare(b.date || "9");
}
