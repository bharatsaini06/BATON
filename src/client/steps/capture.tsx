import { useCallback, useEffect, useState } from "react";
import { LuRadio, LuPlus, LuBan, LuPlug } from "react-icons/lu";
import type { AccessTag, CaptureEvent, LogEntry } from "../../core/types";
import { toLogEntry } from "../../core/capture";
import { api } from "../api";
import { useSession } from "../session";
import { Link } from "../router";
import { useProject } from "../pages/project";
import { CaptureItem } from "../pages/workspace";
import { WorkspaceChip } from "../components/workspace-chip";
import { Button, Callout, Empty, Spinner, useToast } from "../ui";

/** Sources → Live capture: items that arrived from Discord, Slack or GitHub become work-log evidence. */
export function CapturePanel() {
  const { project, update } = useProject();
  const { user, org, canEdit } = useSession();
  const toast = useToast();
  const [events, setEvents] = useState<CaptureEvent[] | null>(null);
  const [busy, setBusy] = useState(false);
  const orgId = project.orgId;
  const load = useCallback(() => (orgId && user ? api.capture(orgId, { status: "new", project: project.id }).then((r) => setEvents(r.events)).catch(() => setEvents([])) : Promise.resolve()), [orgId, user, project.id]);
  useEffect(() => { void load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, [load]);

  if (!user) return <Callout tone="info" title="Live capture needs a workspace" action={<Link to={`/account?next=${encodeURIComponent(location.pathname)}`} className="btn btn-primary btn-sm"><span>Sign in</span></Link>}>Sign in, save this project to a workspace, and connect Discord, Slack or a GitHub webhook. Decisions logged there arrive here as they happen.</Callout>;
  if (!orgId) return <Callout tone="info" title="Save this project to a workspace first" action={<WorkspaceChip project={project} />}>Captured items belong to a workspace{org ? "" : " — create one under Workspace"}. Private sources never leave this browser.</Callout>;

  const add = async (list: CaptureEvent[]) => {
    setBusy(true);
    try {
      const have = new Set(project.worklog.map((w) => w.id));
      const fresh: LogEntry[] = list.map(toLogEntry).filter((w) => !have.has(w.id));
      const entries = [...project.worklog, ...fresh];
      const existing: Partial<Record<AccessTag, string>> = {};
      for (const s of project.sources) if (s.kind === "worklog") existing[s.access] = s.id;
      const { sources } = await api.worklog(entries, existing);
      await update((p) => ({ ...p, worklog: entries, sources: [...p.sources.filter((s) => s.kind !== "worklog"), ...sources], stage: p.stage === "setup" ? "sources" : p.stage }),
        { actor: user.name, action: "Live capture added to the work log", detail: `${fresh.length} item${fresh.length === 1 ? "" : "s"} from ${[...new Set(list.map((e) => e.source))].join(", ")}` });
      await api.captureUpdate(orgId, list.map((e) => e.id), "added", project.id);
      toast("success", `${fresh.length} captured item${fresh.length === 1 ? "" : "s"} added as evidence. Re-run Reconstruct to use ${fresh.length === 1 ? "it" : "them"}.`);
      await load();
    } catch (e) { toast("danger", (e as Error).message); } finally { setBusy(false); }
  };
  const dismiss = async (e: CaptureEvent) => { try { await api.captureUpdate(orgId, [e.id], "dismissed"); await load(); } catch (err) { toast("danger", (err as Error).message); } };

  return (
    <div className="stack">
      <p className="muted small"><LuRadio aria-hidden /> Knowledge captured <b>as it happened</b> in Discord, Slack and GitHub. Adding an item puts it in the work log, so it passes the same permission gate, extraction and quote check as every other source.</p>
      {!events ? <Spinner label="Checking the inbox…" /> : !events.length ? (
        <Empty icon={<LuPlug />} title="No new captured items">
          <span>Connect a source under <Link to="/workspace">Workspace → Live connectors</Link>, then log something — for example <code>/baton decision …</code> in Discord.</span>
        </Empty>
      ) : (
        <>
          {canEdit && <Button variant="primary" icon={<LuPlus />} loading={busy} onClick={() => add(events)}>Add all {events.length} to the work log</Button>}
          <div className="capture-list">
            {events.map((e) => <CaptureItem key={e.id} e={e} actions={canEdit ? <><Button size="sm" icon={<LuPlus />} disabled={busy} onClick={() => add([e])}>Add</Button><Button size="sm" variant="ghost" icon={<LuBan />} aria-label="Dismiss" onClick={() => dismiss(e)} /></> : undefined} />)}
          </div>
        </>
      )}
    </div>
  );
}
