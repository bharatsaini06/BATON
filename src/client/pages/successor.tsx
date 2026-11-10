import { useEffect, useMemo, useState } from "react";
import { LuCircleCheck, LuFlag, LuEyeOff, LuShieldCheck, LuTriangleAlert, LuDownload, LuSquareCheck, LuSquare, LuHistory, LuUsers, LuListTodo, LuTriangle, LuRoute, LuGauge } from "react-icons/lu";
import type { Claim, SectionKey, SharePackage } from "../../core/types";
import { SECTION_LABEL, SECTION_OF } from "../../core/types";
import { packageMarkdown } from "../../core/plan";
import { formatDate, formatDateTime } from "../../core/text";
import { api, ApiError } from "../api";
import { getPackage, savePackage, packagesFor, usePref, useStore } from "../store";
import { navigate } from "../router";
import { ClaimCard, EvidenceDrawer } from "../components/claim";
import { Button, Callout, Card, Modal, Spinner, StatusBadge, useToast, cx } from "../ui";
import { download } from "../files";

const SECTIONS: { key: SectionKey; icon: typeof LuGauge }[] = [
  { key: "state", icon: LuGauge },
  { key: "plan", icon: LuRoute },
  { key: "owners", icon: LuUsers },
  { key: "open", icon: LuListTodo },
  { key: "risks", icon: LuTriangle },
  { key: "timeline", icon: LuHistory },
];

