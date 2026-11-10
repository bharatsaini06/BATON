// Source parsers. Each turns one authorised input into chunks with precise locators.
// All output passes through `buildSource`, which redacts secrets and assigns ids.
import { redact, mergeCounts } from "./redact";
import type { AccessTag, Chunk, Locator, Source, SourceFormat, SourceKind } from "./types";
import { uid, nowIso, clip } from "./text";

export interface RawChunk {
  text: string;
  locator: Locator;
  author?: string;
  time?: string;
  meta?: Chunk["meta"];
}

export interface SourceInput {
  name: string;
  kind: SourceKind;
  format: SourceFormat;
  access: AccessTag;
  addedBy?: string;
  meta?: Source["meta"];
  warnings?: string[];
}

export const MAX_CHUNK_CHARS = 1200;

export function buildSource(input: SourceInput, raw: RawChunk[], id = uid("s")): Source {
  let counts: Record<string, number> = {};
  let chars = 0;
  const chunks: Chunk[] = [];
  raw.forEach((r, i) => {
    const text = r.text.trim();
    if (!text) return;
    const { text: clean, counts: c } = redact(text);
    counts = mergeCounts(counts, c);
    chars += clean.length;
    chunks.push({
      id: `${id}:c${i + 1}`,
      sourceId: id,
      text: clean,
      locator: r.locator,
      author: r.author,
      time: r.time,
      access: input.access,
      meta: r.meta,
    });
  });
  const warnings = [...(input.warnings || [])];
  if (!chunks.length) warnings.push("No readable text was found in this source.");
  return {
    id,
    name: input.name,
    kind: input.kind,
    format: input.format,
    access: input.access,
    addedAt: nowIso(),
    addedBy: input.addedBy,
    chunks,
    stats: { chunks: chunks.length, chars, redactions: counts },
    warnings,
    meta: input.meta,
  };
}

// ---------------------------------------------------------------- chat: WhatsApp

interface ChatMessage { time?: string; author?: string; text: string; line: number }

// "12/10/2025, 9:41 pm - Riya: text"  |  "[12/10/25, 21:41:05] Riya: text"  |  "2025-10-12 21:41 - Riya: text"
const WA_PATTERNS: RegExp[] = [
  /^‎?\[(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?\s?m\.?)?\]\s*([^:]{1,60}?):\s?(.*)$/i,
  /^‎?(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?\s?m\.?)?\s*[-–]\s*([^:]{1,60}?):\s?(.*)$/i,
];

function waTime(d: string, mo: string, y: string, h: string, mi: string, ap?: string): string | undefined {
  let year = +y < 100 ? 2000 + +y : +y;
  let day = +d, month = +mo;
  if (month > 12 && day <= 12) [day, month] = [month, day]; // US export
  let hour = +h;
  if (ap) {
    const pm = /p/i.test(ap);
    if (pm && hour < 12) hour += 12;
    if (!pm && hour === 12) hour = 0;
  }
  const dt = new Date(Date.UTC(year, month - 1, day, hour, +mi));
  if (isNaN(+dt)) return undefined;
  if (year < 2000) year = 2000;
  return dt.toISOString();
}

export function looksLikeWhatsApp(text: string): boolean {
  const lines = text.split(/\r?\n/).slice(0, 40);
  return lines.filter((l) => WA_PATTERNS.some((p) => p.test(l))).length >= 2;
}

export function parseWhatsApp(text: string): ChatMessage[] {
  const out: ChatMessage[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const p of WA_PATTERNS) {
      const m = p.exec(line);
      if (m) {
        const [, d, mo, y, h, mi, , ap, author, body] = m;
        out.push({ time: waTime(d, mo, y, h, mi, ap), author: author.trim(), text: body, line: i + 1 });
        return;
      }
    }
    if (out.length && line.trim()) out[out.length - 1].text += "\n" + line; // multi-line message
  });
  return out.filter((m) => !/^<media omitted>$|^this message was deleted$|messages and calls are end-to-end encrypted/i.test(m.text.trim()));
}

// ---------------------------------------------------------------- chat: Discord / Slack JSON

