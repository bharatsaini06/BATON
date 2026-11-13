import { useCallback, useEffect, useState } from "react";
import { LuUsers, LuPlug, LuInbox, LuCopy, LuTrash2, LuUserPlus, LuGithub, LuSlack, LuMessagesSquare, LuCheck, LuClock, LuPlus, LuBuilding2, LuExternalLink, LuSend, LuBot, LuLogOut, LuBan } from "react-icons/lu";
import type { AccessTag, CaptureEvent, CaptureSource, OrgRole } from "../../core/types";
import { ORG_ROLE_LABEL } from "../../core/types";
import { captureLabel } from "../../core/capture";
import { LOG_LABEL } from "../../core/worklog";
import { formatDate, formatDateTime } from "../../core/text";
import { api, type Connector, type Invite, type Member, type WorkspacePackage } from "../api";
import { useSession, refreshMe, setOrg, setSession } from "../session";
import { useStore } from "../store";
import { navigate, Link } from "../router";
import { useHealth } from "../app";
import { AccessBadge, Button, Callout, Card, Empty, Field, Modal, Segmented, Spinner, copyText, useToast, cx } from "../ui";

type Tab = "members" | "connectors" | "capture" | "handovers";

export function SourceMark({ source }: { source: CaptureSource }) {
  const I = source === "github" ? LuGithub : source === "slack" ? LuSlack : LuMessagesSquare;
  return <span className={cx("src-mark", `src-mark-${source}`)} title={captureLabel(source)}><I aria-hidden /></span>;
}