export function SuccessorPage({ id }: { id: string }) {
  const { ready } = useStore();
  const toast = useToast();
  const [pkg, setPkg] = useState<SharePackage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ev, setEv] = useState<Claim | null>(null);
  const [flagging, setFlagging] = useState<Claim | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!ready) return;
    const local = getPackage(id);
    if (local) { setPkg(local); return; }
    api.share(id).then((r) => { setPkg(r.package); void savePackage(r.package); }).catch((e: ApiError) => setError(e.status === 404 ? "This handover was not found. It may have been published in another browser on a server without shared storage, or the link is incomplete." : e.message));
  }, [id, ready]);

  const chunks = useMemo(() => new Map((pkg?.chunks || []).map((c) => [c.id, c])), [pkg]);
  const sources = useMemo(() => new Map((pkg?.sources || []).map((s) => [s.id, s])), [pkg]);

  if (error) return <div className="page narrow center-page"><h1>Handover not available</h1><p className="muted">{error}</p></div>;
  if (!pkg) return <div className="page"><Spinner label="Loading handover…" /></div>;

  const persist = async (next: SharePackage, remote: () => Promise<{ package: SharePackage }>) => {
    setPkg(next);
    await savePackage(next);
    try { const r = await remote(); setPkg({ ...next, acknowledgements: { ...r.package.acknowledgements, ...next.acknowledgements }, flags: next.flags }); } catch { /* not stored on server: kept in this browser */ }
  };

  const ack = async (s: SectionKey) => {
    const next = { ...pkg, acknowledgements: { ...pkg.acknowledgements, [s]: { by: pkg.successor, at: new Date().toISOString() } } };
    await persist(next, () => api.ack(pkg.id, s, pkg.successor));
    toast("success", `${SECTION_LABEL[s]} acknowledged`);
  };

  const flag = async () => {
    if (!flagging || !note.trim()) return;
    const f = { claimId: flagging.id, note: note.trim(), by: pkg.successor, at: new Date().toISOString() };
    await persist({ ...pkg, flags: [...pkg.flags, f] }, () => api.flag(pkg.id, f.claimId, f.note, f.by));
    setFlagging(null);
    setNote("");
    toast("success", "Flag sent to the reviewer");
  };

  const versions = packagesFor(pkg.projectId);
  const claims = pkg.claims;
  const verified = claims.filter((c) => c.status === "verified").length;
  const attention = claims.filter((c) => c.status === "conflicting" || c.status === "missing");
  const acked = Object.keys(pkg.acknowledgements).length;

  const list = (sec: SectionKey) => claims.filter((c) => SECTION_OF[c.type] === sec).sort((a, b) => (a.date || "9").localeCompare(b.date || "9"));
  const flagBtn = (c: Claim) => <Button size="sm" variant="ghost" icon={<LuFlag />} onClick={() => setFlagging(c)}>Flag as wrong</Button>;
  const card = (c: Claim) => <ClaimCard key={c.id} claim={c} chunks={chunks} sources={sources} onEvidence={setEv} flagged={pkg.flags.filter((f) => f.claimId === c.id)} extra={flagBtn(c)} />;

  return (
    <div className="successor">
      <div className="succ-hero">
        <div className="succ-hero-in">
          <div className="eyebrow light">Handover · read-only · role-filtered</div>
          <h1>{pkg.project}</h1>
          <div className="succ-sub">
            For <b>{pkg.successor}</b> ({pkg.role === "lead" ? "Lead" : "Member"}) · from <b>{pkg.leaver}</b> · approved by <b>{pkg.approvedBy}</b> on {formatDate(pkg.approvedAt)}
          </div>
          <div className="succ-badges">
            <span className="hero-badge"><LuShieldCheck aria-hidden /> {verified}/{claims.length} verified against sources</span>
            {pkg.hiddenSources > 0 && <span className="hero-badge"><LuEyeOff aria-hidden /> {pkg.hiddenSources} source{pkg.hiddenSources === 1 ? "" : "s"} withheld for your role</span>}
            <span className="hero-badge"><LuCircleCheck aria-hidden /> {acked}/6 sections acknowledged</span>
            {versions.length > 1 ? (
              <select className="hero-select" value={pkg.id} onChange={(e) => navigate(`/h/${e.target.value}`)} aria-label="Version">
                {versions.map((v) => <option key={v.id} value={v.id}>Version {v.version}</option>)}
              </select>
            ) : <span className="hero-badge">Version {pkg.version}</span>}
          </div>
        </div>
      </div>

      <div className="succ-body">
        <nav className="succ-nav" aria-label="Sections">
          {SECTIONS.map((s) => (
            <a key={s.key} href={`#sec-${s.key}`} className={cx(pkg.acknowledgements[s.key] && "acked")}>
              <s.icon aria-hidden /> <span>{SECTION_LABEL[s.key]}</span>
              {pkg.acknowledgements[s.key] && <LuCircleCheck className="nav-ack" aria-label="acknowledged" />}
            </a>
          ))}
          <Button size="sm" variant="ghost" icon={<LuDownload />} onClick={() => download(`handover-${pkg.id}.md`, packageMarkdown(pkg), "text/markdown")}>Download</Button>
        </nav>

        <div className="succ-content">
          {pkg.changes && (pkg.changes.added.length + pkg.changes.removed.length + pkg.changes.edited.length > 0) && (
            <Callout tone="info" title={`What changed since version ${pkg.changes.fromVersion}`}>
              {pkg.changes.added.length} added · {pkg.changes.edited.length} edited · {pkg.changes.removed.length} removed
              {pkg.changes.removed.length > 0 && <div className="small">Removed: {pkg.changes.removed.map((r) => `“${r}”`).join(" · ")}</div>}
            </Callout>
          )}

          <Section k="state" pkg={pkg} onAck={ack}>
            <div className="glance">
              <div className="glance-tile"><b>{claims.length}</b><span>approved facts</span></div>
              <div className="glance-tile"><b>{list("open").length}</b><span>open items & deadlines</span></div>
              <div className="glance-tile"><b>{list("risks").length}</b><span>risks & dependencies</span></div>
              <div className={cx("glance-tile", attention.length > 0 && "glance-warn")}><b>{attention.length}</b><span>need your attention</span></div>
            </div>
            {attention.length > 0 && (
              <div className="attention">
                <h3><LuTriangleAlert aria-hidden /> Unresolved — do not assume these</h3>
                {attention.map((c) => (
                  <div key={c.id} className="attention-item">
                    <StatusBadge status={c.status} />
                    <span>{c.statement}</span>
                    <button className="link-btn" onClick={() => setEv(c)}>why?</button>
                  </div>
                ))}
              </div>
            )}
            <p className="muted small">
              Every statement below was approved by {pkg.approvedBy}. Click a source chip to see the exact words it is based on. Extraction: {pkg.engine}. Not included: {pkg.excluded.rejected} rejected and {pkg.excluded.pending} unreviewed claims.
            </p>
          </Section>

          <Section k="plan" pkg={pkg} onAck={ack}>
            <PlanView pkg={pkg} onClaim={(cid) => { const c = claims.find((x) => x.id === cid); if (c) setEv(c); }} />
          </Section>

          <Section k="owners" pkg={pkg} onAck={ack}>
            <OwnersView claims={list("owners")} card={card} />
          </Section>
          <Section k="open" pkg={pkg} onAck={ack}>
            {list("open").length ? <div className="claims">{list("open").map(card)}</div> : <p className="muted">No open work in the approved handover.</p>}
          </Section>
          <Section k="risks" pkg={pkg} onAck={ack}>
            {list("risks").length ? <div className="claims">{list("risks").map(card)}</div> : <p className="muted">No risks recorded.</p>}
          </Section>
          <Section k="timeline" pkg={pkg} onAck={ack}>
            {pkg.timeline.length ? (
              <ol className="timeline">
                {pkg.timeline.map((t) => {
                  const c = claims.find((x) => x.id === t.claimId);
                  return (
                    <li key={t.claimId + t.date}>
                      <span className="tl-date">{formatDate(t.date)}</span>
                      <span className="tl-dot" />
                      <div className="tl-body">
                        <StatusBadge status={t.status} /> <span>{t.label}</span>
                        {c && <button className="link-btn" onClick={() => setEv(c)}>source</button>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : <p className="muted">No dated decisions or milestones.</p>}
          </Section>
        </div>
      </div>

      <EvidenceDrawer claim={ev} chunks={chunks} sources={sources} onClose={() => setEv(null)} />
      <Modal open={!!flagging} onClose={() => setFlagging(null)} title="Flag this as wrong" footer={<><Button onClick={() => setFlagging(null)}>Cancel</Button><Button variant="danger" icon={<LuFlag />} disabled={!note.trim()} onClick={flag}>Send flag</Button></>}>
        <p className="small">“{flagging?.statement}”</p>
        <textarea className="textarea" rows={3} autoFocus placeholder="What is wrong or out of date?" value={note} onChange={(e) => setNote(e.target.value)} />
        <p className="muted xsmall">The reviewer sees this flag and can publish a corrected version.</p>
      </Modal>
    </div>
  );
}

function Section({ k, pkg, onAck, children }: { k: SectionKey; pkg: SharePackage; onAck: (k: SectionKey) => void; children: React.ReactNode }) {
  const a = pkg.acknowledgements[k];
  return (
    <section id={`sec-${k}`} className="succ-section">
      <div className="succ-section-head">
        <h2>{SECTION_LABEL[k]}</h2>
        {a ? <span className="acked-chip"><LuCircleCheck aria-hidden /> Acknowledged by {a.by} · {formatDateTime(a.at)}</span> : <Button size="sm" onClick={() => onAck(k)}>Acknowledge</Button>}
      </div>
      <Card>{children}</Card>
    </section>
  );
}

function OwnersView({ claims, card }: { claims: Claim[]; card: (c: Claim) => React.ReactNode }) {
  const byPerson = new Map<string, Claim[]>();
  const rest: Claim[] = [];
  for (const c of claims) {
    const who = (c.field === "owner" || c.field === "contact") && c.value ? c.value : undefined;
    if (who) (byPerson.get(who) || byPerson.set(who, []).get(who)!).push(c);
    else rest.push(c);
  }
  if (!claims.length) return <p className="muted">No owners or contacts in the approved handover.</p>;
  return (
    <div className="owners">
      {[...byPerson.entries()].map(([who, list]) => (
        <div key={who} className="owner-group">
          <div className="owner-name"><span className="avatar">{who.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}</span>{who}</div>
          <div className="claims">{list.map(card)}</div>
        </div>
      ))}
      {rest.length > 0 && <div className="claims">{rest.map(card)}</div>}
    </div>
  );
}

function PlanView({ pkg, onClaim }: { pkg: SharePackage; onClaim: (id: string) => void }) {
  const [done, setDone] = usePref<string[]>(`plan:${pkg.id}`, []);
  const toggle = (id: string) => setDone(done.includes(id) ? done.filter((x) => x !== id) : [...done, id]);
  const group = (h: "day1" | "week1") => pkg.plan.filter((p) => p.horizon === h);
  if (!pkg.plan.length) return <p className="muted">No plan items could be derived from the approved claims.</p>;
  return (
    <div className="plan">
      {(["day1", "week1"] as const).map((h) => (
        <div key={h} className="plan-col">
          <h3>{h === "day1" ? "Day 1" : "Week 1"} <span className="muted">({group(h).length})</span></h3>
          {group(h).map((p) => (
            <div key={p.id} className={cx("plan-item", done.includes(p.id) && "plan-done")}>
              <button className="plan-check" onClick={() => toggle(p.id)} aria-label={done.includes(p.id) ? "Mark not done" : "Mark done"}>{done.includes(p.id) ? <LuSquareCheck /> : <LuSquare />}</button>
              <div>
                <div className="plan-title">{p.title}</div>
                <div className="muted small">{p.why}</div>
                <div className="plan-links">{p.claimIds.map((cid, i) => <button key={cid} className="link-btn xsmall" onClick={() => onClaim(cid)}>evidence{p.claimIds.length > 1 ? ` ${i + 1}` : ""}</button>)}</div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
