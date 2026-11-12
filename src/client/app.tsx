import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { LuCpu, LuSparkles, LuCircleHelp, LuLogIn, LuBuilding2 } from "react-icons/lu";
import { api, type Health } from "./api";
import { usePath, match, Link, navigate } from "./router";
import { ToastProvider, Modal, cx } from "./ui";
import { Landing } from "./pages/landing";
import { Dashboard } from "./pages/dashboard";
import { ProjectPage } from "./pages/project";
import { SuccessorPage } from "./pages/successor";
import { HowItWorks } from "./pages/how";
import { AccountPage, JoinPage } from "./pages/account";
import { WorkspacePage } from "./pages/workspace";
import { useSession } from "./session";
import "./sync";

const HealthCtx = createContext<Health | null>(null);
export const useHealth = () => useContext(HealthCtx);

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth({ ok: false, version: "?", ai: { configured: false }, storage: { mode: "unknown", durable: false }, github: { token: false } }));
  }, []);
  return (
    <HealthCtx.Provider value={health}>
      <ToastProvider>
        <Routes />
      </ToastProvider>
    </HealthCtx.Provider>
  );
}

function Routes() {
  const path = usePath();
  let page: ReactNode;
  let m: Record<string, string> | null;
  if (path === "/") page = <Landing />;
  else if (path === "/projects") page = <Dashboard />;
  else if ((m = match("/p/:id", path))) { navigate(`/p/${m.id}/sources`, { replace: true }); page = null; }
  else if ((m = match("/p/:id/:step", path))) page = <ProjectPage id={m.id} step={m.step} />;
  else if ((m = match("/h/:pkg", path))) page = <SuccessorPage id={m.pkg} />;
  else if (path === "/account") page = <AccountPage />;
  else if (path === "/workspace") page = <WorkspacePage />;
  else if ((m = match("/join/:token", path))) page = <JoinPage token={m.token} />;
  else page = <NotFound />;
  const successor = path.startsWith("/h/");
  return (
    <div className={cx("shell", successor && "shell-successor")}>
      <Header minimal={successor} />
      <main className="main">{page}</main>
      <footer className="footer">
        <span>Baton · evidence-checked project handovers</span>
        <span>Demo data is synthetic. Built by Team ATHRAV for the CodersInPune Hackathon 2026.</span>
      </footer>
    </div>
  );
}

function Header({ minimal }: { minimal?: boolean }) {
  const health = useHealth();
  const [how, setHow] = useState(false);
  const path = usePath();
  const { user, org } = useSession();
  return (
    <header className="header">
      <div className="header-in">
        <Link to="/" className="brand" title="Baton home">
          <svg viewBox="0 0 64 64" width="28" height="28" aria-hidden><rect width="64" height="64" rx="14" fill="#0F1B3D" /><rect x="13" y="28" width="38" height="8" rx="4" fill="#E8890C" transform="rotate(-35 32 32)" /><circle cx="46" cy="18" r="5" fill="#fff" /></svg>
          <span>Baton</span>
        </Link>
        {!minimal && (
          <nav className="nav">
            <Link to="/projects" className={cx(path.startsWith("/projects") || path.startsWith("/p/") ? "active" : "")}>Projects</Link>
            {user && <Link to="/workspace" className={cx(path.startsWith("/workspace") ? "active" : "")}>Workspace</Link>}
            <button className="nav-btn" onClick={() => setHow(true)}><LuCircleHelp aria-hidden /> How it works</button>
          </nav>
        )}
        <div className="header-right">
          {health && (
            <span className={cx("engine-pill", health.ai.configured ? "engine-ai" : "engine-rules")} title={health.ai.configured ? `AI extraction via ${health.ai.providerLabel} (${health.ai.model}); quotes are always verified by code` : "No AI key configured on this server — the offline rules engine extracts claims. Verification works the same way."}>
              {health.ai.configured ? <LuSparkles aria-hidden /> : <LuCpu aria-hidden />}
              {health.ai.configured ? `AI: ${health.ai.providerLabel}` : "Rules engine (offline)"}
            </span>
          )}
          {user ? (
            <Link to="/workspace" className="account-pill" title={`Signed in as ${user.email}`}><span className="avatar avatar-sm">{user.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}</span><span className="account-name">{user.name}{org ? <small><LuBuilding2 aria-hidden /> {org.name}</small> : null}</span></Link>
          ) : (
            <Link to={`/account?next=${encodeURIComponent(path.startsWith("/h/") ? path + location.search : "/workspace")}`} className="btn btn-secondary btn-sm"><LuLogIn aria-hidden /><span>Sign in</span></Link>
          )}
        </div>
      </div>
      <Modal open={how} onClose={() => setHow(false)} title="How Baton works" wide>
        <HowItWorks />
      </Modal>
    </header>
  );
}

function NotFound() {
  return (
    <div className="page narrow center-page">
      <h1>Page not found</h1>
      <p className="muted">The link may be wrong, or the handover was created in another browser.</p>
      <Link to="/projects" className="btn btn-primary btn-md"><span>Go to projects</span></Link>
    </div>
  );
}
