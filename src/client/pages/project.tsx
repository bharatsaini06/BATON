import { createContext, useContext, useState, type ReactNode } from "react";
import { LuSettings, LuDatabase, LuWorkflow, LuMessageCircleQuestion, LuUserCheck, LuSend, LuHistory, LuCheck, LuX, LuLightbulb, LuChevronRight } from "react-icons/lu";
import type { Project } from "../../core/types";
import { readiness } from "../../core/plan";
import { sourcesFingerprint } from "../../core/permissions";
import { useStore, updateProject } from "../store";
import { Link, navigate, useQuery } from "../router";
import { Meter, Spinner, cx } from "../ui";
import { WorkspaceChip } from "../components/workspace-chip";
import { useSession } from "../session";
import { SetupStep } from "../steps/setup";
import { SourcesStep } from "../steps/sources";
import { ReconstructStep } from "../steps/reconstruct";
import { InterviewStep } from "../steps/interview";
import { ReviewStep } from "../steps/review";
import { PublishStep } from "../steps/publish";
import { ActivityStep } from "../steps/activity";

interface Ctx {
  project: Project;
  update: (fn: (p: Project) => Project, audit?: { actor: string; action: string; detail?: string }) => Promise<Project | undefined>;
  stale: boolean;
}
const ProjectCtx = createContext<Ctx | null>(null);
export const useProject = () => useContext(ProjectCtx)!;

export type StepKey = "setup" | "sources" | "reconstruct" | "interview" | "review" | "publish" | "activity";

const STEPS: { key: StepKey; label: string; icon: typeof LuSettings; actor: (p: Project) => string }[] = [
  { key: "setup", label: "Setup", icon: LuSettings, actor: () => "Leaver or admin" },
  { key: "sources", label: "Sources", icon: LuDatabase, actor: (p) => p.leaver || "Leaver or admin" },
  { key: "reconstruct", label: "Reconstruct", icon: LuWorkflow, actor: () => "Baton" },
  { key: "interview", label: "Gap Interview", icon: LuMessageCircleQuestion, actor: (p) => p.leaver || "Leaver" },
  { key: "review", label: "Review", icon: LuUserCheck, actor: (p) => p.reviewer || "Reviewer" },
  { key: "publish", label: "Handover", icon: LuSend, actor: (p) => p.reviewer || "Reviewer" },
];

export function stepState(p: Project, key: StepKey): { done: boolean; blocked?: string } {
  const ready = !!(p.leaver && p.successor && p.reviewer);
  switch (key) {
    case "setup": return { done: ready };
    case "sources": return { done: p.sources.some((s) => s.kind !== "testimony") };
    case "reconstruct": return { done: !!p.run, blocked: !ready ? "Name the leaver, successor and reviewer in Setup first." : !p.sources.length ? "Add at least one source first." : undefined };
    case "interview": return { done: p.questions.length > 0 && p.questions.every((q) => q.answer !== undefined || q.skipped), blocked: !p.run ? "Run Reconstruct first." : undefined };
    case "review": return { done: p.claims.length > 0 && p.claims.every((c) => c.review.decision !== "pending" || !!c.resolvedBy), blocked: !p.run ? "Run Reconstruct first." : undefined };
    case "publish": return { done: p.versions.length > 0, blocked: !p.claims.some((c) => c.review.decision === "approved" || c.review.decision === "edited") ? "Approve at least one claim in Review first." : undefined };
    default: return { done: false };
  }
}

const TOUR: Partial<Record<StepKey, ReactNode>> = {
  setup: <>This is who is involved. <b>Riya</b> is leaving, <b>Arjun</b> takes over as a <b>Member</b>, and <b>Prof. Anita Rao</b> reviews. Try switching Arjun to <i>Lead</i> later to see how the handover changes.</>,
  sources: <>The synthetic project's sources are already connected. Look at the <b>access tags</b>: the sponsor emails are <i>Lead only</i> and Riya's notes are <i>Private</i> — Arjun will never see them, and their secrets were redacted on arrival. Then open <b>Reconstruct</b>.</>,
  reconstruct: <>Run the pipeline. It shows each stage: permission gate, extraction, quote verification, conflict detection and the coverage checklist.</>,
  interview: <>You are now Riya. Answer the questions Baton could not settle from sources — for example, which sponsor-demo date is correct.</>,
  review: <>You are now the reviewer. Click any source chip to see the exact evidence, then approve, edit or reject. <b>Approve all verified</b> is a quick start.</>,
  publish: <>Publish the approved handover, then open the successor view to see exactly what Arjun receives — and what is hidden from him.</>,
};

