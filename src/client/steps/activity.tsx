import { LuDownload } from "react-icons/lu";
import { formatDateTime } from "../../core/text";
import { useProject } from "../pages/project";
import { Button, Card } from "../ui";
import { download } from "../files";

export function ActivityStep() {
  const { project } = useProject();
  const list = [...project.audit].reverse();
  return (
    <div className="step-body">
      <Card>
        <div className="row between">
          <div>
            <h2 className="card-title">Activity log</h2>
            <p className="muted small">Every source change, run, answer, review decision and publication is recorded with who and when.</p>
          </div>
          <Button size="sm" icon={<LuDownload />} onClick={() => download(`${project.title.replace(/\W+/g, "-")}-audit.csv`, "time,actor,action,detail\n" + project.audit.map((a) => [a.at, a.actor, a.action, a.detail || ""].map((x) => `"${x.replace(/"/g, '""')}"`).join(",")).join("\n"), "text/csv")}>Export CSV</Button>
        </div>
        <table className="table">
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead>
          <tbody>
            {list.map((a, i) => (
              <tr key={i}><td className="nowrap small">{formatDateTime(a.at)}</td><td>{a.actor}</td><td><b>{a.action}</b></td><td className="small muted">{a.detail}</td></tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
