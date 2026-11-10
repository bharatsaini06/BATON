// Identity resolution: the same person often appears as "Riya S" on WhatsApp and "riya-dev" on GitHub.
import type { Chunk, Person } from "./types";

export class PeopleIndex {
  private map = new Map<string, string>();
  readonly names: string[] = [];

  constructor(people: Person[], chunks: Chunk[] = []) {
    for (const p of people) this.add(p.name, p.aliases);
    for (const c of chunks) if (c.author) this.addLoose(c.author);
  }

  private key(s: string) {
    return s.trim().replace(/^@/, "").toLowerCase();
  }

  add(name: string, aliases: string[] = []) {
    if (!name.trim()) return;
    if (!this.names.includes(name)) this.names.push(name);
    for (const a of [name, ...aliases]) {
      this.map.set(this.key(a), name);
      const first = a.trim().split(/[\s_.-]+/)[0];
      if (first && first.length > 2 && !this.map.has(this.key(first))) this.map.set(this.key(first), name);
    }
  }

  /** Authors not in the people list: link them to a known person by first name, else register them. */
  addLoose(author: string) {
    if (this.resolve(author)) return;
    this.add(author);
  }

  resolve(token?: string): string | undefined {
    if (!token) return undefined;
    const k = this.key(token);
    if (this.map.has(k)) return this.map.get(k);
    const first = k.split(/[\s_.-]+/)[0];
    if (first.length > 2 && this.map.has(first)) return this.map.get(first);
    return undefined;
  }

  /** Every known person mentioned in a sentence. */
  mentions(text: string): string[] {
    const found = new Set<string>();
    const re = /@?[A-Za-z][\w.-]{1,40}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const tok = m[0];
      // ignore plain lowercase words unless they are handles (contain - _ or start with @)
      if (!/^@|[-_]/.test(tok) && !/^[A-Z]/.test(tok)) continue;
      const r = this.resolve(tok);
      if (r) found.add(r);
    }
    return [...found];
  }
}
