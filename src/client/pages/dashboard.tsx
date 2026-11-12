import { useEffect, useRef, useState } from "react";
import { LuPlus, LuPlay, LuFolderOpen, LuUpload, LuTrash2, LuDownload, LuCloud, LuBuilding2 } from "react-icons/lu";
import type { Project } from "../../core/types";
import { readiness } from "../../core/plan";
import { useStore, saveProject, deleteProject } from "../store";
import { navigate, Link } from "../router";
import { Button, Card, Empty, Meter, Modal, Spinner, useToast } from "../ui";
import { startSample } from "./landing";
import { download } from "../files";
import { api, type WorkspaceProject } from "../api";
import { useSession } from "../session";
import { openFromWorkspace } from "../sync";
import { uid, formatDateTime } from "../../core/text";

export async function newProject(): Promise<Project> {
  const at = new Date().toISOString();
  return saveProject({
    id: uid("p"),
    title: "Untitled project",
    description: "",
    createdAt: at,
    updatedAt: at,
    people: [],
    leaver: "",
    successor: "",
    successorRole: "member",
    reviewer: "",
    sources: [],
    worklog: [],
    claims: [],
    questions: [],
    versions: [],
    audit: [{ at, actor: "You", action: "Project created" }],
    stage: "setup",
  });
}

export const STAGE_LABEL: Record<Project["stage"], string> = {
  setup: "Setup",
  sources: "Adding sources",
  generated: "Reconstructed",
  interviewed: "Gap Interview done",
  reviewed: "In review",
  published: "Handover published",
};

export function Dashboard() {
  const { ready, projects } = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Project | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const list = [...projects.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const importJson = async (f: File) => {
    try {
      const p = JSON.parse(await f.text()) as Project;
      if (!p.id || !Array.isArray(p.sources)) throw new Error("Not a Baton project file");
      await saveProject({ ...p, worklog: p.worklog || [], versions: p.versions || [], audit: p.audit || [], id: projects.has(p.id) ? uid("p") : p.id });
      toast("success", `Imported "${p.title}"`);
    } catch (e) {
      toast("danger", (e as Error).message);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Projects</h1>
          <p className="muted">Each project collects sources and work-log entries; when someone leaves, Baton builds their handover from it.</p>
        </div>
        <div className="row gap">
          <Button icon={<LuUpload />} onClick={() => fileRef.current?.click()}>Import</Button>
          <input ref={fileRef} type="file" accept=".json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
          <Button icon={<LuPlay />} loading={busy} onClick={async () => { setBusy(true); try { await startSample(toast); } catch (e) { toast("danger", (e as Error).message); } setBusy(false); }}>Load sample</Button>
          <Button variant="primary" icon={<LuPlus />} onClick={async () => navigate(`/p/${(await newProject()).id}/setup`)}>New project</Button>
        </div>
      </div>
      {!ready ? (
        <Spinner label="Loading…" />
      ) : !list.length ? (
        <Card>
          <Empty icon={<LuFolderOpen />} title="No projects yet">
            <p>Start with the synthetic sample to see the full workflow, or create a project for your own team.</p>
            <div className="row gap center">
              <Button variant="primary" icon={<LuPlay />} loading={busy} onClick={async () => { setBusy(true); try { await startSample(toast); } catch (e) { toast("danger", (e as Error).message); } setBusy(false); }}>Load sample project</Button>
              <Button icon={<LuPlus />} onClick={async () => navigate(`/p/${(await newProject()).id}/setup`)}>New project</Button>
            </div>
          </Empty>
        </Card>
      ) : (
        <div className="grid-cards">
          {list.map((p) => {
            const r = readiness(p.claims);
            return (
              <Card key={p.id} className="project-card">
                <Link to={`/p/${p.id}/${p.stage === "setup" ? "setup" : p.stage === "sources" ? "sources" : p.stage === "published" ? "publish" : "review"}`} className="project-link">
                  <div className="row between top">
                    <div>
                      <h3>{p.title}</h3>
                      <div className="muted small">{p.leaver ? `${p.leaver} → ${p.successor || "?"}` : "No leaver set yet"}</div>
                    </div>
                    {p.claims.length > 0 && <Meter value={r.score} size={52} label="Readiness" />}
                  </div>
                  <div className="project-meta">
                    <span className="chip">{STAGE_LABEL[p.stage]}</span>
                    {p.isSample && <span className="chip chip-amber">Sample</span>}
                    {p.orgId && <span className="chip"><LuCloud aria-hidden /> Workspace</span>}
                    <span className="muted small">{p.sources.length} sources · {p.claims.length} claims · v{p.versions.length}</span>
                  </div>
                  <div className="muted xsmall">Updated {formatDateTime(p.updatedAt)}</div>
                </Link>
                <div className="project-actions">
                  <Button size="sm" variant="ghost" icon={<LuDownload />} onClick={() => download(`${p.title.replace(/\W+/g, "-")}.baton.json`, JSON.stringify(p, null, 2), "application/json")}>Export</Button>
                  <Button size="sm" variant="ghost" icon={<LuTrash2 />} onClick={() => setConfirm(p)}>Delete</Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <WorkspaceProjects localIds={new Set(list.map((p) => p.id))} />
      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title="Delete project?"
        footer={<><Button onClick={() => setConfirm(null)}>Cancel</Button><Button variant="danger" onClick={async () => { await deleteProject(confirm!.id); setConfirm(null); toast("success", "Project deleted from this browser"); }}>Delete</Button></>}
      >
        <p>“{confirm?.title}” and its sources will be removed from this browser. Published handovers stay available at their links.</p>
      </Modal>
    </div>
  );
}

/** Projects saved to the signed-in person's workspace that are not on this device yet. */
function WorkspaceProjects({ localIds }: { localIds: Set<string> }) {
  const { user, org, canEdit } = useSession();
  const toast = useToast();
  const [items, setItems] = useState<WorkspaceProject[] | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  useEffect(() => {
    setItems(null);
    if (!user || !org || !canEdit) return;
    api.wsProjects(org.id).then((r) => setItems(r.projects)).catch(() => setItems([]));
  }, [user?.id, org?.id, canEdit]);
  const rest = (items || []).filter((p) => !localIds.has(p.id));
  if (!user || !org || !canEdit || !rest.length) return null;
  return (
    <Card className="mt">
      <h2 className="card-title"><LuBuilding2 aria-hidden /> In {org.name}, not on this device yet</h2>
      <table className="table">
        <thead><tr><th>Project</th><th>Last change</th><th /></tr></thead>
        <tbody>
          {rest.map((p) => (
            <tr key={p.id}>
              <td><b>{p.title}</b></td>
              <td className="small">{formatDateTime(p.updatedAt)}{p.updatedBy ? ` · ${p.updatedBy}` : ""}</td>
              <td><Button size="sm" loading={opening === p.id} onClick={async () => { setOpening(p.id); try { const pr = await openFromWorkspace(p.id); navigate(`/p/${pr.id}/sources`); } catch (e) { toast("danger", (e as Error).message); } setOpening(null); }}>Open here</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
