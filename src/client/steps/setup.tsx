import { useState } from "react";
import { LuPlus, LuTrash2, LuSave } from "react-icons/lu";
import type { Person, SuccessorRole } from "../../core/types";
import { useProject, goStep } from "../pages/project";
import { Button, Card, Field, Segmented, useToast, Callout } from "../ui";

export function SetupStep() {
  const { project, update } = useProject();
  const toast = useToast();
  const [title, setTitle] = useState(project.title);
  const [description, setDescription] = useState(project.description);
  const [people, setPeople] = useState<Person[]>(project.people.length ? project.people : [{ name: "", aliases: [], role: "" }]);
  const [leaver, setLeaver] = useState(project.leaver);
  const [successor, setSuccessor] = useState(project.successor);
  const [reviewer, setReviewer] = useState(project.reviewer);
  const [role, setRole] = useState<SuccessorRole>(project.successorRole);

  const names = people.map((p) => p.name.trim()).filter(Boolean);
  const errors: string[] = [];
  if (!title.trim()) errors.push("Give the project a name.");
  if (!leaver.trim()) errors.push("Who is leaving?");
  if (!successor.trim()) errors.push("Who takes over?");
  if (!reviewer.trim()) errors.push("Who reviews and approves the handover?");
  if (leaver && leaver === successor) errors.push("The leaver and the successor must be different people.");

  const setPerson = (i: number, patch: Partial<Person>) => setPeople(people.map((p, k) => (k === i ? { ...p, ...patch } : p)));

  const save = async (andContinue = false) => {
    const clean = people.filter((p) => p.name.trim()).map((p) => ({ ...p, name: p.name.trim(), aliases: p.aliases.map((a) => a.trim()).filter(Boolean) }));
    for (const n of [leaver, successor, reviewer].map((x) => x.trim()).filter(Boolean)) if (!clean.some((p) => p.name === n)) clean.push({ name: n, aliases: [] });
    const roleChanged = role !== project.successorRole;
    await update(
      (p) => ({ ...p, title: title.trim() || "Untitled project", description, people: clean, leaver: leaver.trim(), successor: successor.trim(), reviewer: reviewer.trim(), successorRole: role, stage: p.stage === "setup" && errors.length === 0 ? "sources" : p.stage }),
      { actor: "You", action: "Setup saved", detail: roleChanged ? `Successor role set to ${role}` : undefined },
    );
    toast("success", roleChanged && project.run ? "Saved. The successor role changed — re-run Reconstruct." : "Setup saved");
    if (andContinue) goStep(project, "sources");
  };

  return (
    <div className="step-body">
      <div className="two-col">
        <Card>
          <h2 className="card-title">Project</h2>
          <Field label="Project name" htmlFor="title"><input id="title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. TechFest 2026 Event App" /></Field>
          <Field label="What is it? (optional)" htmlFor="desc"><textarea id="desc" className="textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="One or two lines that help the successor understand the project." /></Field>
          <h2 className="card-title mt">Handover</h2>
          <div className="grid-3">
            <Field label="Leaving" htmlFor="leaver"><PersonInput id="leaver" value={leaver} onChange={setLeaver} names={names} /></Field>
            <Field label="Taking over" htmlFor="succ"><PersonInput id="succ" value={successor} onChange={setSuccessor} names={names} /></Field>
            <Field label="Reviewer / approver" htmlFor="rev"><PersonInput id="rev" value={reviewer} onChange={setReviewer} names={names} /></Field>
          </div>
          <Field label="Successor's access level" hint={role === "member" ? "A Member sees sources tagged Member. Lead-only and Private sources are withheld — even from the AI." : "A Lead sees Member and Lead-only sources. Private sources are never shared."}>
            <Segmented label="Successor role" value={role} onChange={setRole} options={[{ value: "member", label: "Member" }, { value: "lead", label: "Lead" }]} />
          </Field>
        </Card>
        <Card>
          <h2 className="card-title">People and their other names</h2>
          <p className="muted small">The same person often appears as “Riya Sharma” in chat and “riya-dev” on GitHub. Listing aliases lets Baton link them. Chat authors are added automatically.</p>
          <div className="people">
            <div className="people-row people-head"><span>Name</span><span>Aliases (comma separated)</span><span>Role</span><span /></div>
            {people.map((p, i) => (
              <div className="people-row" key={i}>
                <input className="input" aria-label="Name" value={p.name} onChange={(e) => setPerson(i, { name: e.target.value })} placeholder="Riya Sharma" />
                <input className="input" aria-label="Aliases" value={p.aliases.join(", ")} onChange={(e) => setPerson(i, { aliases: e.target.value.split(",") })} placeholder="riya-dev, Riya" />
                <input className="input" aria-label="Role" value={p.role || ""} onChange={(e) => setPerson(i, { role: e.target.value })} placeholder="Club lead" />
                <button className="icon-btn" aria-label="Remove person" onClick={() => setPeople(people.filter((_, k) => k !== i))}><LuTrash2 /></button>
              </div>
            ))}
          </div>
          <Button size="sm" variant="ghost" icon={<LuPlus />} onClick={() => setPeople([...people, { name: "", aliases: [], role: "" }])}>Add person</Button>
        </Card>
      </div>
      {errors.length > 0 && <Callout tone="warn" title="Before you continue">{errors.join(" ")}</Callout>}
      <div className="step-footer">
        <span />
        <div className="row gap">
          <Button icon={<LuSave />} onClick={() => save(false)}>Save</Button>
          <Button variant="primary" disabled={errors.length > 0} onClick={() => save(true)}>Save and add sources →</Button>
        </div>
      </div>
    </div>
  );
}

function PersonInput({ id, value, onChange, names }: { id: string; value: string; onChange: (v: string) => void; names: string[] }) {
  return (
    <>
      <input id={id} className="input" list={`${id}-list`} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Name" />
      <datalist id={`${id}-list`}>{names.map((n) => <option key={n} value={n} />)}</datalist>
    </>
  );
}