export function WorkspacePage() {
  const { user, orgs, org, invites, loaded, loadError, session } = useSession();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("members");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!session) navigate("/account?next=/workspace", { replace: true }); }, [session]);
  if (!user) return null;
  if (!loaded && loadError) return (
    <div className="page narrow">
      <Callout tone="danger" title="Your workspace could not be loaded">{loadError}</Callout>
      <div className="row gap mt"><Button variant="primary" onClick={() => void refreshMe()}>Try again</Button><Button onClick={() => { setSession(null); navigate("/account?next=/workspace"); }}>Sign in again</Button></div>
    </div>
  );
  if (!loaded) return <div className="page"><Spinner label="Loading workspace…" /></div>;

  const create = async () => {
    setBusy(true);
    try {
      const { org: o } = await api.createOrg(name.trim());
      await refreshMe();
      setOrg(o.id);
      setCreating(false); setName("");
      toast("success", `Workspace “${o.name}” created — you are its owner`);
    } catch (e) { toast("danger", (e as Error).message); } finally { setBusy(false); }
  };
  const accept = async (token: string) => {
    try { const { org: o } = await api.acceptInvite(token); await refreshMe(); setOrg(o.id); toast("success", `You joined ${o.name}`); } catch (e) { toast("danger", (e as Error).message); }
  };
  const createForm = (
    <div className="row gap">
      <input className="input" placeholder="e.g. Coding Club 2026" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim().length > 1 && create()} aria-label="Workspace name" autoFocus />
      <Button variant="primary" loading={busy} disabled={name.trim().length < 2} onClick={create}>Create</Button>
    </div>
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Workspace</div>
          <h1>{org ? org.name : "Your workspace"}</h1>
          <p className="muted">Signed in as <b>{user.name}</b> ({user.email}){org && <> · your role: <span className={cx("role-pill", `role-${org.role}`)}>{ORG_ROLE_LABEL[org.role]}</span></>}</p>
        </div>
        <div className="row gap">
          {orgs.length > 1 && (
            <select className="select select-sm" value={org?.id} onChange={(e) => setOrg(e.target.value)} aria-label="Switch workspace">
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          {org && <Button icon={<LuPlus />} onClick={() => setCreating(true)}>New workspace</Button>}
          <Button variant="ghost" icon={<LuLogOut />} onClick={() => { setSession(null); navigate("/"); }}>Sign out</Button>
        </div>
      </div>

      {invites.map((i) => (
        <Callout key={i.token} tone="info" title={`You are invited to “${i.orgName}” as ${ORG_ROLE_LABEL[i.role]}`} action={<Button variant="primary" onClick={() => accept(i.token)}>Accept</Button>}>
          {i.invitedBy ? `Invited by ${i.invitedBy}.` : null}
        </Callout>
      ))}

      {!org ? (
        <Card>
          <Empty icon={<LuBuilding2 />} title="Create your team's workspace">
            <p>A workspace holds your team's members and roles, its projects, live connectors and published handovers. You become its owner.</p>
            {createForm}
          </Empty>
        </Card>
      ) : (
        <>
          <Segmented label="Workspace section" value={tab} onChange={setTab} options={[
            { value: "members", label: <><LuUsers aria-hidden /> Members &amp; roles</> },
            { value: "connectors", label: <><LuPlug aria-hidden /> Live connectors</>, disabled: org.role === "member", title: org.role === "member" ? "Leads and owners manage connectors" : undefined },
            { value: "capture", label: <><LuInbox aria-hidden /> Capture inbox</> },
            { value: "handovers", label: <><LuSend aria-hidden /> Handovers</> },
          ]} />
          <div className="ws-body">
            {tab === "members" && <MembersTab orgId={org.id} role={org.role} meId={user.id} />}
            {tab === "connectors" && <ConnectorsTab orgId={org.id} />}
            {tab === "capture" && <CaptureTab orgId={org.id} role={org.role} />}
            {tab === "handovers" && <HandoversTab orgId={org.id} />}
          </div>
        </>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="New workspace">{createForm}</Modal>
    </div>
  );
}

// ---------------------------------------------------------------- members

function MembersTab({ orgId, role, meId }: { orgId: string; role: OrgRole; meId: string }) {
  const toast = useToast();
  const [data, setData] = useState<{ members: Member[]; invites: Invite[] } | null>(null);
  const [email, setEmail] = useState("");
  const [as, setAs] = useState<OrgRole>("member");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.org(orgId).then(setData).catch((e) => toast("danger", (e as Error).message)), [orgId, toast]);
  useEffect(() => { setData(null); void load(); }, [load]);
  if (!data) return <Spinner label="Loading members…" />;
  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast("success", ok); await load(); await refreshMe(); } catch (e) { toast("danger", (e as Error).message); } };
  const invite = async () => {
    setBusy(true);
    try { const { invite: inv } = await api.invite(orgId, email.trim(), as); setEmail(""); await load(); const ok = await copyText(inv.url); toast("success", ok ? "Invitation created — link copied" : "Invitation created"); } catch (e) { toast("danger", (e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="two-col">
      <Card>
        <h2 className="card-title"><LuUsers aria-hidden /> Members</h2>
        <table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th><th /></tr></thead>
          <tbody>
            {data.members.map((m) => (
              <tr key={m.userId}>
                <td><b>{m.name}</b>{m.userId === meId && <span className="muted"> (you)</span>}</td>
                <td className="small">{m.email}</td>
                <td>
                  {role === "owner" ? (
                    <select className="select select-sm" value={m.role} aria-label={`Role of ${m.name}`} onChange={(e) => act(() => api.setRole(orgId, m.userId, e.target.value as OrgRole), `${m.name} is now ${ORG_ROLE_LABEL[e.target.value as OrgRole]}`)}>
                      {(["owner", "lead", "member"] as OrgRole[]).map((r) => <option key={r} value={r}>{ORG_ROLE_LABEL[r]}</option>)}
                    </select>
                  ) : <span className={cx("role-pill", `role-${m.role}`)}>{ORG_ROLE_LABEL[m.role]}</span>}
                </td>
                <td className="small">{formatDate(m.joinedAt)}</td>
                <td>{(role === "owner" || m.userId === meId) && <Button size="sm" variant="ghost" icon={<LuTrash2 />} aria-label={m.userId === meId ? "Leave workspace" : `Remove ${m.name}`} onClick={() => act(() => api.removeMember(orgId, m.userId), m.userId === meId ? "You left the workspace" : `${m.name} removed — their access ended`)} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="role-legend">
          <div><span className="role-pill role-member">Member</span> opens handovers published for Members and sees Member-tagged captured items.</div>
          <div><span className="role-pill role-lead">Lead</span> also works on projects, publishes, creates share links and connectors, sees Lead-only material.</div>
          <div><span className="role-pill role-owner">Owner</span> also changes roles and removes members.</div>
        </div>
      </Card>
      <Card>
        <h2 className="card-title"><LuUserPlus aria-hidden /> Invite a teammate</h2>
        {role === "member" ? <p className="muted">Only leads and owners can invite people.</p> : (
          <>
            <Field label="Email" htmlFor="inv-email"><input id="inv-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@college.edu" /></Field>
            <Field label="Role" htmlFor="inv-role" hint={role !== "owner" ? "Leads can invite Members. An owner invites Leads and Owners." : undefined}>
              <select id="inv-role" className="select" value={as} onChange={(e) => setAs(e.target.value as OrgRole)}>
                <option value="member">Member</option>
                {role === "owner" && <option value="lead">Lead</option>}
                {role === "owner" && <option value="owner">Owner</option>}
              </select>
            </Field>
            <Button variant="primary" icon={<LuUserPlus />} loading={busy} disabled={!/^\S+@\S+\.\S+$/.test(email.trim())} onClick={invite}>Create invitation link</Button>
            <p className="muted xsmall mt-xs">Baton does not send email. Share the link yourself; it only works for the invited address and only once.</p>
            {data.invites.length > 0 && (
              <div className="stack-sm mt">
                <div className="small strong">Pending invitations</div>
                {data.invites.map((i) => (
                  <div key={i.id} className="invite-row">
                    <div><b>{i.email}</b> <span className={cx("role-pill", `role-${i.role}`)}>{ORG_ROLE_LABEL[i.role]}</span><div className="muted xsmall mono clip">{i.url}</div></div>
                    <div className="row gap">
                      <Button size="sm" icon={<LuCopy />} onClick={async () => toast((await copyText(i.url)) ? "success" : "danger", "Invitation link copied")}>Copy</Button>
                      <Button size="sm" variant="ghost" icon={<LuTrash2 />} aria-label="Cancel invitation" onClick={() => act(() => api.cancelInvite(orgId, i.id), "Invitation cancelled")} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- connectors

const KIND_INFO: Record<CaptureSource, { title: string; blurb: string }> = {
  discord: { title: "Discord", blurb: "Team members type /baton decision … in your server; it lands here in seconds." },
  slack: { title: "Slack", blurb: "The same /baton command for Slack workspaces." },
  github: { title: "GitHub webhook", blurb: "Issue assignments, merged pull requests and “Decision:” / “Risk:” lines are captured automatically." },
};

function CopyRow({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const toast = useToast();
  const [show, setShow] = useState(!secret);
  return (
    <div className="copy-row">
      <span className="copy-label">{label}</span>
      <code className="copy-value">{show ? value : "•".repeat(Math.min(value.length, 24))}</code>
      {secret && <button className="link-btn" onClick={() => setShow(!show)}>{show ? "hide" : "show"}</button>}
      <Button size="sm" icon={<LuCopy />} onClick={async () => toast((await copyText(value)) ? "success" : "danger", `${label} copied`)}>Copy</Button>
    </div>
  );
}

function ConnectorsTab({ orgId }: { orgId: string }) {
  const toast = useToast();
  const health = useHealth();
  const { projects } = useStore();
  const [list, setList] = useState<Connector[] | null>(null);
  const [adding, setAdding] = useState<CaptureSource | null>(null);
  const [repo, setRepo] = useState("");
  const [projectId, setProjectId] = useState("");
  const [access, setAccess] = useState<AccessTag>("member");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.connectors(orgId).then((r) => setList(r.connectors)).catch((e) => toast("danger", (e as Error).message)), [orgId, toast]);
  useEffect(() => { setList(null); void load(); }, [load]);
  const mine = [...projects.values()].filter((p) => p.orgId === orgId);
  const c = health?.connectors;

  const add = async () => {
    if (!adding) return;
    setBusy(true);
    try { await api.addConnector(orgId, { kind: adding, repo: adding === "github" ? repo.trim() || undefined : undefined, projectId: projectId || undefined, defaultAccess: access }); setAdding(null); setRepo(""); await load(); toast("success", "Connector added — follow the steps to finish linking"); } catch (e) { toast("danger", (e as Error).message); } finally { setBusy(false); }
  };
  const register = async () => { try { toast("success", (await api.registerDiscord()).message); } catch (e) { toast("danger", (e as Error).message); } };

  if (!list) return <Spinner label="Loading connectors…" />;
  return (
    <div className="stack">
      <p className="muted">Connectors capture knowledge <b>while the work is happening</b>, so a handover is nearly ready before anyone leaves. Every request is verified by signature, secrets are redacted on arrival, and each item carries an access tag.</p>
      <div className="connector-grid">
        {(["discord", "github", "slack"] as CaptureSource[]).map((k) => {
          const ready = k === "github" ? true : k === "discord" ? !!c?.discord : !!c?.slack;
          return (
            <Card key={k} className="connector-card">
              <div className="row gap"><SourceMark source={k} /><h3>{KIND_INFO[k].title}</h3></div>
              <p className="muted small">{KIND_INFO[k].blurb}</p>
              {!ready && <p className="xsmall warn-text">Not enabled on this server: set {k === "discord" ? "DISCORD_PUBLIC_KEY" : "SLACK_SIGNING_SECRET"} (see docs/CONNECTORS.md).</p>}
              <Button size="sm" icon={<LuPlus />} onClick={() => setAdding(k)}>Add {KIND_INFO[k].title}</Button>
            </Card>
          );
        })}
      </div>

      {!list.length ? <Card><Empty icon={<LuPlug />} title="No connectors yet">Add Discord or a GitHub webhook above. Setup takes about two minutes.</Empty></Card> : list.map((x) => (
        <Card key={x.id}>
          <div className="row between top">
            <div className="row gap"><SourceMark source={x.kind} /><div><h3>{KIND_INFO[x.kind].title}{x.label ? ` · ${x.label}` : ""}</h3>
              <div className="muted xsmall">Added by {x.createdBy} · {formatDate(x.at)} · new items are <AccessBadge access={x.defaultAccess} />{x.projectId ? ` · goes to “${projects.get(x.projectId)?.title || "a project"}”` : " · goes to the workspace inbox"}</div></div></div>
            <div className="row gap">
              <span className={cx("chip", x.linked ? "chip-ok" : "chip-wait")}>{x.linked ? <><LuCheck aria-hidden /> Linked{x.externalId && x.kind === "github" ? ` · ${x.externalId}` : ""}</> : <><LuClock aria-hidden /> Waiting for first signal</>}</span>
              <Button size="sm" variant="ghost" icon={<LuTrash2 />} aria-label="Remove connector" onClick={async () => { try { await api.removeConnector(x.id); await load(); toast("success", "Connector removed"); } catch (e) { toast("danger", (e as Error).message); } }} />
            </div>
          </div>
          {x.kind === "github" ? (
            <ol className="setup-steps">
              <li>In the repository open <b>Settings → Webhooks → Add webhook</b>.</li>
              <li><CopyRow label="Payload URL" value={x.webhookUrl!} /></li>
              <li>Content type: <code>application/json</code></li>
              <li><CopyRow label="Secret" value={x.secret!} secret /></li>
              <li>Events: choose <b>Let me select</b> → <i>Issues, Issue comments, Pull requests, Pushes</i>. Save. GitHub sends a ping and this card turns to Linked.</li>
            </ol>
          ) : (
            <ol className="setup-steps">
              <li>{x.kind === "discord" ? <>In the Discord Developer Portal open your app → <b>General Information</b> and set the Interactions Endpoint URL:</> : <>In your Slack app create a slash command <code>/baton</code> with this Request URL:</>}<CopyRow label="Endpoint URL" value={x.endpointUrl!} /></li>
              {x.kind === "discord" && <li>Register the <code>/baton</code> command: <Button size="sm" icon={<LuBot />} disabled={!c?.discordCanRegister} onClick={register}>Register command</Button>{!c?.discordCanRegister && <span className="muted xsmall"> needs DISCORD_APP_ID and DISCORD_BOT_TOKEN on the server</span>}</li>}
              {x.kind === "discord" && <li>Add the app to your server: {c?.discordAppId ? <a href={`https://discord.com/oauth2/authorize?client_id=${c.discordAppId}&scope=applications.commands`} target="_blank" rel="noreferrer">open the install link <LuExternalLink aria-hidden /></a> : <span className="muted">install link appears once DISCORD_APP_ID is set</span>}</li>}
              <li>{x.kind === "discord" ? <>In the server type <code>/baton link</code> and paste this code:</> : <>In Slack run this once:</>}<CopyRow label={x.kind === "discord" ? "Code" : "Command"} value={x.kind === "discord" ? x.linkCode! : `/baton link ${x.linkCode}`} /></li>
              <li>Then log knowledge any time: <code>/baton decision</code>, <code>/baton risk</code>, <code>/baton task</code>, <code>/baton owner</code>, <code>/baton note</code>.</li>
            </ol>
          )}
        </Card>
      ))}

      <Modal open={!!adding} onClose={() => setAdding(null)} title={adding ? `Add ${KIND_INFO[adding].title}` : ""} footer={<><Button onClick={() => setAdding(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={add}>Add connector</Button></>}>
        {adding === "github" && <Field label="Repository (optional label)" htmlFor="c-repo"><input id="c-repo" className="input" placeholder="owner/name" value={repo} onChange={(e) => setRepo(e.target.value)} /></Field>}
        <Field label="Send captured items to" htmlFor="c-proj" hint="Items always appear in the workspace inbox; choosing a project also shows them in that project's Sources step.">
          <select id="c-proj" className="select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Workspace inbox only</option>
            {mine.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </Field>
        <Field label="Default visibility of captured items" htmlFor="c-acc" hint="A Lead-only item never reaches a Member's handover or a Member's inbox.">
          <select id="c-acc" className="select" value={access} onChange={(e) => setAccess(e.target.value as AccessTag)}>
            <option value="member">Member — any successor</option>
            <option value="lead">Lead only</option>
          </select>
        </Field>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------- capture inbox

export function CaptureItem({ e, actions }: { e: CaptureEvent; actions?: React.ReactNode }) {
  return (
    <div className={cx("capture-item", e.status !== "new" && "capture-done")}>
      <SourceMark source={e.source} />
      <div className="capture-main">
        <div><span className={cx("chip", `chip-${e.kind}`)}>{LOG_LABEL[e.kind]}</span> {e.text}{e.why ? <span className="muted"> — {e.why}</span> : null}</div>
        <div className="muted xsmall">{e.author} · {formatDateTime(e.at)}{e.owner ? ` · owner ${e.owner}` : ""}{e.due ? ` · due ${formatDate(e.due)}` : ""} · <AccessBadge access={e.access} />{e.url && <> · <a href={e.url} target="_blank" rel="noreferrer">open on {captureLabel(e.source)}</a></>}{e.status !== "new" && <> · <b>{e.status === "added" ? "added to a project" : "dismissed"}</b></>}</div>
      </div>
      {actions && <div className="row gap">{actions}</div>}
    </div>
  );
}

function CaptureTab({ orgId, role }: { orgId: string; role: OrgRole }) {
  const toast = useToast();
  const [events, setEvents] = useState<CaptureEvent[] | null>(null);
  const [filter, setFilter] = useState<"new" | "all">("new");
  const load = useCallback(() => api.capture(orgId, filter === "new" ? { status: "new" } : {}).then((r) => setEvents(r.events)).catch((e) => toast("danger", (e as Error).message)), [orgId, filter, toast]);
  useEffect(() => { setEvents(null); void load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, [load]);
  return (
    <Card>
      <div className="row between">
        <h2 className="card-title"><LuInbox aria-hidden /> Captured as it happened</h2>
        <Segmented label="Filter" value={filter} onChange={setFilter} options={[{ value: "new", label: "New" }, { value: "all", label: "All" }]} />
      </div>
      <p className="muted small">Items logged from Discord, Slack and GitHub. Open a project's <b>Sources → Live capture</b> to turn them into evidence for a handover. This list refreshes on its own.{role === "member" ? " As a Member you see Member-tagged items only." : ""}</p>
      {!events ? <Spinner label="Loading…" /> : !events.length ? <Empty icon={<LuInbox />} title={filter === "new" ? "Nothing new" : "Nothing captured yet"}>Link a connector, then try <code>/baton decision Use Razorpay because UPI is a must</code> in Discord.</Empty> : (
        <div className="capture-list">
          {events.map((e) => <CaptureItem key={e.id} e={e} actions={role !== "member" && e.status === "new" ? <Button size="sm" variant="ghost" icon={<LuBan />} onClick={async () => { try { await api.captureUpdate(orgId, [e.id], "dismissed"); await load(); } catch (err) { toast("danger", (err as Error).message); } }}>Dismiss</Button> : undefined} />)}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- handovers

function HandoversTab({ orgId }: { orgId: string }) {
  const toast = useToast();
  const [list, setList] = useState<WorkspacePackage[] | null>(null);
  useEffect(() => { setList(null); api.wsPackages(orgId).then((r) => setList(r.packages)).catch((e) => toast("danger", (e as Error).message)); }, [orgId, toast]);
  if (!list) return <Spinner label="Loading handovers…" />;
  return (
    <Card>
      <h2 className="card-title"><LuSend aria-hidden /> Published handovers you may open</h2>
      {!list.length ? <Empty icon={<LuSend />} title="No handovers yet">When a lead publishes a handover to this workspace it appears here for everyone whose role allows it.</Empty> : (
        <table className="table">
          <thead><tr><th>Handover</th><th>Version</th><th>For role</th><th>Approved by</th><th>Published</th><th /></tr></thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td><b>{p.title}</b></td><td>v{p.version}</td>
                <td><span className={cx("role-pill", `role-${p.role}`)}>{p.role === "lead" ? "Lead" : "Member"}</span></td>
                <td>{p.publishedBy}</td><td className="small">{formatDateTime(p.at)}</td>
                <td><Link to={`/h/${p.id}`} className="btn btn-ghost btn-sm"><LuExternalLink aria-hidden /><span>Open</span></Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
