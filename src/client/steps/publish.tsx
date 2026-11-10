import { useState } from "react";
import { LuSend, LuCopy, LuExternalLink, LuDownload, LuEyeOff, LuCircleCheck, LuTriangleAlert } from "react-icons/lu";
import type { SectionKey } from "../../core/types";
import { SECTION_OF, SECTION_LABEL } from "../../core/types";
import { isShared, packageMarkdown } from "../../core/plan";
import { roleCanSee, chunkIndex, claimVisible } from "../../core/permissions";
import { formatDateTime } from "../../core/text";
import { api } from "../api";
import { savePackage, packagesFor, getPackage } from "../store";
import { Link } from "../router";
import { useProject, StepFooter } from "../pages/project";
import { Button, Callout, Card, AccessBadge, SourceIcon, copyText, useToast } from "../ui";
import { download } from "../files";

export function PublishStep() {
  const { project, update, stale } = useProject();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ id: string; durable: boolean; storage: string } | null>(null);

  const idx = chunkIndex(project.sources);
  const shared = project.claims.filter(isShared);
  const visible = shared.filter((c) => claimVisible(c, idx, project.successorRole));
  const blocked = shared.length - visible.length;
  const pending = project.claims.filter((c) => c.review.decision === "pending" && !c.resolvedBy).length;
  const rejected = project.claims.filter((c) => c.review.decision === "rejected").length;
  const hidden = project.sources.filter((s) => !roleCanSee(project.successorRole, s.access));
  const unresolved = visible.filter((c) => c.status === "conflicting" || c.status === "missing").length;
  const versions = packagesFor(project.id);
  const prev = versions.at(-1);
  const nextVersion = (project.versions.at(-1)?.version || 0) + 1;

  const bySection = (["owners", "open", "risks", "timeline"] as SectionKey[]).map((s) => [s, visible.filter((c) => SECTION_OF[c.type] === s).length] as const);

  const publish = async () => {
    setBusy(true);
    try {
      const r = await api.publish(project, project.reviewer, prev);
      await savePackage(r.package);
      await update(
        (p) => ({ ...p, stage: "published", versions: [...p.versions, { version: r.package.version, packageId: r.package.id, approvedAt: r.package.approvedAt, approvedBy: r.package.approvedBy, claimCount: r.package.claims.length }] }),
        { actor: project.reviewer, action: `Handover v${r.package.version} approved and published`, detail: `${r.package.claims.length} claims · ${r.package.plan.length} plan items · ${r.package.hiddenSources} sources withheld · storage: ${r.storage}` },
      );
      setLast({ id: r.package.id, durable: r.durable, storage: r.storage });
      toast("success", `Version ${r.package.version} published`);
    } catch (e) {
      toast("danger", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const link = (id: string) => `${location.origin}/h/${id}`;

  return (
    <div className="step-body">
      {stale && <Callout tone="warn" title="Sources changed after reconstruction">Re-run Reconstruct and review before publishing, so the handover matches the current sources.</Callout>}

      {last && (
        <Callout tone="success" title={`Handover v${versions.find((v) => v.id === last.id)?.version ?? ""} is ready for ${project.successor}`}
          action={<div className="row gap"><Button icon={<LuCopy />} onClick={async () => { const ok = await copyText(link(last.id)); toast(ok ? "success" : "danger", ok ? "Link copied" : "Copy failed — select the link and copy it manually"); }}>Copy link</Button><Link to={`/h/${last.id}`} className="btn btn-primary btn-md"><LuExternalLink aria-hidden /><span>Open successor view</span></Link></div>}>
          <div className="mono small">{link(last.id)}</div>
          <div className="small">{last.durable ? "Stored on the server: anyone with this link can open it." : last.storage === "memory" || last.storage === "file" ? "Saved on this server temporarily and in this browser. For permanent links on any device, configure Upstash storage (see README)." : "Saved in this browser."}</div>
        </Callout>
      )}

      <div className="two-col">
        <Card>
          <h2 className="card-title">What {project.successor} will receive</h2>
          <div className="share-grid">
            {bySection.map(([s, n]) => <div key={s} className="share-row"><span>{SECTION_LABEL[s]}</span><b>{n}</b></div>)}
            <div className="share-row"><span>{SECTION_LABEL.plan}</span><b>auto-built</b></div>
          </div>
          <div className="publish-checks">
            <Check ok={visible.length > 0} text={`${visible.length} approved claims will be shared`} />
            <Check ok={pending === 0} warn text={pending ? `${pending} pending claims will be left out until reviewed` : "Every claim has a review decision"} />
            <Check ok text={`${rejected} rejected claims will not be shared`} />
            <Check ok={unresolved === 0} warn text={unresolved ? `${unresolved} approved item(s) are still conflicting or missing — shown to ${project.successor} as unresolved` : "No unresolved conflicts or gaps in the approved set"} />
            {blocked > 0 && <Check ok={false} warn text={`${blocked} approved claim(s) cite sources ${project.successor} may not see — they are excluded automatically`} />}
          </div>
          <div className="row gap mt">
            <Button variant="primary" size="lg" icon={<LuSend />} loading={busy} disabled={!visible.length} onClick={publish}>Approve & publish v{nextVersion}</Button>
            <span className="muted small">Approved by <b>{project.reviewer}</b></span>
          </div>
        </Card>
        <Card>
          <h2 className="card-title"><LuEyeOff aria-hidden /> Withheld from a {project.successorRole === "lead" ? "Lead" : "Member"}</h2>
          {hidden.length ? (
            <div className="stack-sm">
              {hidden.map((s) => <div key={s.id} className="gate-item"><SourceIcon kind={s.kind} /> {s.name} <AccessBadge access={s.access} /></div>)}
              <p className="muted small">These sources were never sent to the extractor or AI for this handover, and nothing from them appears in the package. The successor only sees that {hidden.length} source{hidden.length === 1 ? " was" : "s were"} withheld.</p>
            </div>
          ) : <p className="muted">Nothing is withheld for this role.</p>}
        </Card>
      </div>

      <Card>
        <h2 className="card-title">Version history</h2>
        {!versions.length ? (
          <p className="muted">No version published yet. Each publish freezes a version; later changes create a new one.</p>
        ) : (
          <table className="table">
            <thead><tr><th>Version</th><th>Approved</th><th>By</th><th>Claims</th><th>Changes</th><th>Acknowledged</th><th /></tr></thead>
            <tbody>
              {[...versions].reverse().map((v) => {
                const pkg = getPackage(v.id) || v;
                return (
                  <tr key={v.id}>
                    <td><b>v{v.version}</b></td>
                    <td>{formatDateTime(v.approvedAt)}</td>
                    <td>{v.approvedBy}</td>
                    <td>{v.claims.length}</td>
                    <td className="small">{v.changes ? `+${v.changes.added.length} / −${v.changes.removed.length} / ✎${v.changes.edited.length} since v${v.changes.fromVersion}` : "first version"}</td>
                    <td className="small">{Object.keys(pkg.acknowledgements).length}/6 sections{pkg.flags.length ? ` · ${pkg.flags.length} flagged` : ""}</td>
                    <td className="row gap">
                      <Link to={`/h/${v.id}`} className="btn btn-ghost btn-sm"><LuExternalLink aria-hidden /><span>Open</span></Link>
                      <Button size="sm" variant="ghost" icon={<LuDownload />} onClick={() => download(`handover-v${v.version}.md`, packageMarkdown(v), "text/markdown")}>Markdown</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
      <StepFooter back="review" />
    </div>
  );
}

function Check({ ok, warn, text }: { ok: boolean; warn?: boolean; text: string }) {
  return <div className={ok ? "check ok" : warn ? "check warn" : "check bad"}>{ok ? <LuCircleCheck aria-hidden /> : <LuTriangleAlert aria-hidden />}<span>{text}</span></div>;
}
