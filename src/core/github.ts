// GitHub source. `normalizeGithub` is pure: it turns GitHub REST API responses into chunks.
// The server fetches the responses (see server/github.ts); tests and the sample use fixtures.
import { buildSource, documentChunks, type RawChunk } from "./parsers";
import type { AccessTag, Source } from "./types";

export interface GhUser { login: string }
export interface GhIssue {
  number: number; title: string; body?: string | null; state: string; html_url: string;
  user?: GhUser | null; assignee?: GhUser | null; assignees?: GhUser[]; labels?: ({ name?: string } | string)[];
  created_at: string; updated_at?: string; closed_at?: string | null; pull_request?: unknown; comments?: number;
}
export interface GhComment { body: string; user?: GhUser | null; created_at: string; html_url: string }
export interface GhCommit { sha: string; html_url: string; commit: { message: string; author?: { name?: string; date?: string } }; author?: GhUser | null }

export interface GithubBundle {
  repo: string;                       // owner/name
  description?: string;
  defaultBranch?: string;
  readme?: string;
  issues: GhIssue[];                  // issues and PRs (GitHub returns PRs in the issues endpoint)
  comments: Record<number, GhComment[]>;
  commits: GhCommit[];
}

export function parseRepoInput(input: string): string | null {
  const s = input.trim().replace(/\.git$/, "").replace(/\/$/, "");
  const m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)/i.exec(s) || /^([\w.-]+)\/([\w.-]+)$/.exec(s);
  return m ? `${m[1]}/${m[2]}` : null;
}

export function normalizeGithub(b: GithubBundle, access: AccessTag, addedBy?: string): Source {
  const raw: RawChunk[] = [];
  const base = `https://github.com/${b.repo}`;
  if (b.readme) {
    for (const c of documentChunks(b.readme, "README.md")) {
      raw.push({ ...c, locator: { ...c.locator, label: `README.md · L${c.locator.line}${c.locator.lineEnd && c.locator.lineEnd > c.locator.line! ? "–" + c.locator.lineEnd : ""}`, url: `${base}/blob/${b.defaultBranch || "main"}/README.md#L${c.locator.line}` } });
    }
  }
  for (const it of b.issues) {
    const isPr = !!it.pull_request;
    const kind = isPr ? "PR" : "Issue";
    const assignees = (it.assignees?.length ? it.assignees : it.assignee ? [it.assignee] : []).map((a) => a.login);
    const labels = (it.labels || []).map((l) => (typeof l === "string" ? l : l.name)).filter(Boolean);
    const header = `${kind} #${it.number} (${it.state}${it.state === "closed" && isPr ? "/merged or closed" : ""}): ${it.title}.` +
      (assignees.length ? ` Assigned to ${assignees.join(", ")}.` : it.state === "open" ? " Unassigned." : "") +
      (labels.length ? ` Labels: ${labels.join(", ")}.` : "");
    const body = (it.body || "").trim();
    raw.push({
      text: body ? `${header}\n${body.slice(0, 1800)}` : header,
      author: it.user?.login,
      time: it.created_at,
      locator: { label: `${kind} #${it.number} · ${it.title.slice(0, 50)}`, url: it.html_url, issue: isPr ? undefined : it.number, pr: isPr ? it.number : undefined },
      meta: { github: kind.toLowerCase(), number: it.number, state: it.state, title: it.title, assignees: assignees.join(","), labels: labels.join(",") },
    });
    for (const c of b.comments[it.number] || []) {
      raw.push({
        text: c.body.slice(0, 1800),
        author: c.user?.login,
        time: c.created_at,
        locator: { label: `${kind} #${it.number} · comment by ${c.user?.login || "unknown"}`, url: c.html_url, issue: isPr ? undefined : it.number, pr: isPr ? it.number : undefined },
        meta: { github: "comment", number: it.number, title: it.title },
      });
    }
  }
  for (const c of b.commits) {
    raw.push({
      text: c.commit.message.slice(0, 1500),
      author: c.author?.login || c.commit.author?.name,
      time: c.commit.author?.date,
      locator: { label: `Commit ${c.sha.slice(0, 7)}`, url: c.html_url, sha: c.sha },
      meta: { github: "commit", sha: c.sha },
    });
  }
  const openIssues = b.issues.filter((i) => i.state === "open").length;
  return buildSource(
    { name: b.repo, kind: "github", format: "github-api", access, addedBy, meta: { repo: b.repo, issues: b.issues.length, openIssues, commits: b.commits.length, readme: !!b.readme } },
    raw,
  );
}