export function parseDiscordJson(data: unknown): { channel?: string; messages: ChatMessage[] } | null {
  const d = data as { channel?: { name?: string }; messages?: unknown[] };
  if (!d || !Array.isArray(d.messages)) return null;
  const messages: ChatMessage[] = [];
  d.messages.forEach((m, i) => {
    const x = m as { timestamp?: string; author?: { name?: string; nickname?: string } | string; content?: string };
    const author = typeof x.author === "string" ? x.author : x.author?.nickname || x.author?.name;
    if (x.content) messages.push({ time: x.timestamp, author, text: x.content, line: i + 1 });
  });
  return { channel: d.channel?.name, messages };
}

export function parseSlackJson(data: unknown): ChatMessage[] | null {
  if (!Array.isArray(data)) return null;
  const msgs: ChatMessage[] = [];
  data.forEach((m, i) => {
    const x = m as { ts?: string; user_name?: string; user?: string; user_profile?: { real_name?: string }; text?: string };
    if (typeof x.text !== "string" || x.ts === undefined) return;
    const t = new Date(parseFloat(x.ts) * 1000);
    msgs.push({ time: isNaN(+t) ? undefined : t.toISOString(), author: x.user_profile?.real_name || x.user_name || x.user, text: x.text, line: i + 1 });
  });
  return msgs.length ? msgs : null;
}

/** One chunk per message keeps citations exact (message time + author). */
export function chatChunks(messages: ChatMessage[], file: string, channel?: string): RawChunk[] {
  return messages.map((m) => ({
    text: m.text.length > MAX_CHUNK_CHARS * 2 ? m.text.slice(0, MAX_CHUNK_CHARS * 2) : m.text,
    author: m.author,
    time: m.time,
    locator: {
      label: `${channel ? "#" + channel + " · " : ""}${m.author || "Unknown"} · ${m.time ? shortTime(m.time) : "line " + m.line}`,
      file,
      line: m.line,
      channel,
    },
  }));
}

function shortTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

// ---------------------------------------------------------------- documents: Markdown / plain text

/** Split a document into paragraph chunks, tracking heading and line range. */
export function documentChunks(text: string, file: string, page?: number): RawChunk[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: RawChunk[] = [];
  let heading: string | undefined;
  let buf: string[] = [];
  let start = 1;
  const flush = (endLine: number) => {
    const t = buf.join("\n").trim();
    if (t) {
      // keep chunks bounded; split long paragraphs by sentence groups
      const pieces = t.length > MAX_CHUNK_CHARS ? splitLong(t) : [t];
      for (const p of pieces)
        out.push({
          text: p,
          locator: {
            label: `${file}${page ? " · p." + page : ""}${heading ? " · " + clip(heading, 40) : ""} · L${start}${endLine > start ? "–" + endLine : ""}`,
            file, page, heading, line: start, lineEnd: endLine,
          },
        });
    }
    buf = [];
  };
  lines.forEach((line, i) => {
    const n = i + 1;
    const h = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      flush(n - 1);
      heading = h[1].trim();
      start = n + 1;
      return;
    }
    if (!line.trim()) {
      flush(n - 1);
      start = n + 1;
      return;
    }
    if (!buf.length) start = n;
    buf.push(line);
  });
  flush(lines.length);
  return out;
}

