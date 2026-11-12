import { useEffect, useState } from "react";
type FormEvent = any;
import { LuLogIn, LuUserPlus, LuShield, LuLink, LuRadio } from "react-icons/lu";
import { api, ApiError } from "../api";
import { setSession, refreshMe, setOrg, useSession } from "../session";
import { navigate, useQuery, Link } from "../router";
import { useHealth } from "../app";
import { Button, Callout, Card, Field, Segmented, Spinner, useToast } from "../ui";
import { ORG_ROLE_LABEL, type OrgRole } from "../../core/types";

export function AccountPage() {
  const q = useQuery();
  const next = q.get("next") || "/workspace";
  const { user } = useSession();
  const health = useHealth();
  const toast = useToast();
  const [mode, setMode] = useState<"login" | "signup">(q.get("mode") === "signup" ? "signup" : "login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState(q.get("email") || "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => { if (user) navigate(next, { replace: true }); }, [user, next]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setNotice(null);
    try {
      if (mode === "signup") {
        const r = await api.signup({ email, password, name });
        if (!r.session) { setNotice(r.message || "Check your email to confirm the account, then sign in."); setMode("login"); return; }
        setSession(r.session);
      } else {
        setSession((await api.login({ email, password })).session);
      }
      await refreshMe();
      toast("success", mode === "signup" ? "Account created" : "Signed in");
      navigate(next, { replace: true });
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page auth-page">
      <div className="auth-side">
        <div className="eyebrow">Workspaces</div>
        <h1>Sign in to hand over as a team.</h1>
        <p className="muted">The sample project works without an account. Signing in adds what a real team needs:</p>
        <ul className="auth-points">
          <li><LuShield aria-hidden /><div><b>Roles per person.</b> Members open only handovers filtered for Members; Leads and Owners manage projects.{health?.accounts?.rls ? " Enforced in the database with Row-Level Security." : ""}</div></li>
          <li><LuLink aria-hidden /><div><b>Signed share links.</b> Each link can expire and be revoked; approvals and acknowledgements carry a real name.</div></li>
          <li><LuRadio aria-hidden /><div><b>Live capture.</b> Decisions logged from Discord, Slack and GitHub arrive in the workspace as they happen.</div></li>
        </ul>
      </div>
      <Card className="auth-card">
        <Segmented label="Account" value={mode} onChange={(m) => { setMode(m); setError(null); }} options={[{ value: "login", label: <><LuLogIn aria-hidden /> Sign in</> }, { value: "signup", label: <><LuUserPlus aria-hidden /> Create account</> }]} />
        <form onSubmit={submit} className="auth-form">
          {mode === "signup" && <Field label="Your name" htmlFor="a-name" hint="Shown on approvals and acknowledgements."><input id="a-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={80} /></Field>}
          <Field label="Email" htmlFor="a-email"><input id="a-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></Field>
          <Field label="Password" htmlFor="a-pass" hint={mode === "signup" ? "At least 8 characters." : undefined}><input id="a-pass" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} required minLength={mode === "signup" ? 8 : 1} /></Field>
          {error && <Callout tone="danger">{error}</Callout>}
          {notice && <Callout tone="info">{notice}</Callout>}
          <Button type="submit" variant="primary" size="lg" loading={busy} icon={mode === "signup" ? <LuUserPlus /> : <LuLogIn />}>{mode === "signup" ? "Create account" : "Sign in"}</Button>
        </form>
        <p className="muted xsmall">Accounts: {health?.accounts?.mode === "supabase" ? "Supabase Auth; workspace data in Postgres with Row-Level Security." : "built-in accounts on this server (passwords stored as scrypt hashes)."} <Link to="/">Back to the demo</Link></p>
      </Card>
    </div>
  );
}

export function JoinPage({ token }: { token: string }) {
  const { user } = useSession();
  const toast = useToast();
  const [info, setInfo] = useState<{ orgName: string; role: OrgRole; email: string; invitedBy?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.inviteInfo(token).then((r) => setInfo(r.invite)).catch((e: ApiError) => setError(e.message)); }, [token]);

  const accept = async () => {
    setBusy(true);
    try {
      const { org } = await api.acceptInvite(token);
      await refreshMe();
      setOrg(org.id);
      toast("success", `You joined ${org.name}`);
      navigate("/workspace");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !info) return <div className="page narrow center-page"><h1>Invitation not available</h1><p className="muted">{error}</p><Link to="/" className="btn btn-primary btn-md"><span>Go to Baton</span></Link></div>;
  if (!info) return <div className="page"><Spinner label="Loading invitation…" /></div>;
  const here = `/join/${token}`;
  return (
    <div className="page narrow center-page">
      <div className="eyebrow">Invitation</div>
      <h1>Join “{info.orgName}”</h1>
      <p className="muted">{info.invitedBy ? `${info.invitedBy} invited` : "You are invited as"} <b>{info.email}</b> {info.invitedBy ? "as" : ""} <b>{ORG_ROLE_LABEL[info.role]}</b>.</p>
      {error && <Callout tone="danger">{error}</Callout>}
      {user ? (
        <Button variant="primary" size="lg" loading={busy} onClick={accept}>Accept as {user.name}</Button>
      ) : (
        <div className="row gap">
          <Link to={`/account?mode=signup&email=${encodeURIComponent(info.email)}&next=${encodeURIComponent(here)}`} className="btn btn-primary btn-lg"><span>Create account to join</span></Link>
          <Link to={`/account?email=${encodeURIComponent(info.email)}&next=${encodeURIComponent(here)}`} className="btn btn-secondary btn-lg"><span>I have an account</span></Link>
        </div>
      )}
    </div>
  );
}
