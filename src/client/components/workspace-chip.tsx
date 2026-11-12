import { useState } from "react";
import { LuCloud, LuCloudUpload, LuCloudOff, LuLogIn } from "react-icons/lu";
import type { Project } from "../../core/types";
import { useSession } from "../session";
import { attachToWorkspace, useSync } from "../sync";
import { Link } from "../router";
import { Button, useToast } from "../ui";

/** Shows whether a project lives in a workspace, and lets a lead or owner save it there. */
export function WorkspaceChip({ project, compact }: { project: Project; compact?: boolean }) {
  const { user, org, orgs, canEdit } = useSession();
  const sync = useSync(project.id);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (project.orgId) {
    const name = orgs.find((o) => o.id === project.orgId)?.name || "workspace";
    if (!user) return <span className="ws-chip ws-off" title="Sign in to sync changes to the workspace"><LuCloudOff aria-hidden /> {name} · signed out</span>;
    return (
      <span className={`ws-chip ${sync.status === "error" ? "ws-err" : "ws-on"}`} title={sync.status === "error" ? sync.message : "Saved to the workspace after each change. Private sources stay in this browser."}>
        {sync.status === "saving" ? <LuCloudUpload aria-hidden /> : sync.status === "error" ? <LuCloudOff aria-hidden /> : <LuCloud aria-hidden />}
        {name} · {sync.status === "saving" ? "saving…" : sync.status === "error" ? "not saved" : "synced"}
      </span>
    );
  }
  if (!user) return compact ? null : <Link to={`/account?next=${encodeURIComponent(location.pathname)}`} className="ws-chip ws-off" title="Sign in to save this project to a team workspace"><LuLogIn aria-hidden /> Local only · sign in to share</Link>;
  if (!org) return compact ? null : <Link to="/workspace" className="ws-chip ws-off"><LuCloudOff aria-hidden /> Local only · create a workspace</Link>;
  if (!canEdit) return null;
  return (
    <Button size="sm" icon={<LuCloudUpload />} loading={busy} onClick={async () => {
      setBusy(true);
      try { await attachToWorkspace(project, org.id); toast("success", `Saved to ${org.name}. Private sources stay in this browser.`); } catch (e) { toast("danger", (e as Error).message); } finally { setBusy(false); }
    }}>Save to {org.name}</Button>
  );
}
