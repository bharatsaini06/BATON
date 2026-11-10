import { LuPlug, LuWorkflow, LuShieldCheck, LuMessageCircleQuestion, LuUserCheck, LuSend } from "react-icons/lu";
import { StatusBadge } from "../ui";

export const STEPS = [
  { icon: LuPlug, title: "Connect", who: "Leaver or admin", text: "Add the project's authorised sources — GitHub repo, documents, chat exports, task board — and tag who may see each. Secrets are redacted on arrival." },
  { icon: LuWorkflow, title: "Reconstruct", who: "Baton", text: "Only sources the successor may see go further. The AI (or the offline rules engine) proposes small claims: decisions, owners, open work, risks, dependencies, contacts." },
  { icon: LuShieldCheck, title: "Verify", who: "Baton", text: "Code checks every quote against the stored source, compares claims for conflicts, and runs a handover checklist to find what is missing." },
  { icon: LuMessageCircleQuestion, title: "Gap Interview", who: "Leaver", text: "The leaver answers only the questions Baton could not settle from sources. Answers are saved as dated testimony and cited." },
  { icon: LuUserCheck, title: "Review", who: "Reviewer", text: "A responsible person approves, edits or rejects each claim. Nothing is shared before approval." },
  { icon: LuSend, title: "Handover", who: "Successor", text: "The successor opens a role-safe handover with a Day 1 / Week 1 plan, sees the source behind every line, and acknowledges each section." },
];

export function HowItWorks() {
  return (
    <div className="how">
      <ol className="how-steps">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <span className="how-num">{i + 1}</span>
            <div>
              <strong>{s.title}</strong> <span className="muted small">· {s.who}</span>
              <p>{s.text}</p>
            </div>
          </li>
        ))}
      </ol>
      <h3>Evidence states</h3>
      <div className="how-states">
        <div><StatusBadge status="verified" /> The quoted words were found in a source the successor may see.</div>
        <div><StatusBadge status="inferred" /> An interpretation, or the quote could not be found — needs confirmation.</div>
        <div><StatusBadge status="conflicting" /> Two sources disagree. Both are shown; a human decides.</div>
        <div><StatusBadge status="missing" /> Something a handover needs, but no source covers it.</div>
      </div>
      <p className="muted small">Identity in this demo is chosen per step (leaver, reviewer, successor). In a production deployment each person signs in with their own account.</p>
    </div>
  );
}
