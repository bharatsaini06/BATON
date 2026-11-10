// Secret and personal-data redaction. Runs at ingestion, before anything is stored, shown or sent
// to an AI model. Replaces matches with a visible marker so reviewers know something was removed.

export interface RedactionRule { kind: string; label: string; re: RegExp; keepGroup?: number }

export const REDACTION_RULES: RedactionRule[] = [
  { kind: "private_key", label: "private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { kind: "api_key", label: "API key", re: /\b(?:sk|pk|rk)[-_](?:live|test|proj|ant)?[-_]?[A-Za-z0-9_-]{16,}\b/g },
  { kind: "api_key", label: "API key", re: /\brzp_(?:live|test)_[A-Za-z0-9]{8,}\b/g },
  { kind: "api_key", label: "API key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: "api_key", label: "API key", re: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  { kind: "api_key", label: "API key", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { kind: "api_key", label: "API key", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: "token", label: "token", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  {
    kind: "secret",
    label: "secret",
    // KEY=value / password: value / "secret": "value"
    re: /\b((?:[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY)[A-Z0-9_]*|password|passwd|pwd|secret|api[ _-]?key|token)\s*["']?\s*[:=]\s*["']?)([^\s"',;]{4,})/gi,
    keepGroup: 1,
  },
  { kind: "connection", label: "connection string", re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"'<>]+/gi },
  { kind: "card", label: "card number", re: /\b(?:\d[ -]?){13,19}\b(?=\D|$)/g },
  { kind: "email", label: "email", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { kind: "phone", label: "phone", re: /(?:\+91[\s-]?|\b0|\b)[6-9]\d{4}[\s-]?\d{5}\b/g },
  { kind: "phone", label: "phone", re: /\+\d{1,3}[\s-]?\(?\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}\b/g },
];

function luhnOk(digits: string): boolean {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = +digits[i];
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export interface RedactionResult { text: string; counts: Record<string, number> }

export function redact(input: string): RedactionResult {
  let text = input;
  const counts: Record<string, number> = {};
  for (const rule of REDACTION_RULES) {
    text = text.replace(rule.re, (...args: unknown[]) => {
      const match = args[0] as string;
      if (rule.kind === "card") {
        const digits = match.replace(/\D/g, "");
        if (digits.length < 13 || !luhnOk(digits)) return match;
      }
      if (match.includes("[REDACTED")) return match;
      counts[rule.kind] = (counts[rule.kind] || 0) + 1;
      if (rule.keepGroup) {
        const prefix = args[rule.keepGroup] as string;
        return `${prefix}[REDACTED ${rule.label}]`;
      }
      return `[REDACTED ${rule.label}]`;
    });
  }
  return { text, counts };
}

export function mergeCounts(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] || 0) + v;
  return out;
}

export function totalRedactions(c: Record<string, number>): number {
  return Object.values(c).reduce((s, n) => s + n, 0);
}
