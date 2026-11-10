// Continuous capture. Team members log decisions, risks, tasks and notes while the work is happening.
// Entries become a "Work log" source; structured entries give the extractor high-quality evidence.
import { buildSource } from "./parsers";
import type { AccessTag, LogEntry, LogKind, Source } from "./types";
export type { LogEntry, LogKind };
import { uid, nowIso, formatDate } from "./text";


export const LOG_LABEL: Record<LogKind, string> = { decision: "Decision", risk: "Risk", task: "Task", contact: "Contact", note: "Note" };

export function entryText(e: LogEntry): string {
  const p: string[] = [];
  if (e.kind === "decision") p.push(`Decision: ${e.text}.`);
  else if (e.kind === "risk") p.push(`Risk: ${e.text}.`);
  else if (e.kind === "task") p.push(`Open task: ${e.text}.`);
  else if (e.kind === "contact") p.push(`Contact: ${e.text}.`);
  else p.push(e.text.endsWith(".") ? e.text : e.text + ".");
  if (e.why) p.push(`${e.kind === "risk" ? "Impact" : "Why"}: ${e.why}.`);
  if (e.owner) p.push(`Owner: ${e.owner}.`);
  if (e.due) p.push(`Due: ${formatDate(e.due)}.`);
  return p.join(" ").replace(/\.\./g, ".");
}

export function newEntry(partial: Omit<LogEntry, "id" | "at"> & { at?: string }): LogEntry {
  return { id: uid("w"), at: partial.at || nowIso(), ...partial };
}

/**
 * Work log entries can carry different access tags, so each tag gets its own source
 * ("Work log", "Work log (Lead only)", ...). This keeps the source-level permission gate exact.
 */
export function worklogSources(entries: LogEntry[], existingIds: Partial<Record<AccessTag, string>> = {}): Source[] {
  const byTag: Partial<Record<AccessTag, LogEntry[]>> = {};
  for (const e of entries) (byTag[e.access] ||= []).push(e);
  const out: Source[] = [];
  for (const tag of ["member", "lead", "private"] as AccessTag[]) {
    const list = byTag[tag];
    if (!list?.length) continue;
    const sorted = [...list].sort((a, b) => a.at.localeCompare(b.at));
    const src = buildSource(
      { name: tag === "member" ? "Work log" : `Work log (${tag === "lead" ? "Lead only" : "Private"})`, kind: "worklog", format: "worklog", access: tag },
      sorted.map((e) => ({
        text: entryText(e),
        author: e.author,
        time: e.at,
        locator: { label: `Work log · ${e.kind} by ${e.author} · ${formatDate(e.at)}` },
        meta: { entryId: e.id, logKind: e.kind, owner: e.owner, due: e.due },
      })),
      existingIds[tag] || uid("s"),
    );
    src.meta = { ...(src.meta || {}), worklog: true, entries: sorted.length };
    out.push(src);
  }
  return out;
}
