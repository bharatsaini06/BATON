// Baton core domain model. Shared by the server (pipeline) and the browser (UI, storage).

/** Who may see a source. Private = leaver + reviewer only; never sent to the AI or shared. */
export type AccessTag = "member" | "lead" | "private";
/** Role of the incoming person. A Lead sees Lead + Member sources; a Member sees Member sources. */
export type SuccessorRole = "member" | "lead";

export type SourceKind = "github" | "chat" | "document" | "tasks" | "worklog" | "testimony";
export type SourceFormat =
  | "github-api" | "whatsapp" | "discord" | "slack" | "markdown" | "text" | "pdf" | "docx" | "csv"
  | "worklog" | "testimony";

/** Where a piece of evidence lives, precise enough to point a reader back to it. */
export interface Locator {
  label: string;           // human readable, e.g. "PR #42 · comment by riya-dev"
  url?: string;
  file?: string;
  line?: number;
  lineEnd?: number;
  page?: number;
  heading?: string;
  row?: number;
  channel?: string;
  issue?: number;
  pr?: number;
  sha?: string;
  question?: string;
}

export interface Chunk {
  id: string;              // globally unique within a project, e.g. "s3:c12"
  sourceId: string;
  text: string;            // already redacted
  locator: Locator;
  author?: string;
  time?: string;           // ISO 8601 when known
  access: AccessTag;
  meta?: Record<string, string | number | boolean | undefined>;
}

export interface Source {
  id: string;
  name: string;
  kind: SourceKind;
  format: SourceFormat;
  access: AccessTag;
  addedAt: string;
  addedBy?: string;
  chunks: Chunk[];
  stats: { chunks: number; chars: number; redactions: Record<string, number> };
  warnings: string[];
  meta?: Record<string, string | number | boolean | undefined>;
}

export type ClaimType =
  | "decision" | "owner" | "open_task" | "deadline" | "risk" | "dependency" | "contact" | "recurring_problem" | "next_action";

export type EvidenceStatus = "verified" | "inferred" | "conflicting" | "missing";
export type ClaimField = "owner" | "date" | "choice" | "status" | "contact" | "other";
export type Engine = "ai" | "rules" | "testimony" | "coverage" | "worklog";

export interface Evidence {
  chunkId: string;
  sourceId: string;
  quote: string;
  match: "exact" | "normalized" | "none";
}

export type ReviewDecision = "pending" | "approved" | "edited" | "rejected";

export interface Claim {
  id: string;
  type: ClaimType;
  statement: string;
  subject?: string;        // what the claim is about ("payment webhook", "sponsor demo")
  field?: ClaimField;
  value?: string;          // the asserted value ("Riya", "2026-12-12")
  basis: "stated" | "inferred";
  evidence: Evidence[];
  status: EvidenceStatus;
  statusReason: string;    // why the verifier chose this status, shown to the reviewer
  conflictGroup?: string;
  resolvedBy?: string;     // claim id that resolved this conflict / gap
  supersededBy?: string;
  engine: Engine;
  confidence?: number;     // 0..1, model or rule score
  date?: string;           // ISO date the claim refers to (for timelines / deadlines)
  people?: string[];
  review: { decision: ReviewDecision; by?: string; at?: string; note?: string; original?: string };
  createdAt: string;
}

export interface GapQuestion {
  id: string;
  kind: "missing" | "conflict" | "inferred";
  claimIds: string[];
  question: string;
  context?: string;
  options?: string[];
  answer?: string;
  answeredAt?: string;
  skipped?: boolean;
}

export interface Person { name: string; aliases: string[]; role?: string }

export type LogKind = "decision" | "risk" | "task" | "contact" | "note";

/** A work-log entry captured while the work is happening (continuous capture). */
export interface LogEntry {
  id: string;
  kind: LogKind;
  text: string;          // what was decided / noticed
  why?: string;          // reasoning (decisions) or impact (risks)
  owner?: string;        // who owns it (tasks, contacts)
  due?: string;          // yyyy-mm-dd
  author: string;
  at: string;
  access: AccessTag;
}

