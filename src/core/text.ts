// Text utilities shared by parsers, the rules engine and the verifier. Pure functions, no I/O.

let counter = 0;
/** Short unique id. Uses crypto when available, falls back to time + counter. */
export function uid(prefix = ""): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  const raw = g.crypto?.randomUUID ? g.crypto.randomUUID().replace(/-/g, "").slice(0, 10) : (Date.now().toString(36) + (counter++).toString(36));
  return prefix + raw;
}

export const nowIso = () => new Date().toISOString();

/** Normalise for tolerant quote matching: unify quotes/dashes, collapse whitespace, lowercase. */
export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Stronger normalisation: also drop punctuation. Used as the second, looser match tier. */
export function normalizeLoose(s: string): string {
  return normalizeForMatch(s).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

const STOP = new Set(
  ("a an the and or but if then so of to in on at by for with from into onto over under about as is are was were be been being " +
    "it its this that these those there here we you they he she i me my our your their his her them us do does did done have has had " +
    "will would shall should can could may might must not no yes just also still only very really please ok okay hi hello thanks thank " +
    "what which who whom whose when where why how all any some each every more most other such than too up down out off again " +
    "lets let's i'll we'll you'll it's dont don't im i'm ive i've").split(/\s+/),
);

export function tokens(s: string): string[] {
  return normalizeLoose(s)
    .split(" ")
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
}

export function jaccard(a: string[] | Set<string>, b: string[] | Set<string>): number {
  const A = a instanceof Set ? a : new Set(a);
  const B = b instanceof Set ? b : new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Split a block of text into sentence-like units, keeping their exact original text. */
export function sentences(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    // split on sentence punctuation followed by space + capital/@/quote/digit
    const parts = l.split(/(?<!\b(?:Prof|Dr|Mr|Mrs|Ms|Jr|Sr|St|vs|etc|No|Inc|Ltd|approx|e\.g|i\.e)\.)(?<=[.!?])\s+(?=[A-Z@"'(\d])/);
    for (const p of parts) {
      const t = p.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

export function clip(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…";
}

export function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Strip list markers, markdown emphasis, emoji and leading speaker labels for display. */
export function cleanStatement(s: string): string {
  return s
    .replace(/^\s*(?:[-*•>]+|\d+[.)])\s+/, "")
    .replace(/^\s*\[(?: |x)\]\s*/i, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[,;:]$/, "");
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};
const MON = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

export interface FoundDate { text: string; iso: string; index: number }

/**
 * Find calendar dates mentioned in free text. Returns ISO yyyy-mm-dd; when the year is missing the
 * reference year (from the message time) is used so "12 Dec" and "20 Dec" can be compared.
 */
export function findDates(text: string, refYear = new Date().getFullYear()): FoundDate[] {
  const out: FoundDate[] = [];
  const pad = (n: number) => String(n).padStart(2, "0");
  const push = (m: RegExpExecArray, y: number, mo: number, d: number) => {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return;
    out.push({ text: m[0], iso: `${y}-${pad(mo)}-${pad(d)}`, index: m.index });
  };
  let m: RegExpExecArray | null;
  const r1 = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MON}\\b\\.?(?:,?\\s+(\\d{4}))?`, "gi");
  while ((m = r1.exec(text))) push(m, m[3] ? +m[3] : refYear, MONTHS[m[2].toLowerCase()], +m[1]);
  const r2 = new RegExp(`\\b${MON}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, "gi");
  while ((m = r2.exec(text))) push(m, m[3] ? +m[3] : refYear, MONTHS[m[1].toLowerCase()], +m[2]);
  const r3 = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  while ((m = r3.exec(text))) push(m, +m[1], +m[2], +m[3]);
  const r4 = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g; // dd/mm/yyyy (Indian convention)
  while ((m = r4.exec(text))) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    push(m, y, +m[2], +m[1]);
  }
  // remove overlaps (keep earliest, longest)
  out.sort((a, b) => a.index - b.index || b.text.length - a.text.length);
  const res: FoundDate[] = [];
  for (const d of out) if (!res.some((r) => d.index < r.index + r.text.length && r.index < d.index + d.text.length)) res.push(d);
  return res;
}

export function formatDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T00:00:00Z" : iso);
  if (isNaN(+d)) return iso;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function formatDateTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(+d)) return iso;
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Source timestamps (chat exports, commits) are shown as wall-clock time, without timezone shifting. */
export function formatSourceTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(+d)) return iso;
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Hash a string to a short stable id (FNV-1a). */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
