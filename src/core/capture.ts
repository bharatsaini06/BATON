// Live capture. Turns chat commands (Discord / Slack) and GitHub webhook events into structured
// knowledge items, redacted on arrival. Captured items land in a workspace inbox and become
// work-log evidence when a project owner adds them.
import type { AccessTag, CaptureEvent, CaptureSource, LogEntry, LogKind } from "./types";
import { redact } from "./redact";
import { findDates, nowIso, uid } from "./text";

export interface ParsedItem { kind: LogKind; text: string; why?: string; owner?: string; due?: string }

const KIND_WORDS: Record<string, LogKind> = { decision: "decision", decided: "decision", risk: "risk", task: "task", todo: "task", contact: "contact", note: "note" };
const clean = (s: string) => s.replace(/\s+/g, " ").trim().replace(/[.;,\s]+$/, "");

/** Parses "decision Use Razorpay because fees are lower", "task Fix webhook @riya due 2026-12-01", "owner payments -> Riya". */
export function parseCommand(input: string, refYear = new Date().getFullYear()): ParsedItem | null {
  const raw = input.replace(/\s+/g, " ").trim();
  const m = /^([a-zA-Z_]+)\s*[:\-–]?\s+(.+)$/.exec(raw);
  if (!m) return null;
  const word = m[1].toLowerCase();
  let rest = m[2];
  if (word === "owner" || word === "owns") {
    const a = /^(.+?)\s*(?:->|=>|→|:|\bis\b|\bto\b)\s*@?(.+)$/.exec(rest);
    if (!a) return null;
    return { kind: "note", text: `${clean(a[2])} owns ${clean(a[1])}` };
  }
  const kind = KIND_WORDS[word];
  if (!kind) return null;
  const out: ParsedItem = { kind, text: "" };
  const due = /\b(?:due|by|deadline)\s*:?\s*(\d{4}-\d{2}-\d{2}|[^@|]{3,24}?)(?=$|\s+@|\s+because\b|\s+why\b|\s*\|)/i.exec(rest);
  if (due) {
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(due[1].trim()) ? due[1].trim() : findDates(due[1], refYear)[0]?.iso;
    if (iso) { out.due = iso; rest = rest.replace(due[0], " "); }
  }
  const own = /(?:^|\s)(?:@|owner\s*[:=]\s*)([\w.\-]+(?:\s[A-Z][\w.\-]+)?)/.exec(rest);
  if (own && (kind === "task" || kind === "risk")) { out.owner = own[1]; rest = rest.replace(own[0], " "); }
  const why = /\s(?:because|why\s*:|impact\s*:|reason\s*:|\|)\s*(.+)$/i.exec(rest);
  if (why) { out.why = clean(why[1]); rest = rest.slice(0, why.index); }
  out.text = clean(rest);
  return out.text.length >= 3 ? out : null;
}

/** Lines such as "Decision: …" or "Risk: …" inside a PR body, comment or commit message. */
export function taggedLines(body: string | null | undefined): ParsedItem[] {
  if (!body) return [];
  const out: ParsedItem[] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = /^\s*(?:[-*>]\s*)?(decision|risk|todo|task|owner|contact)\s*[:\-–]\s*(.+)$/i.exec(line);
    if (!m) continue;
    const p = parseCommand(`${m[1]} ${m[2]}`);
    if (p) out.push(p);
    if (out.length === 8) break;
  }
  return out;
}

type Gh = Record<string, any>;
export interface GithubItem extends ParsedItem { author: string; url?: string }

/** Maps a GitHub webhook delivery to captured items. Unknown events produce nothing. */
export function fromGithub(event: string, p: Gh): GithubItem[] {
  const who = p?.sender?.login || "github";
  const out: GithubItem[] = [];
  const tagged = (body: unknown, url?: string, author = who) => taggedLines(typeof body === "string" ? body : "").forEach((t) => out.push({ ...t, author, url }));
  if (event === "issues" && p.issue) {
    const i = p.issue, label = `Issue #${i.number}: ${i.title}`;
    if (p.action === "opened") { out.push({ kind: "task", text: label, owner: i.assignee?.login, author: who, url: i.html_url }); tagged(i.body, i.html_url); }
    else if (p.action === "assigned" && p.assignee?.login) out.push({ kind: "task", text: label, owner: p.assignee.login, why: `Assigned to ${p.assignee.login} by ${who}`, author: who, url: i.html_url });
    else if (p.action === "unassigned" && p.assignee?.login) out.push({ kind: "note", text: `${p.assignee.login} is no longer assigned to issue #${i.number}: ${i.title}`, author: who, url: i.html_url });
    else if (p.action === "closed") out.push({ kind: "note", text: `Issue #${i.number} was closed: ${i.title}`, author: who, url: i.html_url });
    else if (p.action === "reopened") out.push({ kind: "task", text: `${label} (reopened)`, owner: i.assignee?.login, author: who, url: i.html_url });
  } else if (event === "pull_request" && p.pull_request) {
    const pr = p.pull_request;
    if (p.action === "opened") { out.push({ kind: "note", text: `Pull request #${pr.number} opened by ${pr.user?.login || who}: ${pr.title}`, author: who, url: pr.html_url }); tagged(pr.body, pr.html_url); }
    else if (p.action === "closed" && pr.merged) { out.push({ kind: "note", text: `Pull request #${pr.number} was merged: ${pr.title}`, author: pr.merged_by?.login || who, url: pr.html_url }); tagged(pr.body, pr.html_url); }
    else if (p.action === "review_requested" && p.requested_reviewer?.login) out.push({ kind: "task", text: `Review pull request #${pr.number}: ${pr.title}`, owner: p.requested_reviewer.login, author: who, url: pr.html_url });
  } else if ((event === "issue_comment" || event === "pull_request_review_comment") && p.action === "created" && p.comment) {
    tagged(p.comment.body, p.comment.html_url);
  } else if (event === "push" && Array.isArray(p.commits)) {
    for (const c of p.commits.slice(0, 20)) tagged(c.message, c.url, c.author?.username || c.author?.name || who);
  }
  return out;
}

export function makeEvent(base: { orgId: string; connectorId: string; source: CaptureSource; access: AccessTag; projectId?: string; ref?: string }, item: ParsedItem & { author: string; url?: string }): { event: CaptureEvent; redactions: number } {
  let n = 0;
  const r = (s?: string) => { if (!s) return undefined; const x = redact(s); n += Object.values(x.counts).reduce((a, b) => a + b, 0); return x.text.slice(0, 1000); };
  const event: CaptureEvent = {
    id: uid("cap"), orgId: base.orgId, connectorId: base.connectorId, source: base.source, kind: item.kind,
    text: r(item.text) || "", why: r(item.why), owner: item.owner?.slice(0, 80), due: item.due, author: item.author.slice(0, 80),
    access: base.access, url: item.url, ref: base.ref, projectId: base.projectId, status: "new", at: nowIso(),
  };
  return { event, redactions: n };
}

const SOURCE_LABEL: Record<CaptureSource, string> = { discord: "Discord", slack: "Slack", github: "GitHub" };
export const captureLabel = (s: CaptureSource) => SOURCE_LABEL[s];

/** A captured item becomes an ordinary work-log entry, so it flows through the same gate, extraction and verification. */
export function toLogEntry(e: CaptureEvent): LogEntry {
  return { id: `w_${e.id}`, kind: e.kind, text: e.text, why: e.why, owner: e.owner, due: e.due, author: `${e.author} (via ${SOURCE_LABEL[e.source]})`, at: e.at, access: e.access };
}
