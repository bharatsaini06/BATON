// Fetches a public (or token-accessible) GitHub repository through the REST API, read-only.
import type { GithubBundle, GhComment, GhCommit, GhIssue } from "../src/core/github";

export class GithubError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

async function gh<T>(path: string, token?: string, raw = false): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
      "user-agent": "baton-handover-app",
      "x-github-api-version": "2022-11-28",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 404) throw new GithubError("Repository not found, or it is private. Baton reads public repositories (or private ones if the server has a GITHUB_TOKEN with access).", 404);
  if (res.status === 403 || res.status === 429) {
    const reset = res.headers.get("x-ratelimit-reset");
    const when = reset ? new Date(+reset * 1000).toLocaleTimeString("en-IN") : "later";
    throw new GithubError(`GitHub rate limit reached. Try again after ${when}, or set GITHUB_TOKEN on the server.`, 429);
  }
  if (!res.ok) throw new GithubError(`GitHub API error ${res.status}`, 502);
  return (raw ? await res.text() : await res.json()) as T;
}

export async function fetchGithub(repo: string, token?: string): Promise<{ bundle: GithubBundle; warnings: string[] }> {
  const warnings: string[] = [];
  const meta = await gh<{ full_name: string; description?: string; default_branch?: string; private?: boolean }>(`/repos/${repo}`, token);
  const [readme, issues, commits] = await Promise.all([
    gh<string>(`/repos/${repo}/readme`, token, true).catch(() => { warnings.push("No README found."); return ""; }),
    gh<GhIssue[]>(`/repos/${repo}/issues?state=all&per_page=50&sort=updated`, token).catch(() => { warnings.push("Issues could not be read."); return []; }),
    gh<GhCommit[]>(`/repos/${repo}/commits?per_page=30`, token).catch(() => { warnings.push("Commits could not be read."); return []; }),
  ]);
  // comments for the most discussed open items (bounded to protect the unauthenticated rate limit)
  const discussed = issues.filter((i) => (i.comments || 0) > 0).sort((a, b) => (b.comments || 0) - (a.comments || 0)).slice(0, token ? 20 : 8);
  const comments: Record<number, GhComment[]> = {};
  await Promise.all(
    discussed.map(async (i) => {
      try {
        comments[i.number] = await gh<GhComment[]>(`/repos/${repo}/issues/${i.number}/comments?per_page=20`, token);
      } catch {
        warnings.push(`Comments for #${i.number} could not be read.`);
      }
    }),
  );
  if (issues.length === 50) warnings.push("Only the 50 most recently updated issues/PRs were imported.");
  return {
    bundle: { repo: meta.full_name, description: meta.description, defaultBranch: meta.default_branch, readme, issues, comments, commits },
    warnings,
  };
}
