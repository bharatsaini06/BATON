// Rule-based extraction engine. Runs fully offline, so the product works even with no AI key.
// Every claim it proposes quotes an exact sentence from a visible chunk; the verifier then checks it
// like any AI claim. Interpretive claims (hedged risks, inferred owners) are marked basis "inferred".
import type { Chunk, ClaimField, ClaimType } from "./types";
import { PeopleIndex } from "./people";
import { cleanStatement, clip, findDates, sentences, tokens, capitalize, formatDate } from "./text";

export interface Candidate {
  type: ClaimType;
  statement: string;
  subject?: string;
  field?: ClaimField;
  value?: string;
  basis: "stated" | "inferred";
  quote: string;
  chunkId: string;
  confidence: number;
  date?: string;
  people?: string[];
}

const RX = {
  recurring:
    /\b(again|keeps? (?:on )?(?:failing|breaking|crashing|happening|timing out)|every (?:time|deploy|release|build|week|event|semester)|recurring|same (?:bug|issue|error|problem)|(?:second|third|fourth|\d+(?:st|nd|rd|th)) time|whenever|always (?:breaks|fails|times out|crashes)|flaky|happened before)\b/i,
  decision:
    /\b(we (?:have )?decided|decided (?:to|on|that)|decision(?: is|:)|we(?:'re| are) going with|going with|we(?:'ll| will) use|agreed (?:to|on|that)|finali[sz]ed|we chose|chose to|switch(?:ed|ing)? (?:to|from)|instead of|approved|locked in|settled on|final call)\b/i,
  ownerA: /(?:assigned to|owned by|handled by|maintained by|managed by|owner\s*(?:is|:|-|=)|responsible\s*:|(?:is|are|stays|lies) with)\s*@?([A-Z][\w.-]*(?: [A-Z][a-z]+)?|[a-z][\w.]*-[\w.-]+)/,
  ownerB:
    /(?:^|[\s(])(@[\w-]+|[A-Z][a-z]+(?: [A-Z][a-z]+)?)\s+(?:will (?:own|handle|take care of|look after|maintain|fix|finish|build|lead|manage|take over|do)|is (?:handling|responsible for|owning|maintaining|in charge of|looking after|taking care of|managing)|owns|handles|maintains|manages|leads|takes care of|took over|is the owner of)\s+(.+)/,
  ownerC: /\b[Aa]ssign(?:ing|ed|s)?\s+(.{3,60}?)\s+to\s+(@[\w-]+|[A-Z][a-z]+(?: [A-Z][a-z]+)?)/,
  speaker: /^([A-Z][a-z]+(?: [A-Z][a-z]+)?):\s+(.{6,})$/,
  ownerSelf: /\b(?:I(?:'ll| will| am going to)|I'm going to|I'm)\s+(?:handle|handling|own|owning|take care of|taking care of|look after|maintain|maintaining|fix|finish|build|take over|manage|managing)\s+(.+)/i,
  openTask:
    /\b(todo|to-do|to do:|pending|unfinished|not (?:yet )?(?:done|finished|complete|started|merged)|half[- ](?:done|finished|built)|wip|work in progress|in progress|still need(?:s)? to|need(?:s)? to be (?:done|finished|fixed|built)|remaining|blocked|backlog|yet to|haven't (?:finished|started|done)|incomplete|open task)\b/i,
  risk:
    /\b(risk|risky|might (?:break|fail|run out|expire|crash|lapse)|may (?:break|fail|run out|expire|lapse)|could (?:break|fail|run out|lapse)|will (?:expire|run out|break|lapse)|expir(?:e|es|ed|ing|y)|lapse|quota|limit(?:s)? (?:reached|exceeded|hit)|running out|run out|deadline|overdue|urgent|single point|nobody else knows|only \w+ knows|no backup|leak(?:ed)?|vulnerab\w*|downtime|outage|free (?:tier|plan))\b/i,
  dependency:
    /\b(depends on|dependent on|relies on|reliant on|blocked by|waiting (?:on|for)|requires? (?:access|approval)|needs? approval|third[- ]party|vendor|sponsorship|subscription|billing|account (?:is )?(?:under|owned by|in)|api key|credentials?|registered (?:under|to|with)|paid by|login belongs)\b/i,
  contact:
    /\b(?:[Cc]ontact|[Rr]each out to|[Tt]alk to|[Ss]peak to|[Aa]sk|[Pp]ing|[Cc]all|[Ee]mail|[Cc]oordinate with|POC(?: is)?:?|[Pp]oint of contact(?: is)?:?)\s+(@?[A-Z][a-z]+(?: [A-Z][a-z]+)?)/,
  nextAction:
    /\b(next steps?|next up|first thing|should (?:first|start|check|update|renew|move|confirm)|must (?:be|do|renew|update|finish|confirm)|make sure|don't forget|remember to|action item)\b/i,
  hedge: /\b(might|may|could|probably|likely|i think|i guess|maybe|perhaps|seems|not sure|possibly|should be)\b/i,
  noise: /^(ok(ay)?|thanks|thank you|lol|haha|done|yes|no|sure|great|nice|cool|good morning|gm|hi|hello)\b/i,
};

const PRIORITY: ClaimType[] = ["recurring_problem", "decision", "owner", "dependency", "risk", "open_task", "deadline", "contact", "next_action"];
const EVENT = /\b(demo|deadline|launch|due|release|submission|submit|event|meeting|closes?|opens?|freeze|registration|exam|presentation|review|interview|hackathon|fest|go[- ]live|starts?|ends?|moved|postponed|rescheduled)\b/i;

function refYear(c: Chunk): number {
  const y = c.time ? new Date(c.time).getUTCFullYear() : NaN;
  return isNaN(y) ? new Date().getUTCFullYear() : y;
}

function cleanSubject(s: string): string {
  return cleanStatement(s)
    .replace(/\b(from now on|for now|going forward|till the end|until further notice)\b.*$/i, "")
    .replace(/\s*(?:,|;|\s-\s|\b(?:until|till|unless|after that|but|because|so that|once|when)\b).*$/i, "")
    .replace(/[.!?]+$/, "")
    .replace(/^(the|our|this)\s+/i, "")
    .trim();
}

/** Text before a date, trimmed to the event it names: "ByteForge mailed, sponsor demo moved to" → "sponsor demo". */
function dateSubject(s: string, dateText: string): string {
  const i = s.indexOf(dateText);
  let before = (i > 0 ? s.slice(0, i) : s).trim();
  before = before.replace(/\b(is|are|was|will be|has been|moved|shifted|postponed|rescheduled|changed|set|fixed|planned|scheduled|happening|due|closes?|opens?|starts?|ends?|on|by|to|till|until|for|at|before|after)\s*$/i, "").trim();
  before = before.replace(/\b(is|are|was|will be|has been|moved|shifted|postponed|rescheduled|changed|set|scheduled|on|by|to)\s*$/i, "").trim();
  const clause = before.split(/[,;:]|\s-\s/).map((x) => x.trim()).filter(Boolean).pop() || before;
  return cleanSubject(clause) || cleanSubject(s);
}

const CONTEXT_POOR = /^(it|this|that|they|these|those|same|happened|again|also)\b/i;

export function extractRules(chunks: Chunk[], people: PeopleIndex): Candidate[] {
  const out: Candidate[] = [];
  for (const c of chunks) {
    const meta = c.meta || {};
    const year = refYear(c);

    // ---- structured: work log entries
    if (meta.logKind && meta.logKind !== "note") {
      const first = sentences(c.text)[0] || c.text;
      const body = first.replace(/^(Decision|Risk|Open task|Contact):\s*/i, "").replace(/\.$/, "");
      const kind = String(meta.logKind);
      const type: ClaimType = kind === "decision" ? "decision" : kind === "risk" ? "risk" : kind === "task" ? "open_task" : "contact";
      {
        const why = /Why: ([^.]+)\./.exec(c.text)?.[1];
        const due = meta.due ? String(meta.due) : findDates(c.text, year)[0]?.iso;
        const named = people.mentions(c.text);
        out.push({
          type,
          statement: capitalize(body) + (why && type === "decision" ? ` — because ${why.charAt(0).toLowerCase() + why.slice(1)}` : ""),
          subject: clip(body, 80),
          field: type === "contact" && named[0] ? "contact" : due ? "date" : type === "decision" ? "choice" : undefined,
          value: type === "contact" && named[0] ? named[0] : due,
          date: due,
          basis: "stated",
          quote: first,
          chunkId: c.id,
          confidence: 0.92,
          people: people.mentions(c.text),
        });
      }
      if (meta.owner) {
        const ownerName = people.resolve(String(meta.owner)) || String(meta.owner);
        const q = /Owner: [^.]+\./.exec(c.text)?.[0];
        if (q) out.push({ type: "owner", statement: `${ownerName} owns: ${body}`, subject: clip(body, 80), field: "owner", value: ownerName, basis: "stated", quote: q, chunkId: c.id, confidence: 0.9, people: [ownerName] });
      }
      continue;
    }

    // ---- structured: task board rows
    if (meta.task) {
      const task = String(meta.task);
      const done = !!meta.done;
      const due = meta.due ? findDates(String(meta.due), year)[0]?.iso : undefined;
      const titleQ = sentences(c.text)[0];
      if (!done) {
        out.push({
          type: "open_task",
          statement: `"${task}" is ${meta.status ? String(meta.status).toLowerCase() : "open"}${due ? `, due ${formatDate(due)}` : ""}`,
          subject: task,
          field: due ? "date" : "status",
          value: due || String(meta.status || "open"),
          date: due,
          basis: "stated",
          quote: titleQ,
          chunkId: c.id,
          confidence: 0.85,
        });
      }
      if (meta.owner && !done) {
        const q = /Owner: [^.]+\./.exec(c.text)?.[0];
        const ownerName = people.resolve(String(meta.owner)) || String(meta.owner);
        if (q && !/unassigned/i.test(q)) out.push({ type: "owner", statement: `${ownerName} owns the task "${task}"`, subject: task, field: "owner", value: ownerName, basis: "stated", quote: q, chunkId: c.id, confidence: 0.85, people: [ownerName] });
      }
      continue;
    }

    // ---- structured: GitHub issues and PRs
    if (meta.github === "issue" || meta.github === "pr") {
      const header = sentences(c.text)[0];
      const label = meta.github === "pr" ? "PR" : "Issue";
      if (meta.state === "open") {
        const assignees = String(meta.assignees || "").split(",").filter(Boolean).map((a) => people.resolve(a) || a);
        const headQuote = new RegExp(`^${label} #\\d+ \\(open\\): .+?\\.(?=\\s|$)`).exec(header)?.[0] || header;
        out.push({
          type: "open_task",
          statement: `Open ${label.toLowerCase()} #${meta.number}: ${meta.title}`,
          subject: String(meta.title),
          field: "status",
          value: "open",
          basis: "stated",
          quote: headQuote,
          chunkId: c.id,
          confidence: 0.88,
          people: assignees,
        });
        const aq = /Assigned to [^.]+\./.exec(header)?.[0];
        if (aq && assignees.length)
          out.push({ type: "owner", statement: `${assignees.join(" and ")} ${assignees.length > 1 ? "are" : "is"} assigned to ${label.toLowerCase()} #${meta.number} (${meta.title})`, subject: String(meta.title), field: "owner", value: assignees[0], basis: "stated", quote: aq, chunkId: c.id, confidence: 0.86, people: assignees });
      }
      // the body may contain more statements: fall through to sentence rules on the remaining lines
    }

    // ---- free text: sentence rules
    const lines: string[] = [];
    for (const s of sentences(c.text)) {
      if (lines.length && CONTEXT_POOR.test(s) && tokens(s).length < 7) lines[lines.length - 1] += " " + s;
      else lines.push(s);
    }
    const issueBody = meta.github === "issue" || meta.github === "pr";
    for (let i = 0; i < lines.length; i++) {
      const s = lines[i];
      if (issueBody && i === 0) continue;
      if (s.length < 15 || s.length > 420) continue;
      if (s.trim().endsWith("?")) continue;
      if (s.length < 30 && RX.noise.test(s)) continue;
      // "Kabir: finish the leaderboard" in notes = an assignment to a known person
      const sp = RX.speaker.exec(s);
      const speaker = sp && people.resolve(sp[1]) ? { person: people.resolve(sp[1])!, rest: sp[2] } : undefined;
      const display = capitalize(cleanStatement(speaker ? speaker.rest : s));
      if (display.length < 12) continue;
      const hedged = RX.hedge.test(s);
      const mentioned = people.mentions(s);
      // first-person statements name their author ("any refund needs me")
      if (c.author && /\b(me|my|I|I'm|I'll|mine)\b/.test(s)) {
        const self = people.resolve(c.author) || c.author;
        if (!mentioned.includes(self)) mentioned.push(self);
      }
      const dates = findDates(s, year);
      const date = dates[0]?.iso;
      const structured = meta.github ? 0.05 : 0;
      const base = 0.55 + structured + (mentioned.length ? 0.08 : 0) - (hedged ? 0.12 : 0);

      // owner (explicit forms first)
      let owner: { person: string; subject: string } | undefined;
      const a = RX.ownerA.exec(s);
      const cA = RX.ownerC.exec(s);
      if (speaker && !a) {
        owner = { person: speaker.person, subject: cleanSubject(speaker.rest.replace(/^(finish|complete|do|fix|build|handle|own|update|send|prepare|write)\s+/i, "")) };
      } else if (cA && (people.resolve(cA[2]) || cA[2].startsWith("@"))) {
        owner = { person: people.resolve(cA[2]) || cA[2].replace(/^@/, ""), subject: cleanSubject(cA[1]) };
      } else if (a) {
        const p = people.resolve(a[1]) || a[1].replace(/^@/, "").replace(/[.,]+$/, "");
        const before = s.slice(0, a.index).replace(/\b(is|was|are|has been|been|currently|now)\s*$/i, "");
        owner = { person: p, subject: cleanSubject(before) || cleanSubject(s) };
      } else {
        const b = RX.ownerB.exec(s);
        if (b) {
          const p = people.resolve(b[1]) || (b[1].startsWith("@") ? b[1].slice(1) : b[1]);
          if (people.resolve(b[1]) || b[1].startsWith("@")) owner = { person: p, subject: cleanSubject(b[2]) };
        } else {
          const self = RX.ownerSelf.exec(s);
          if (self && c.author) owner = { person: people.resolve(c.author) || c.author, subject: cleanSubject(self[1]) };
        }
      }

      const hits = new Set<ClaimType>();
      if (RX.recurring.test(s)) hits.add("recurring_problem");
      if (RX.decision.test(s)) hits.add("decision");
      if (owner && owner.subject.length > 2) hits.add("owner");
      if (RX.dependency.test(s)) hits.add("dependency");
      if (RX.risk.test(s)) hits.add("risk");
      if (RX.openTask.test(s) && !(issueBody && meta.state === "open")) hits.add("open_task");
      if (speaker && owner) hits.add("open_task");
      if (date && EVENT.test(s)) hits.add("deadline");
      const contact = RX.contact.exec(s);
      const contactPerson = contact ? people.resolve(contact[1]) : undefined;
      if (contactPerson) hits.add("contact");
      if (RX.nextAction.test(s)) hits.add("next_action");
      if (!hits.size) continue;

      const primary = PRIORITY.find((t) => hits.has(t))!;
      const emit = (type: ClaimType) => {
        const cand: Candidate = {
          type,
          statement: display,
          basis: hedged ? "inferred" : "stated",
          quote: s,
          chunkId: c.id,
          confidence: Math.max(0.3, Math.min(0.9, base)),
          date,
          people: mentioned,
          subject: date && (type === "deadline" || type === "open_task" || type === "risk") ? dateSubject(display, dates[0].text) : clip(display, 80),
        };
        if (type === "owner" && owner) {
          cand.statement = `${owner.person} owns ${clip(owner.subject, 90)}`;
          cand.subject = clip(owner.subject, 90);
          cand.field = "owner";
          cand.value = owner.person;
          cand.people = [owner.person];
          cand.confidence = Math.min(0.9, base + 0.1);
          // "I'll handle it" style ownership is an inference from the speaker
          if (!a && !cA && !speaker && RX.ownerSelf.test(s)) cand.basis = "inferred";
        } else if (type === "contact" && contactPerson) {
          cand.field = "contact";
          cand.value = contactPerson;
          cand.people = [contactPerson];
        } else if (type === "risk" && hedged) {
          cand.basis = "inferred";
        } else if (date) {
          cand.field = "date";
          cand.value = date;
        } else if (type === "decision") {
          cand.field = "choice";
        }
        out.push(cand);
      };
      emit(primary);
      // owner statements are useful on their own even when the sentence is mainly something else
      if (primary !== "owner" && hits.has("owner")) emit("owner");
    }
  }
  return out;
}
