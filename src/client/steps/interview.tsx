import { useState } from "react";
import { LuSend, LuCircleCheck, LuMessageCircleQuestion } from "react-icons/lu";
import type { GapQuestion } from "../../core/types";
import { api } from "../api";
import { useProject, StepFooter, goStep } from "../pages/project";
import { Button, Callout, Card, Empty, useToast, cx } from "../ui";
import { formatDateTime } from "../../core/text";

const KIND: Record<GapQuestion["kind"], { label: string; cls: string }> = {
  conflict: { label: "Sources disagree", cls: "st-conflicting" },
  missing: { label: "Missing", cls: "st-missing" },
  inferred: { label: "Please confirm", cls: "st-inferred" },
};

export function InterviewStep() {
  const { project, update } = useProject();
  const toast = useToast();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [other, setOther] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const open = project.questions.filter((q) => q.answer === undefined && !q.skipped);
  const done = project.questions.filter((q) => q.answer !== undefined || q.skipped);
  const filled = Object.entries(answers).filter(([, v]) => v.trim()).length;

  const submit = async () => {
    setBusy(true);
    try {
      const payload = Object.fromEntries(Object.entries(answers).filter(([, v]) => v.trim()));
      const r = await api.interview({ leaver: project.leaver, successorRole: project.successorRole, sources: project.sources, claims: project.claims, questions: project.questions, answers: payload });
      await update((p) => ({ ...p, sources: r.sources, claims: r.claims, questions: r.questions, stage: "interviewed" }), {
        actor: project.leaver,
        action: "Gap Interview answered",
        detail: `${Object.keys(payload).length} answers · ${r.resolved} items resolved · ${r.unknown} confirmed unknown`,
      });
      setAnswers({});
      toast("success", `${r.resolved} item${r.resolved === 1 ? "" : "s"} resolved and saved as leaver testimony`);
    } catch (e) {
      toast("danger", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const skip = async (q: GapQuestion) => {
    await update((p) => ({ ...p, questions: p.questions.map((x) => (x.id === q.id ? { ...x, skipped: true } : x)) }), { actor: project.leaver, action: "Question skipped", detail: q.question });
  };

  if (!project.run) return <div className="step-body"><Callout tone="info">Run Reconstruct first — the Gap Interview is generated from what Baton could not settle.</Callout></div>;

  return (
    <div className="step-body">
      <Card className="intro-card">
        <LuMessageCircleQuestion className="intro-icon" aria-hidden />
        <div>
          <h2 className="card-title">Gap Interview for {project.leaver}</h2>
          <p className="muted">Baton only asks about what the sources could not settle: <b>conflicts</b>, <b>missing information</b> and <b>uncertain inferences</b>. Each answer is stored as dated <i>leaver testimony</i> and cited like any other source. Answer what you know; “I don't know” is a valid answer and is shown honestly to the successor.</p>
        </div>
      </Card>

      {!project.questions.length ? (
        <Card><Empty icon={<LuCircleCheck />} title="Nothing to ask">Every expected item was covered by the sources.</Empty></Card>
      ) : (
        <>
          {open.length > 0 && (
            <div className="questions">
              {open.map((q, i) => {
                const val = answers[q.id] || "";
                return (
                  <Card key={q.id} className="question">
                    <div className="q-head">
                      <span className="q-num">{i + 1}</span>
                      <span className={cx("badge", KIND[q.kind].cls)}>{KIND[q.kind].label}</span>
                    </div>
                    <h3 className="q-text">{q.question}</h3>
                    {q.context && <pre className="q-context">{q.context}</pre>}
                    {q.options ? (
                      <div className="q-options" role="radiogroup" aria-label={q.question}>
                        {q.options.map((o) => {
                          const isOther = /^(neither|partly)/i.test(o);
                          const checked = isOther ? !!other[q.id] : val === o && !other[q.id];
                          return (
                            <label key={o} className={cx("q-option", checked && "on")}>
                              <input type="radio" name={q.id} checked={checked} onChange={() => { setOther({ ...other, [q.id]: isOther }); setAnswers({ ...answers, [q.id]: isOther ? "" : o }); }} />
                              {o}
                            </label>
                          );
                        })}
                        {other[q.id] && <textarea className="textarea" rows={2} autoFocus placeholder="Your answer…" value={val} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />}
                      </div>
                    ) : (
                      <div className="q-free">
                        <textarea className="textarea" rows={2} placeholder="Your answer (e.g. a name, a date, or a short explanation)…" value={val} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />
                        <Button size="sm" variant="ghost" onClick={() => setAnswers({ ...answers, [q.id]: "I don't know" })}>I don't know</Button>
                      </div>
                    )}
                    <div className="q-foot">
                      <button className="link-btn" onClick={() => skip(q)}>Skip this question</button>
                    </div>
                  </Card>
                );
              })}
              <div className="sticky-submit">
                <span className="muted small">{filled} of {open.length} answered</span>
                <Button variant="primary" icon={<LuSend />} loading={busy} disabled={!filled} onClick={submit}>Submit answers</Button>
              </div>
            </div>
          )}
          {open.length === 0 && (
            <Callout tone="success" title="Interview complete" action={<Button variant="primary" onClick={() => goStep(project, "review")}>Go to review →</Button>}>
              All questions are answered or skipped. The reviewer will see the new testimony-backed claims.
            </Callout>
          )}
          {done.length > 0 && (
            <Card>
              <h3 className="card-title">Answered ({done.length})</h3>
              <div className="answered">
                {done.map((q) => (
                  <div key={q.id} className="answered-item">
                    <span className={cx("badge", KIND[q.kind].cls)}>{KIND[q.kind].label}</span>
                    <div>
                      <div className="small">{q.question}</div>
                      <div className="strong small">{q.skipped ? <span className="muted">Skipped</span> : `“${q.answer}”`} {q.answeredAt && <span className="muted xsmall">· {formatDateTime(q.answeredAt)}</span>}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
      <StepFooter back="reconstruct" next="review" nextLabel="Review the handover" />
    </div>
  );
}
