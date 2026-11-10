import { useState } from "react";
import { LuPlay, LuPlus, LuArrowRight, LuShieldCheck, LuScale, LuLock, LuQuote } from "react-icons/lu";
import { api } from "../api";
import { saveProject } from "../store";
import { navigate } from "../router";
import { Button, StatusBadge, useToast } from "../ui";
import { STEPS } from "./how";
import { newProject } from "./dashboard";

export async function startSample(toast: ReturnType<typeof useToast>) {
  const { project } = await api.sample();
  await saveProject(project);
  toast("success", "Sample project loaded — synthetic data only");
  navigate(`/p/${project.id}/sources?tour=1`);
}

export function Landing() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const sample = async () => {
    setBusy(true);
    try { await startSample(toast); } catch (e) { toast("danger", (e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="landing">
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">Knowledge handover · CodersInPune Hackathon</div>
          <h1>When someone leaves, pass on the project — not just the files.</h1>
          <p className="lead">
            Baton reads a project's authorised GitHub, documents, chats and task board, turns them into small claims,
            <strong> checks every claim against its source</strong>, asks the leaver only about the gaps, and gives the successor a
            role-safe plan once a human approves it.
          </p>
          <div className="hero-cta">
            <Button variant="primary" size="lg" icon={<LuPlay />} loading={busy} onClick={sample}>Try the sample project</Button>
            <Button size="lg" icon={<LuPlus />} onClick={async () => navigate(`/p/${(await newProject()).id}/setup`)}>Start your own handover</Button>
          </div>
          <p className="muted small">No sign-in. The sample is a synthetic coding-club project; your own projects stay in this browser until you publish a handover.</p>
        </div>
        <div className="hero-visual" aria-hidden>
          <div className="mock">
            <div className="mock-head">Review · Event app → Arjun (Member)</div>
            {[
              ["verified", "Kabir Khan owns the leaderboard and admin dashboard", "WhatsApp · 14 Oct"],
              ["conflicting", "Sponsor demo: 12 Dec or 20 Dec?", "2 sources disagree"],
              ["inferred", "Firebase free plan might run out in January", "needs confirmation"],
              ["missing", "Who owns the domain name?", "no source found"],
            ].map(([s, t, m]) => (
              <div className="mock-row" key={t}>
                <StatusBadge status={s as "verified"} />
                <span className="mock-text">{t}</span>
                <span className="mock-meta">{m}</span>
              </div>
            ))}
            <div className="mock-quote"><LuQuote aria-hidden /> “Kabir will handle the leaderboard and the admin dashboard.” — Riya, WhatsApp</div>
          </div>
        </div>
      </section>

      <section className="steps-strip">
        {STEPS.map((s, i) => (
          <div className="step-card" key={s.title}>
            <div className="step-top"><span className="step-n">{i + 1}</span><s.icon aria-hidden /></div>
            <strong>{s.title}</strong>
            <span className="muted small">{s.who}</span>
          </div>
        ))}
      </section>

      <section className="pillars">
        <div className="pillar">
          <LuShieldCheck className="pillar-icon" aria-hidden />
          <h3>Status set by code, not by the AI</h3>
          <p>A claim is <em>Verified</em> only when its quoted words are found in a stored source. Everything else is visibly Inferred, Conflicting or Missing.</p>
        </div>
        <div className="pillar">
          <LuLock className="pillar-icon" aria-hidden />
          <h3>Permission gate before the AI</h3>
          <p>Each source is tagged Member, Lead only or Private. The model never receives what the successor may not see, and secrets are redacted on arrival.</p>
        </div>
        <div className="pillar">
          <LuScale className="pillar-icon" aria-hidden />
          <h3>Humans decide</h3>
          <p>The leaver answers a short Gap Interview; a reviewer approves, edits or rejects every claim; the successor acknowledges what they received.</p>
        </div>
      </section>

      <section className="cta-band">
        <div>
          <h2>See the whole flow in about three minutes</h2>
          <p>Load the sample, run reconstruction, answer the Gap Interview, approve, and open the successor view.</p>
        </div>
        <Button variant="accent" size="lg" icon={<LuArrowRight />} loading={busy} onClick={sample}>Open the guided demo</Button>
      </section>
    </div>
  );
}
