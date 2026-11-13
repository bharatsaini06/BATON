import { useEffect, useRef, useState } from "react";
import { LuPlay, LuPlus, LuArrowRight } from "react-icons/lu";
import { api } from "../api";
import { saveProject } from "../store";
import { navigate } from "../router";
import { Button, cx, useToast } from "../ui";
import { newProject } from "./dashboard";

export async function startSample(toast: ReturnType<typeof useToast>) {
  const { project } = await api.sample();
  await saveProject(project);
  toast("success", "Sample project loaded — synthetic data only");
  navigate(`/p/${project.id}/sources?tour=1`);
}

// A small, synthetic excerpt of the sample project, used only to show how a fact points at its words.
const FACTS = [
  { id: "f1", status: "verified", label: "Verified", text: "Kabir Khan owns the leaderboard and the admin dashboard", src: "WhatsApp, 14 Oct" },
  { id: "f2", status: "verified", label: "Verified", text: "Ask Prof. Anita Rao before changing the payment flow", src: "WhatsApp, 14 Oct" },
  { id: "f3", status: "verified", label: "Verified", text: "Registration closes on 5 December 2026", src: "README, line 42" },
  { id: "f6", status: "missing", label: "Missing", text: "Who owns the domain name?", src: "No source says. Baton asks the leaver before they go." },
] as const;

const LEGS = [
  { who: "Leaver", lane: 1, name: "Connect", text: "The leaver adds the project's chats, GitHub and documents, or the team logs decisions from Discord while they work." },
  { who: "Baton", lane: 2, name: "Reconstruct", text: "Baton blacks out secrets, drops what the successor may not see, and pulls out small facts." },
  { who: "Baton", lane: 2, name: "Verify", text: "Code looks for each quote in its source and labels the fact Verified, Inferred, Conflicting or Missing." },
  { who: "Leaver", lane: 1, name: "Gap Interview", text: "The leaver answers a few questions, only about what the sources could not settle." },
  { who: "Reviewer", lane: 3, name: "Review", text: "A reviewer approves, edits or rejects every fact with its evidence beside it." },
  { who: "Successor", lane: 4, name: "Handover", text: "The successor gets a first-day plan, the people to know, and answers that show their source." },
];
const LANES = ["Leaver", "Baton", "Reviewer", "Successor"];
const still = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function Mark({ on, children }: { on: boolean; children: string }) {
  return <mark className={cx("hl", on && "on")}>{children}</mark>;
}

