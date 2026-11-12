import { useCallback, useEffect, useState } from "react";
import { LuSend, LuCopy, LuExternalLink, LuDownload, LuEyeOff, LuCircleCheck, LuTriangleAlert, LuLink, LuBan, LuPlus, LuLock } from "react-icons/lu";
import type { SectionKey } from "../../core/types";
import { SECTION_OF, SECTION_LABEL } from "../../core/types";
import { isShared, packageMarkdown } from "../../core/plan";
import { roleCanSee, chunkIndex, claimVisible } from "../../core/permissions";
import { formatDateTime } from "../../core/text";
import { api, type ShareLink } from "../api";
import { useSession } from "../session";
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
  const { user, orgs } = useSession();
  const ws = project.orgId && user ? orgs.find((o) => o.id === project.orgId) || null : null;
  const approver = ws && user ? user.name : project.reviewer;

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
      const r = ws ? await api.wsPublish(ws.id, project, prev) : await api.publish(project, project.reviewer, prev);
      await savePackage(r.package);
      await update(
        (p) => ({ ...p, stage: "published", versions: [...p.versions, { version: r.package.version, packageId: r.package.id, approvedAt: r.package.approvedAt, approvedBy: r.package.approvedBy, claimCount: r.package.claims.length }] }),
        { actor: approver, action: `Handover v${r.package.version} approved and published`, detail: `${r.package.claims.length} claims · ${r.package.plan.length} plan items · ${r.package.hiddenSources} sources withheld · storage: ${r.storage}` },
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
          <div className="small">{ws ? "This address opens only for signed-in workspace members with the right role. For anyone else, create a signed share link below." : last.durable ? "Stored on the server: anyone with this link can open it." : last.storage === "memory" || last.storage === "file" ? "Saved on this server temporarily and in this browser. For permanent links on any device, configure Upstash storage (see README)." : "Saved in this browser."}</div>
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
            <span className="muted small">Approved by <b>{approver}</b>{ws ? " (your account)" : ""}</span>
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

      {ws && versions.length > 0 && <LinksCard pkgId={versions.at(-1)!.id} version={versions.at(-1)!.version} successor={project.successor} canManage={ws.role !== "member"} />}
      {!ws && (
        <Callout tone="info" title="Signed share links need a workspace">
          {project.orgId ? "Sign in to publish into this project's workspace." : "This project is local to this browser, so its handover link is open to anyone who has it."} In a workspace, the approver is your account, each share link is signed, can expire and can be revoked, and acknowledgements carry a real name. <Link to={user ? "/workspace" : `/account?next=${encodeURIComponent(location.pathname)}`}>{user ? "Open workspace" : "Sign in"}</Link>
        </Callout>
      )}

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

const EXPIRY: { days: number | null; label: string }[] = [{ days: 1, label: "1 day" }, { days: 7, label: "7 days" }, { days: 30, label: "30 days" }, { days: null, label: "No expiry" }];

/** Signed share links for one published version: create with an expiry, copy, revoke, see opens. */
function LinksCard({ pkgId, version, successor, canManage }: { pkgId: string; version: number; successor: string; canManage: boolean }) {
  const toast = useToast();
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [days, setDays] = useState<string>("7");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.links(pkgId).then((r) => setLinks(r.links)).catch((e) => { setLinks([]); toast("danger", (e as Error).message); }), [pkgId, toast]);
  useEffect(() => { setLinks(null); void load(); }, [load]);
  const state = (l: ShareLink) => l.revokedAt ? "Revoked" : l.expiresAt && Date.parse(l.expiresAt) < Date.now() ? "Expired" : "Active";
  const create = async () => {
    setBusy(true);
    try {
      const r = await api.createLink(pkgId, days === "none" ? null : Number(days), label.trim() || `For ${successor}`);
      setLabel("");
      await load();
      const ok = await copyText(r.link.url);
      toast("success", ok ? "Share link created and copied" : "Share link created");
    } catch (e) { toast("danger", (e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Card>
      <h2 className="card-title"><LuLink aria-hidden /> Signed share links · v{version}</h2>
      <p className="muted small">A link lets one person open this version without an account. It is signed by the server, so it cannot be guessed or altered; it stops working when it expires or when you revoke it.</p>
      {canManage ? (
        <div className="row gap wrap mt">
          <input className="input" style={{ maxWidth: 240 }} placeholder={`Label, e.g. For ${successor}`} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} aria-label="Link label" />
          <select className="select" style={{ width: "auto" }} value={days} onChange={(e) => setDays(e.target.value)} aria-label="Expiry">
            {EXPIRY.map((x) => <option key={x.label} value={x.days === null ? "none" : String(x.days)}>{x.days === null ? x.label : `Expires in ${x.label}`}</option>)}
          </select>
          <Button variant="primary" icon={<LuPlus />} loading={busy} onClick={create}>Create share link</Button>
        </div>
      ) : <p className="small"><LuLock aria-hidden /> Only a Lead or Owner can create or revoke links.</p>}
      <div className="mt">
        {!links ? <p className="muted small">Loading links…</p> : !links.length ? <p className="muted small">No share links yet for this version.</p> : links.map((l) => {
          const st = state(l);
          return (
            <div key={l.id} className={st === "Active" ? "link-row" : "link-row link-dead"}>
              <div>
                <div><b>{l.label || "Share link"}</b> <span className={st === "Active" ? "badge badge-green" : "badge badge-muted"}>{st}</span></div>
                <div className="muted xsmall">Created {formatDateTime(l.at)}{l.createdBy ? ` by ${l.createdBy}` : ""} · {l.expiresAt ? `${st === "Expired" ? "expired" : "expires"} ${formatDateTime(l.expiresAt)}` : "no expiry"} · opened {l.opens} time{l.opens === 1 ? "" : "s"}{l.lastOpenedAt ? `, last ${formatDateTime(l.lastOpenedAt)}` : ""}</div>
                {st === "Active" && <div className="muted xsmall mono clip">{l.url}</div>}
              </div>
              {st === "Active" && (
                <div className="row gap">
                  <Button size="sm" icon={<LuCopy />} onClick={async () => { const ok = await copyText(l.url); toast(ok ? "success" : "danger", ok ? "Link copied" : "Copy failed"); }}>Copy</Button>
                  {canManage && <Button size="sm" variant="ghost" icon={<LuBan />} onClick={async () => { try { await api.revokeLink(l.id); await load(); toast("success", "Link revoked. It no longer opens."); } catch (e) { toast("danger", (e as Error).message); } }}>Revoke</Button>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