function splitLong(t: string): string[] {
  const parts = t.split(/(?<=[.!?])\s+/);
  const out: string[] = [];
  let cur = "";
  for (const p of parts) {
    if ((cur + " " + p).length > MAX_CHUNK_CHARS && cur) { out.push(cur.trim()); cur = p; }
    else cur += " " + p;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// ---------------------------------------------------------------- tasks: CSV (Trello / Notion / Jira exports)

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const COL = {
  title: /^(name|title|task|card name|summary|item)$/i,
  status: /^(status|state|list|list name|stage)$/i,
  owner: /^(assignee|assigned to|owner|members|assigned|responsible)$/i,
  due: /^(due|due date|deadline|due on|target date)$/i,
  notes: /^(description|notes|details|card description)$/i,
};

export function taskChunks(text: string, file: string): { chunks: RawChunk[]; warnings: string[] } {
  const rows = parseCsv(text);
  const warnings: string[] = [];
  if (rows.length < 2) return { chunks: [], warnings: ["CSV has no data rows."] };
  const header = rows[0].map((h) => h.trim());
  const idx = (re: RegExp) => header.findIndex((h) => re.test(h));
  const ti = idx(COL.title), si = idx(COL.status), oi = idx(COL.owner), di = idx(COL.due), ni = idx(COL.notes);
  if (ti < 0) warnings.push("No task title column found (expected Name, Title or Task); using the first column.");
  const chunks: RawChunk[] = rows.slice(1).map((r, k) => {
    const title = (r[ti < 0 ? 0 : ti] || "").trim();
    const status = si >= 0 ? (r[si] || "").trim() : "";
    const owner = oi >= 0 ? (r[oi] || "").trim() : "";
    const due = di >= 0 ? (r[di] || "").trim() : "";
    const notes = ni >= 0 ? (r[ni] || "").trim() : "";
    const parts = [`Task: ${title}.`];
    if (status) parts.push(`Status: ${status}.`);
    parts.push(owner ? `Owner: ${owner}.` : "Owner: unassigned.");
    if (due) parts.push(`Due: ${due}.`);
    if (notes) parts.push(notes);
    return {
      text: parts.join(" "),
      locator: { label: `${file} · row ${k + 2}`, file, row: k + 2 },
      meta: { task: title, status, owner, due, done: /done|complete|closed|finished/i.test(status) },
    };
  });
  return { chunks: chunks.filter((c) => c.meta?.task), warnings };
}

// ---------------------------------------------------------------- detection

export type Detected =
  | { format: "whatsapp"; kind: "chat" }
  | { format: "discord" | "slack"; kind: "chat" }
  | { format: "csv"; kind: "tasks" }
  | { format: "markdown" | "text"; kind: "document" };

export function detectFormat(name: string, text: string): Detected {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv")) return { format: "csv", kind: "tasks" };
  if (lower.endsWith(".json")) {
    try {
      const data = JSON.parse(text);
      if (parseDiscordJson(data)) return { format: "discord", kind: "chat" };
      if (parseSlackJson(data)) return { format: "slack", kind: "chat" };
    } catch { /* fall through to text */ }
  }
  if (looksLikeWhatsApp(text)) return { format: "whatsapp", kind: "chat" };
  if (lower.endsWith(".md") || lower.endsWith(".markdown") || /^#\s/m.test(text)) return { format: "markdown", kind: "document" };
  return { format: "text", kind: "document" };
}

/** Parse any supported text upload into a Source. PDF/DOCX arrive here already converted to text pages. */
export function parseUpload(opts: {
  name: string; text?: string; pages?: string[]; access: AccessTag; addedBy?: string; sourceFormat?: "pdf" | "docx";
}): Source {
  const { name, access, addedBy } = opts;
  if (opts.pages) {
    const raw = opts.pages.flatMap((p, i) => documentChunks(p, name, opts.sourceFormat === "pdf" ? i + 1 : undefined));
    return buildSource({ name, kind: "document", format: opts.sourceFormat || "text", access, addedBy }, raw);
  }
  const text = opts.text || "";
  const det = detectFormat(name, text);
  if (det.format === "whatsapp") {
    const msgs = parseWhatsApp(text);
    return buildSource({ name, kind: "chat", format: "whatsapp", access, addedBy, meta: { messages: msgs.length } }, chatChunks(msgs, name));
  }
  if (det.format === "discord") {
    const d = parseDiscordJson(JSON.parse(text))!;
    return buildSource({ name, kind: "chat", format: "discord", access, addedBy, meta: { messages: d.messages.length } }, chatChunks(d.messages, name, d.channel));
  }
  if (det.format === "slack") {
    const msgs = parseSlackJson(JSON.parse(text))!;
    return buildSource({ name, kind: "chat", format: "slack", access, addedBy, meta: { messages: msgs.length } }, chatChunks(msgs, name));
  }
  if (det.format === "csv") {
    const { chunks, warnings } = taskChunks(text, name);
    return buildSource({ name, kind: "tasks", format: "csv", access, addedBy, warnings }, chunks);
  }
  return buildSource({ name, kind: "document", format: det.format, access, addedBy }, documentChunks(text, name));
}