function Desk() {
  const [cur, setCur] = useState(0);
  const auto = useRef(true);
  useEffect(() => {
    if (still()) return;
    const t = setInterval(() => { if (auto.current && !document.hidden) setCur((c) => (c + 1) % FACTS.length); }, 2800);
    return () => clearInterval(t);
  }, []);
  const f = FACTS[cur]!;
  const pick = (i: number) => { auto.current = false; setCur(i); };
  const line = (id: string) => cx("ln", f.id === id && "hit");
  return (
    <div className="desk">
      <div className="stack" aria-hidden>
        <div className={cx("paper dim", f.status !== "missing" && "has")}>
          <span className="tape" />
          <div className="paper-head"><b>WhatsApp, Core team</b><span className="sp" /><span className="badge acc acc-member">Member</span></div>
          <div className="paper-body">
            <div className="ln"><span>Arjun, 8:58 pm</span><p>who is picking up the scoring stuff after the hackathon?</p></div>
            <div className={line("f1")}><span>Riya, 9:02 pm</span><p><Mark on={f.id === "f1"}>Kabir will handle the leaderboard and the admin dashboard</Mark> from now.</p></div>
            <div className="ln"><span>Riya, 9:04 pm</span><p>razorpay key is <span className="redact">[REDACTED key]</span> dont share</p></div>
            <div className={line("f2")}><span>Riya, 9:10 pm</span><p>also <Mark on={f.id === "f2"}>ping Prof. Rao before changing anything in the payment flow</Mark></p></div>
          </div>
        </div>
        <div className={cx("paper dim", f.status !== "missing" && "has")}>
          <div className="paper-head"><b>README.md</b><span>line 42</span><span className="sp" /><span className="badge acc acc-member">Member</span></div>
          <div className="paper-body">
            <div className={line("f3")}><span>Dates</span><p>Registration <Mark on={f.id === "f3"}>closes on 5 December 2026</Mark>; late entries go to the waitlist.</p></div>
          </div>
        </div>
      </div>
      <div className="facts">
        <span className="hand-note">every fact points at its words</span>
        {FACTS.map((x, i) => (
          <button key={x.id} type="button" className={cx("fact", i === cur && "cur")} onPointerEnter={() => pick(i)} onFocus={() => pick(i)} onClick={() => pick(i)}>
            <span className={cx("badge", `st-${x.status}`)}>{x.label}</span>
            <b>{x.text}</b>
            <small>{x.src}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function Relay() {
  const [cur, setCur] = useState(0);
  const [pts, setPts] = useState<number[][]>([]);
  const auto = useRef(true);
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const measure = () => {
      const el = box.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPts(Array.from(el.querySelectorAll(".leg")).map((l) => { const b = l.getBoundingClientRect(); return [b.left - r.left + b.width / 2, b.top - r.top + b.height / 2]; }));
    };
    measure();
    const t = setTimeout(measure, 600);
    addEventListener("resize", measure);
    return () => { clearTimeout(t); removeEventListener("resize", measure); };
  }, []);
  useEffect(() => {
    if (still()) return;
    const t = setInterval(() => {
      const el = box.current;
      if (!auto.current || !el || document.hidden) return;
      const r = el.getBoundingClientRect();
      if (r.top < innerHeight && r.bottom > 0) setCur((c) => (c + 1) % LEGS.length);
    }, 2400);
    return () => clearInterval(t);
  }, []);
  const p = pts[cur];
  return (
    <section className="relay-band">
      <div className="relay-in">
        <h2>A relay with four runners. You can always see who holds the baton.</h2>
        <div className="lanes-scroll">
          <div className="lanes" ref={box}>
            {LANES.map((l, i) => [
              <div key={l} className={cx("lane-l", i === 3 && "last")} style={{ gridRow: i + 1 }}>{l}</div>,
              <div key={l + "bg"} className={cx("lane-bg", i === 3 && "last")} style={{ gridRow: i + 1 }} />,
            ])}
            {LEGS.map((l, i) => (
              <button key={l.name} type="button" className={cx("leg", i === cur && "cur", i < cur && "done")} style={{ gridRow: l.lane, gridColumn: i + 2 }} onClick={() => { auto.current = false; setCur(i); }}>
                <span>{i + 1}</span>{l.name}
              </button>
            ))}
            <svg className="lane-path" aria-hidden><polyline points={pts.map((q) => q.join(",")).join(" ")} /></svg>
            {p && <i className="lane-baton" style={{ transform: `translate(${p[0]}px, ${p[1]! - 22}px) rotate(-18deg)` }} />}
          </div>
        </div>
        <div className="leg-text"><span>{LEGS[cur]!.who}</span><b>{LEGS[cur]!.name}</b><i /><p>{LEGS[cur]!.text}</p></div>
      </div>
    </section>
  );
}

export function Landing() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const sample = async () => {
    setBusy(true);
    try { await startSample(toast); } catch (e) { toast("danger", (e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="landing-desk">
      <div className="landing">
        <section className="hero">
          <div className="hero-copy">
            <h1>When someone leaves, <mark className="hl on hl-title">the project stays.</mark></h1>
            <p className="lead">
              Baton reads a project's authorised GitHub, documents, chats and task board, pulls out the facts the next person needs,
              and <strong>ties each one to the exact words it came from</strong>. The leaver fills the gaps, a reviewer approves, and the successor gets a role-safe plan.
            </p>
            <div className="hero-cta">
              <Button variant="primary" size="lg" icon={<LuPlay />} loading={busy} onClick={sample}>Try the sample project</Button>
              <Button size="lg" icon={<LuPlus />} onClick={async () => navigate(`/p/${(await newProject()).id}/setup`)}>Start your own handover</Button>
            </div>
            <p className="muted small">No sign-in. The sample is a synthetic coding-club project; your own projects stay in this browser until you publish a handover.</p>
          </div>
          <Desk />
        </section>
      </div>

      <Relay />

      <div className="landing">
        <section className="pillars">
          <div className="pillar">
            <h3>Status set by code, not by the AI</h3>
            <p>A fact is <em>Verified</em> only when its quoted words are found in a stored source. Everything else is visibly Inferred, Conflicting or Missing.</p>
          </div>
          <div className="pillar">
            <h3>Secrets and private notes stay out</h3>
            <p>Keys and passwords are blacked out on arrival. Each source is tagged Member, Lead only or Private, and the model never receives what the successor may not see.</p>
          </div>
          <div className="pillar">
            <h3>People sign it off</h3>
            <p>The leaver answers a short Gap Interview; a reviewer approves, edits or rejects every fact; the successor acknowledges what they received.</p>
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
    </div>
  );
}