export interface AuditEvent { at: string; actor: string; action: string; detail?: string }

export interface RunTraceStep { stage: string; message: string; ms: number }

export interface RunInfo {
  at: string;
  engine: "ai" | "rules";
  provider?: string;
  model?: string;
  role: SuccessorRole;
  visibleChunks: number;
  hiddenChunks: number;
  hiddenSources: number;
  batches: number;
  warnings: string[];
  trace: RunTraceStep[];
  durationMs: number;
  counts: Record<EvidenceStatus, number>;
}

export interface PlanItem {
  id: string;
  horizon: "day1" | "week1";
  title: string;
  why: string;
  claimIds: string[];
  kind: "access" | "resolve" | "unknown" | "reassign" | "read" | "meet" | "task" | "risk";
}

export interface TimelineItem { date: string; claimId: string; label: string; status: EvidenceStatus }

export type SectionKey = "state" | "owners" | "open" | "risks" | "timeline" | "plan";

export interface SharePackage {
  id: string;
  projectId: string;
  version: number;
  title: string;
  project: string;
  leaver: string;
  successor: string;
  role: SuccessorRole;
  reviewer: string;
  approvedBy: string;
  approvedAt: string;
  claims: Claim[];          // approved / edited only
  chunks: Chunk[];          // only chunks cited by those claims AND visible to the role
  sources: Pick<Source, "id" | "name" | "kind" | "format" | "access">[];
  plan: PlanItem[];
  timeline: TimelineItem[];
  hiddenSources: number;
  excluded: { rejected: number; pending: number };
  engine: string;
  changes?: { added: string[]; removed: string[]; edited: string[]; fromVersion: number };
  acknowledgements: Partial<Record<SectionKey, { by: string; at: string }>>;
  flags: { claimId: string; note: string; by: string; at: string }[];
}

export interface Project {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  isSample?: boolean;
  people: Person[];
  leaver: string;
  successor: string;
  successorRole: SuccessorRole;
  reviewer: string;
  sources: Source[];
  worklog: LogEntry[];
  claims: Claim[];
  questions: GapQuestion[];
  run?: RunInfo;
  runFingerprint?: string;   // sources + access + role at the time of the last reconstruction
  versions: { version: number; packageId: string; approvedAt: string; approvedBy: string; claimCount: number }[];
  audit: AuditEvent[];
  stage: "setup" | "sources" | "generated" | "interviewed" | "reviewed" | "published";
}

export const CLAIM_TYPE_LABEL: Record<ClaimType, string> = {
  decision: "Decision",
  owner: "Owner",
  open_task: "Open task",
  deadline: "Deadline",
  risk: "Risk",
  dependency: "Dependency",
  contact: "Contact",
  recurring_problem: "Recurring problem",
  next_action: "Next action",
};

export const STATUS_LABEL: Record<EvidenceStatus, string> = {
  verified: "Verified",
  inferred: "Inferred",
  conflicting: "Conflicting",
  missing: "Missing",
};

export const ACCESS_LABEL: Record<AccessTag, string> = {
  member: "Member",
  lead: "Lead only",
  private: "Private",
};

/** Which successor section a claim type belongs to. */
export const SECTION_OF: Record<ClaimType, SectionKey> = {
  decision: "timeline",
  owner: "owners",
  contact: "owners",
  open_task: "open",
  deadline: "open",
  next_action: "open",
  risk: "risks",
  dependency: "risks",
  recurring_problem: "risks",
};

export const SECTION_LABEL: Record<SectionKey, string> = {
  state: "Project state",
  owners: "Owners & contacts",
  open: "Open work & deadlines",
  risks: "Risks, dependencies & recurring problems",
  timeline: "Decision timeline",
  plan: "Day 1 / Week 1 plan",
};
