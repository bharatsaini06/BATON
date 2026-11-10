import { useRef, useState, type DragEvent } from "react";
import { LuUpload, LuGithub, LuClipboardPaste, LuNotebookPen, LuTrash2, LuEye, LuShieldCheck, LuEyeOff, LuDownload, LuTriangleAlert, LuPlus } from "react-icons/lu";
import type { AccessTag, LogEntry, LogKind, Source } from "../../core/types";
import { roleCanSee } from "../../core/permissions";
import { totalRedactions } from "../../core/redact";
import { LOG_LABEL } from "../../core/worklog";
import { formatDate, formatDateTime, uid } from "../../core/text";
import { api } from "../api";
import { readFile, ACCEPT } from "../files";
import { useProject, StepFooter } from "../pages/project";
import { AccessBadge, AccessSelect, Button, Callout, Card, Drawer, Empty, Field, Modal, Segmented, SourceIcon, useToast, cx } from "../ui";
import { SAMPLE_NAMES } from "./sample-files";

const KIND_LABEL: Record<Source["kind"], string> = { github: "GitHub repository", chat: "Chat export", document: "Document", tasks: "Task board", worklog: "Work log", testimony: "Leaver testimony" };

export function SourcesStep() {
  const { project, update, stale } = useProject();
  const toast = useToast();
  const [tab, setTab] = useState<"upload" | "github" | "paste" | "worklog">("upload");
  const [view, setView] = useState<Source | null>(null);
  const [remove, setRemove] = useState<Source | null>(null);

  const sources = project.sources;
  const hidden = sources.filter((s) => !roleCanSee(project.successorRole, s.access));
  const redactions = sources.reduce((n, s) => n + totalRedactions(s.stats.redactions), 0);
  const chunks = sources.reduce((n, s) => n + s.chunks.length, 0);

  const addSource = async (s: Source) => {
    await update((p) => ({ ...p, sources: [...p.sources, s], stage: p.stage === "setup" ? "sources" : p.stage }), {
      actor: project.leaver || "You",
      action: "Source added",
      detail: `${s.name} (${KIND_LABEL[s.kind]}, ${s.access}) — ${s.chunks.length} chunks${totalRedactions(s.stats.redactions) ? `, ${totalRedactions(s.stats.redactions)} redactions` : ""}`,
    });
  };

  const setAccess = async (s: Source, access: AccessTag) => {
    await update((p) => ({ ...p, sources: p.sources.map((x) => (x.id === s.id ? { ...x, access, chunks: x.chunks.map((c) => ({ ...c, access })) } : x)) }), { actor: project.leaver || "You", action: "Access changed", detail: `${s.name}: ${s.access} → ${access}` });
    toast("info", `${s.name} is now ${access === "private" ? "Private" : access === "lead" ? "Lead only" : "visible to Members"}`);
  };

  return (
    <div className="step-body">
      {stale && <Callout tone="warn" title="Sources changed since the last reconstruction">Re-run Reconstruct so the handover reflects the current sources and access tags.</Callout>}
      <div className="stats-row">
        <Stat label="Sources" value={sources.length} />
        <Stat label="Chunks indexed" value={chunks} />
        <Stat label="Secrets redacted" value={redactions} tone={redactions ? "green" : undefined} icon={<LuShieldCheck />} />
        <Stat label={`Hidden from ${project.successor || "successor"} (${project.successorRole})`} value={hidden.length} tone={hidden.length ? "amber" : undefined} icon={<LuEyeOff />} />
      </div>

      <div className="sources-layout">
        <div>
          <h2 className="section-title">Connected sources</h2>
          {!sources.length ? (
            <Card><Empty title="No sources yet">Upload files, connect a GitHub repository, paste notes, or log decisions in the work log.</Empty></Card>
          ) : (
            <div className="source-list">
              {sources.map((s) => (
                <Card key={s.id} className={cx("source-card", !roleCanSee(project.successorRole, s.access) && "source-hidden")}>
                  <div className="source-main">
                    <SourceIcon kind={s.kind} />
                    <div className="source-info">
                      <div className="source-name">{s.name}</div>
                      <div className="muted small">
                        {KIND_LABEL[s.kind]} · {s.chunks.length} chunk{s.chunks.length === 1 ? "" : "s"}
                        {s.meta?.messages ? ` · ${s.meta.messages} messages` : ""}
                        {s.meta?.issues !== undefined ? ` · ${s.meta.issues} issues/PRs · ${s.meta.commits} commits` : ""}
                        {s.meta?.entries ? ` · ${s.meta.entries} entr${s.meta.entries === 1 ? "y" : "ies"}` : ""}
                        {" · added "}{formatDate(s.addedAt)}
                      </div>
                      <div className="source-tags">
                        <AccessBadge access={s.access} />
                        {totalRedactions(s.stats.redactions) > 0 && (
                          <span className="badge badge-green" title={Object.entries(s.stats.redactions).map(([k, v]) => `${v} ${k.replace("_", " ")}`).join(", ")}>
                            <LuShieldCheck aria-hidden /> {totalRedactions(s.stats.redactions)} redacted
                          </span>
                        )}
                        {!roleCanSee(project.successorRole, s.access) && <span className="badge badge-muted"><LuEyeOff aria-hidden /> withheld from {project.successorRole}</span>}
                        {s.warnings.map((w) => <span key={w} className="badge badge-warn" title={w}><LuTriangleAlert aria-hidden /> {w.length > 48 ? w.slice(0, 46) + "…" : w}</span>)}
                      </div>
                    </div>
                  </div>
                  <div className="source-actions">
                    {s.kind === "worklog" || s.kind === "testimony" ? (
                      <span className="muted xsmall">{s.kind === "worklog" ? "Managed in the work log" : "From the Gap Interview"}</span>
                    ) : (
                      <AccessSelect compact value={s.access} onChange={(a) => setAccess(s, a)} />
                    )}
                    <Button size="sm" variant="ghost" icon={<LuEye />} onClick={() => setView(s)}>View</Button>
                    {s.kind !== "worklog" && <Button size="sm" variant="ghost" icon={<LuTrash2 />} aria-label={`Remove ${s.name}`} onClick={() => setRemove(s)} />}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        <Card className="add-panel">
          <h2 className="card-title">Add authorised sources</h2>
          <Segmented
            label="Source type"
            value={tab}
            onChange={setTab}
            options={[
              { value: "upload", label: <><LuUpload aria-hidden /> Files</> },
              { value: "github", label: <><LuGithub aria-hidden /> GitHub</> },
              { value: "paste", label: <><LuClipboardPaste aria-hidden /> Paste</> },
              { value: "worklog", label: <><LuNotebookPen aria-hidden /> Work log</> },
            ]}
          />
          <div className="add-body">
            {tab === "upload" && <UploadPanel onAdd={addSource} />}
            {tab === "github" && <GithubPanel onAdd={addSource} />}
            {tab === "paste" && <PastePanel onAdd={addSource} />}
            {tab === "worklog" && <WorklogPanel />}
          </div>
          <p className="muted xsmall add-note">Only add sources you are authorised to share. Text is redacted for keys, passwords, emails and phone numbers before it is stored.</p>
        </Card>
      </div>

      <StepFooter back="setup" next="reconstruct" nextLabel="Reconstruct the handover" nextDisabled={!sources.length || !project.leaver} nextHint={!project.leaver ? "Complete Setup first" : undefined} />

      <SourceDrawer source={view} onClose={() => setView(null)} />
      <Modal
        open={!!remove}
        onClose={() => setRemove(null)}
        title="Remove source?"
        footer={<><Button onClick={() => setRemove(null)}>Cancel</Button><Button variant="danger" onClick={async () => { const s = remove!; await update((p) => ({ ...p, sources: p.sources.filter((x) => x.id !== s.id) }), { actor: project.leaver || "You", action: "Source removed", detail: s.name }); setRemove(null); }}>Remove</Button></>}
      >
        <p>“{remove?.name}” will be removed from this project. Claims that cite it will lose their evidence when you re-run Reconstruct.</p>
      </Modal>
    </div>
  );
}

function Stat({ label, value, tone, icon }: { label: string; value: number | string; tone?: "green" | "amber"; icon?: React.ReactNode }) {
  return (
    <div className={cx("stat", tone && `stat-${tone}`)}>
      <div className="stat-val">{icon}{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export function SourceDrawer({ source, onClose, highlight }: { source: Source | null; onClose: () => void; highlight?: string }) {
  return (
    <Drawer open={!!source} onClose={onClose} title={source?.name || ""} subtitle={source && <><AccessBadge access={source.access} /> <span className="muted small">{source.chunks.length} chunks</span></>}>
      {source?.chunks.map((c) => (
        <div key={c.id} className={cx("chunk", highlight === c.id && "chunk-hl")} id={`chunk-${c.id}`}>
          <div className="chunk-meta">
            {c.locator.url ? <a href={c.locator.url} target="_blank" rel="noreferrer noopener">{c.locator.label}</a> : <span>{c.locator.label}</span>}
            <span className="muted xsmall">{c.id}</span>
          </div>
          <pre className="chunk-text">{c.text}</pre>
        </div>
      ))}
    </Drawer>
  );
}

// ---------------------------------------------------------------- upload

function UploadPanel({ onAdd }: { onAdd: (s: Source) => Promise<void> }) {
  const { project } = useProject();
  const toast = useToast();
  const [access, setAccess] = useState<AccessTag>("member");
  const [busy, setBusy] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const handle = async (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      setBusy((b) => [...b, f.name]);
      try {
        const rf = await readFile(f);
        const { source } = await api.upload({ ...rf, access, addedBy: project.leaver || undefined });
        await onAdd(source);
        toast("success", `${f.name}: ${source.chunks.length} chunks${totalRedactions(source.stats.redactions) ? `, ${totalRedactions(source.stats.redactions)} secrets redacted` : ""}`);
      } catch (e) {
        toast("danger", (e as Error).message);
      } finally {
        setBusy((b) => b.filter((n) => n !== f.name));
      }
    }
  };
  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) void handle(e.dataTransfer.files); };

  return (
    <div className="stack">
      <Field label="Access for these files" htmlFor="up-access"><AccessSelect id="up-access" value={access} onChange={setAccess} /></Field>
      <div
        className={cx("dropzone", over && "over")}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        onClick={() => input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
      >
        <LuUpload className="dz-icon" aria-hidden />
        <div><strong>Drop files here</strong> or click to choose</div>
        <div className="muted xsmall">WhatsApp .txt export · Discord/Slack .json · PDF · DOCX · Markdown · TXT · task board .csv (max 4 MB each)</div>
        <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { if (e.target.files) void handle(e.target.files); e.target.value = ""; }} />
      </div>
      {busy.length > 0 && <div className="muted small">Processing {busy.join(", ")}…</div>}
      <details className="sample-files">
        <summary><LuDownload aria-hidden /> Synthetic sample files to test uploads</summary>
        <ul>{SAMPLE_NAMES.map((n) => <li key={n}><a href={`/samples/${n}`} download>{n}</a></li>)}</ul>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------- GitHub

function GithubPanel({ onAdd }: { onAdd: (s: Source) => Promise<void> }) {
  const { project } = useProject();
  const toast = useToast();
  const [repo, setRepo] = useState("");
  const [access, setAccess] = useState<AccessTag>("member");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const { source } = await api.github({ repo, access, addedBy: project.leaver || undefined });
      await onAdd(source);
      setRepo("");
      toast("success", `${source.name}: ${source.meta?.issues} issues/PRs, ${source.meta?.commits} commits, README ${source.meta?.readme ? "imported" : "not found"}`);
    } catch (e) {
      toast("danger", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <Field label="Repository" htmlFor="gh-repo" hint="Public repositories work without setup. Baton reads README, issues, pull requests, comments and recent commits — read-only.">
        <input id="gh-repo" className="input" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/name or https://github.com/owner/name" onKeyDown={(e) => e.key === "Enter" && repo && go()} />
      </Field>
      <Field label="Access" htmlFor="gh-access"><AccessSelect id="gh-access" value={access} onChange={setAccess} /></Field>
      <Button variant="primary" icon={<LuGithub />} loading={busy} disabled={!repo.trim()} onClick={go}>Import repository</Button>
    </div>
  );
}

// ---------------------------------------------------------------- paste

function PastePanel({ onAdd }: { onAdd: (s: Source) => Promise<void> }) {
  const { project } = useProject();
  const toast = useToast();
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [access, setAccess] = useState<AccessTag>("member");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const { source } = await api.upload({ name: name.trim() || `Pasted notes ${formatDateTime(new Date().toISOString())}`, text, access, addedBy: project.leaver || undefined });
      await onAdd(source);
      setName(""); setText("");
      toast("success", `Added ${source.name} (${source.chunks.length} chunks)`);
    } catch (e) {
      toast("danger", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <Field label="Name" htmlFor="p-name"><input id="p-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Meeting notes 3 Nov.md" /></Field>
      <Field label="Text" htmlFor="p-text" hint="Paste meeting notes, a chat export or a document. Chat exports are detected automatically."><textarea id="p-text" className="textarea mono" rows={8} value={text} onChange={(e) => setText(e.target.value)} /></Field>
      <Field label="Access" htmlFor="p-access"><AccessSelect id="p-access" value={access} onChange={setAccess} /></Field>
      <Button variant="primary" icon={<LuPlus />} loading={busy} disabled={!text.trim()} onClick={go}>Add text source</Button>
    </div>
  );
}

// ---------------------------------------------------------------- work log (continuous capture)

function WorklogPanel() {
  const { project, update } = useProject();
  const toast = useToast();
  const names = project.people.map((p) => p.name);
  const [kind, setKind] = useState<LogKind>("decision");
  const [text, setText] = useState("");
  const [why, setWhy] = useState("");
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("");
  const [author, setAuthor] = useState(project.leaver || names[0] || "");
  const [access, setAccess] = useState<AccessTag>("member");
  const [busy, setBusy] = useState(false);

  const save = async (entries: LogEntry[], action: string, detail: string) => {
    setBusy(true);
    try {
      const existing: Partial<Record<AccessTag, string>> = {};
      for (const s of project.sources) if (s.kind === "worklog") existing[s.access] = s.id;
      const { sources } = await api.worklog(entries, existing);
      await update((p) => ({ ...p, worklog: entries, sources: [...p.sources.filter((s) => s.kind !== "worklog"), ...sources] }), { actor: author || "You", action, detail });
      return true;
    } catch (e) {
      toast("danger", (e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const e: LogEntry = { id: uid("w"), kind, text: text.trim().replace(/\.$/, ""), why: why.trim() || undefined, owner: owner.trim() || undefined, due: due || undefined, author: author.trim() || "Unknown", at: new Date().toISOString(), access };
    if (await save([...project.worklog, e], "Work log entry added", `${LOG_LABEL[kind]}: ${e.text}`)) {
      setText(""); setWhy(""); setOwner(""); setDue("");
      toast("success", "Logged. It becomes evidence the next time you reconstruct.");
    }
  };

  return (
    <div className="stack">
      <p className="muted small">Capture knowledge <b>while the work is happening</b> — decisions and their reasons, risks, tasks and contacts. Each entry is dated, attributed and access-tagged.</p>
      <Segmented label="Entry type" value={kind} onChange={setKind} options={(Object.keys(LOG_LABEL) as LogKind[]).map((k) => ({ value: k, label: LOG_LABEL[k] }))} />
      <Field label={kind === "decision" ? "What was decided?" : kind === "risk" ? "What could go wrong?" : kind === "task" ? "What needs doing?" : kind === "contact" ? "Who to contact, for what?" : "Note"} htmlFor="w-text">
        <input id="w-text" className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={kind === "decision" ? "Use Razorpay instead of Stripe" : ""} />
      </Field>
      {(kind === "decision" || kind === "risk") && (
        <Field label={kind === "decision" ? "Why? (the reasoning successors usually lose)" : "Impact"} htmlFor="w-why"><input id="w-why" className="input" value={why} onChange={(e) => setWhy(e.target.value)} /></Field>
      )}
      {(kind === "task" || kind === "risk") && (
        <div className="grid-2">
          <Field label="Owner" htmlFor="w-owner"><input id="w-owner" className="input" list="w-people" value={owner} onChange={(e) => setOwner(e.target.value)} /></Field>
          <Field label="Due" htmlFor="w-due"><input id="w-due" type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        </div>
      )}
      <div className="grid-2">
        <Field label="Logged by" htmlFor="w-author"><input id="w-author" className="input" list="w-people" value={author} onChange={(e) => setAuthor(e.target.value)} /></Field>
        <Field label="Access" htmlFor="w-access"><AccessSelect id="w-access" value={access} onChange={setAccess} /></Field>
      </div>
      <datalist id="w-people">{names.map((n) => <option key={n} value={n} />)}</datalist>
      <Button variant="primary" icon={<LuNotebookPen />} loading={busy} disabled={!text.trim()} onClick={add}>Add to work log</Button>
      {project.worklog.length > 0 && (
        <div className="worklog-list">
          <div className="small strong">{project.worklog.length} entries</div>
          {[...project.worklog].sort((a, b) => b.at.localeCompare(a.at)).map((e) => (
            <div key={e.id} className="worklog-item">
              <span className={cx("chip", `chip-${e.kind}`)}>{LOG_LABEL[e.kind]}</span>
              <div className="worklog-text">
                <div>{e.text}{e.why ? <span className="muted"> — {e.why}</span> : null}</div>
                <div className="muted xsmall">{e.author} · {formatDate(e.at)}{e.owner ? ` · owner ${e.owner}` : ""}{e.due ? ` · due ${formatDate(e.due)}` : ""} · <AccessBadge access={e.access} /></div>
              </div>
              <button className="icon-btn" aria-label="Delete entry" onClick={() => save(project.worklog.filter((x) => x.id !== e.id), "Work log entry removed", e.text)}><LuTrash2 /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