export function ProjectPage({ id, step }: { id: string; step: string }) {
  const { ready, projects } = useStore();
  const q = useQuery();
  const [tourOff, setTourOff] = useState(false);
  const { user } = useSession();
  const project = projects.get(id);
  if (!ready) return <div className="page"><Spinner label="Loading project…" /></div>;
  if (!project)
    return (
      <div className="page narrow center-page">
        <h1>Project not found</h1>
        <p className="muted">Projects are stored in the browser where they were created. Open it there, or import its exported JSON file.</p>
        <Link to="/projects" className="btn btn-primary btn-md"><span>Go to projects</span></Link>
      </div>
    );
  const key = (["setup", "sources", "reconstruct", "interview", "review", "publish", "activity"].includes(step) ? step : "sources") as StepKey;
  const stale = !!project.run && project.runFingerprint !== sourcesFingerprint(project);
  const ctx: Ctx = { project, stale, update: (fn, audit) => updateProject(project.id, fn, audit) };
  const r = readiness(project.claims);
  const showTour = (q.get("tour") === "1" || project.isSample) && !tourOff && TOUR[key];
  const cur = STEPS.find((s) => s.key === key);

  return (
    <ProjectCtx.Provider value={ctx}>
      <div className="page wide">
        <div className="crumbs"><Link to="/projects">Projects</Link><LuChevronRight aria-hidden /><span>{project.title}</span></div>
        <div className="project-head">
          <div>
            <h1>{project.title}{project.isSample && <span className="chip chip-amber head-chip">Synthetic sample</span>}</h1>
            <div className="muted">
              {project.leaver ? <><b>{project.leaver}</b> → <b>{project.successor || "?"}</b> ({project.successorRole === "lead" ? "Lead" : "Member"}) · reviewer <b>{project.reviewer || "?"}</b></> : "Set up who is leaving and who takes over."}
            </div>
          </div>
          <div className="head-right">
          <WorkspaceChip project={project} />
          {project.claims.length > 0 && (
            <div className="head-meter">
              <Meter value={r.score} size={56} label="Handover readiness" />
              <div><div className="small strong">Readiness</div><div className="muted xsmall">{r.label}</div></div>
            </div>
          )}
          </div>
        </div>

        <nav className="stepper" aria-label="Handover steps">
          {STEPS.map((s, i) => {
            const st = stepState(project, s.key);
            return (
              <Link key={s.key} to={`/p/${project.id}/${s.key}`} className={cx("step", key === s.key && "current", st.done && "done", st.blocked && "blocked")} title={st.blocked}>
                <span className="step-dot">{st.done ? <LuCheck aria-hidden /> : i + 1}</span>
                <span className="step-label">{s.label}</span>
              </Link>
            );
          })}
          <Link to={`/p/${project.id}/activity`} className={cx("step step-aux", key === "activity" && "current")}>
            <span className="step-dot"><LuHistory aria-hidden /></span>
            <span className="step-label">Activity</span>
          </Link>
        </nav>

        {showTour && (
          <div className="tour">
            <LuLightbulb className="tour-icon" aria-hidden />
            <div>{TOUR[key]}</div>
            <button className="icon-btn" aria-label="Hide guide" onClick={() => setTourOff(true)}><LuX /></button>
          </div>
        )}
        {cur && key !== "reconstruct" && (
          <div className="acting">Acting as <b>{cur.actor(project)}</b>{key === "review" || key === "publish" ? " (reviewer)" : key === "interview" ? " (leaver)" : ""}<span className="muted">{project.orgId && user ? <> · signed in as <b>{user.name}</b>; publishing records your account as the approver</> : " · demo mode: identity is chosen per step"}</span></div>
        )}

        {key === "setup" && <SetupStep />}
        {key === "sources" && <SourcesStep />}
        {key === "reconstruct" && <ReconstructStep />}
        {key === "interview" && <InterviewStep />}
        {key === "review" && <ReviewStep />}
        {key === "publish" && <PublishStep />}
        {key === "activity" && <ActivityStep />}
      </div>
    </ProjectCtx.Provider>
  );
}

export function goStep(p: Project, s: StepKey) {
  navigate(`/p/${p.id}/${s}`);
}

export function StepFooter({ back, next, nextLabel, nextDisabled, nextHint }: { back?: StepKey; next?: StepKey; nextLabel?: string; nextDisabled?: boolean; nextHint?: string }) {
  const { project } = useProject();
  return (
    <div className="step-footer">
      {back ? <Link to={`/p/${project.id}/${back}`} className="btn btn-ghost btn-md"><span>← Back</span></Link> : <span />}
      {next && (
        <div className="row gap center-v">
          {nextHint && <span className="muted small">{nextHint}</span>}
          <button className="btn btn-primary btn-md" disabled={nextDisabled} onClick={() => goStep(project, next)}><span>{nextLabel || "Continue"} →</span></button>
        </div>
      )}
    </div>
  );
}
