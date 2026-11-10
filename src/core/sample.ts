// Synthetic sample project. Every name, company, number and message here is invented for the demo.
// It deliberately contains: a date conflict, unowned work, a recurring bug, a hedged risk,
// Lead-only and Private sources, and secrets that must be redacted.
import type { Project } from "./types";
import { parseUpload } from "./parsers";
import { normalizeGithub, type GithubBundle } from "./github";
import { worklogSources } from "./worklog";
import type { LogEntry } from "./types";
import { nowIso } from "./text";

export const SAMPLE_FILES: Record<string, { access: "member" | "lead" | "private"; text: string; note: string }> = {
  "codecraft-core-team-whatsapp.txt": {
    access: "member",
    note: "WhatsApp group export (synthetic)",
    text: `14/10/2026, 9:41 pm - Riya Sharma: Sponsor demo with ByteForge is on 12 Dec, let's plan backwards from that.
14/10/2026, 9:43 pm - Kabir Khan: ok
14/10/2026, 9:50 pm - Riya Sharma: Kabir will handle the leaderboard and the admin dashboard.
15/10/2026, 11:02 am - Neha Iyer: The Razorpay account is registered under the club treasurer, so any KYC or refund needs me.
15/10/2026, 11:05 am - Riya Sharma: Payment gateway keys are in the club's password manager, Neha has admin access.
17/10/2026, 8:15 pm - Riya Sharma: Firebase free plan might run out in January if registrations cross 3k.
18/10/2026, 10:20 pm - Riya Sharma: I'll handle the webhook until I leave, after that someone needs to own it.
19/10/2026, 4:30 pm - Dev Patel: Posters are done. The Instagram account login is with Riya.
21/10/2026, 6:05 pm - Kabir Khan: ByteForge mailed, sponsor demo moved to 20 Dec.
21/10/2026, 6:07 pm - Riya Sharma: We decided the certificate generator will use the college's official template.
24/10/2026, 7:12 pm - Kabir Khan: Got the domain renewal reminder for techfest-codecraft.in, not sure who handles that.
25/10/2026, 9:00 am - Riya Sharma: Arjun, ping Prof. Rao before changing anything in the payment flow, she approves all money matters.
25/10/2026, 9:01 am - Arjun Mehta: Got it 👍
`,
  },
  "core-team-sync-2026-11-03.md": {
    access: "member",
    note: "Meeting notes (synthetic)",
    text: `# Core team sync — 3 Nov 2026

Attendees: Riya Sharma, Kabir Khan, Neha Iyer, Dev Patel, Arjun Mehta

## Decisions
- Payments stay on Razorpay instead of Stripe because UPI is a must for students.
- Registration closes on 5 Dec 2026.

## Action items
- Kabir: finish the leaderboard by 28 Nov 2026.
- Certificate bulk export is still pending and has no owner yet.
- Next step: load-test the registration flow before the sponsor demo.

## Risks
- The reconcile script is the only fix for missed payments, and only Riya knows how to run it.
`,
  },
  "trello-board-export.csv": {
    access: "member",
    note: "Task board export (synthetic)",
    text: `Card Name,List Name,Members,Due Date,Card Description
Leaderboard page,In Progress,Kabir Khan,28 Nov 2026,Live scores for coding contests
Certificate bulk export,To Do,,10 Dec 2026,Export all participant certificates as one ZIP
Sponsor demo deck,To Do,Riya Sharma,18 Dec 2026,Slides and live walkthrough for ByteForge
Volunteer schedule,Done,Dev Patel,,Shared on the volunteers group
`,
  },
  "byteforge-sponsorship-emails.txt": {
    access: "lead",
    note: "Sponsor email thread — Lead only (synthetic)",
    text: `From: Vikram Rao (ByteForge) <vikram.rao@byteforge.example>
To: Riya Sharma
Date: 21 Oct 2026

Hi Riya, confirming the sponsorship of Rs 75,000 for TechFest 2026. The second tranche of Rs 40,000 is released only after the demo on 20 Dec.
Please keep our logo on the registration page. You can reach me at +91 98765 43210.

From: Riya Sharma
Thanks Vikram. Our new lead will be your point of contact from January.
`,
  },
  "riya-private-notes.md": {
    access: "private",
    note: "Leaver's private notes — never shared (synthetic)",
    text: `# Personal notes (do not share)

RAZORPAY_KEY_SECRET=rzp_live_9xQ2LmT7vWc4KpZr8sN1
Instagram password: CodeCraft@2026

Thinking of recommending Kabir as the next club lead, not decided yet.
`,
  },
};

const GITHUB: GithubBundle = {
  repo: "codecraft-club/techfest-app",
  description: "Registrations, payments and e-certificates for TechFest 2026",
  defaultBranch: "main",
  readme: `# TechFest App

Registrations, payments and e-certificates for TechFest 2026, built by the CodeCraft coding club.

## Stack
Next.js frontend, Firebase (Firestore + Auth) for data and login, Razorpay for payments.
Deployed on Vercel from the main branch.

## Running locally
Copy .env.example to .env.local and ask a maintainer for the Firebase config.
Run npm install and npm run dev.

## Known issues
Missed Razorpay webhooks are fixed by running scripts/reconcile.js after every registration drive.
`,
  issues: [
    {
      number: 42, title: "Webhook signature verification", state: "closed", html_url: "https://github.com/codecraft-club/techfest-app/pull/42",
      user: { login: "riya-dev" }, pull_request: {}, created_at: "2026-10-09T10:15:00Z", closed_at: "2026-10-11T08:00:00Z",
      body: "Adds Razorpay signature checks to the payment webhook. Idempotency is still pending, so retries can create duplicate entries.\nAssigning webhook fixes to @riya-dev until the sponsor demo.",
    },
    {
      number: 24, title: "Leaderboard page", state: "open", html_url: "https://github.com/codecraft-club/techfest-app/issues/24",
      user: { login: "riya-dev" }, assignees: [{ login: "kabir-k" }], created_at: "2026-10-20T12:00:00Z",
      body: "Live scores for the coding contests. Needs the contest results API from the judges' panel.",
    },
    {
      number: 21, title: "Razorpay webhook fails on retries", state: "open", html_url: "https://github.com/codecraft-club/techfest-app/issues/21",
      user: { login: "kabir-k" }, assignees: [{ login: "riya-dev" }], labels: [{ name: "bug" }, { name: "payments" }], created_at: "2026-10-16T18:30:00Z",
      body: "The payment webhook failed again during the mock registration drive. This is the third time this semester.\nWorkaround: run scripts/reconcile.js after each drive to recover missed payments.",
    },
    {
      number: 17, title: "Certificate generator breaks for long names", state: "open", html_url: "https://github.com/codecraft-club/techfest-app/issues/17",
      user: { login: "dev-p" }, assignees: [], labels: [{ name: "certificates" }], created_at: "2026-10-05T09:00:00Z",
      body: "Half-done: the template works for short names. Still need to handle names longer than 30 characters.",
    },
    {
      number: 12, title: "Use Google sign-in only", state: "closed", html_url: "https://github.com/codecraft-club/techfest-app/issues/12",
      user: { login: "riya-dev" }, created_at: "2026-09-02T07:30:00Z", closed_at: "2026-09-03T11:00:00Z",
      body: "We decided to keep Google sign-in only, because email logins caused too many reset requests last year.",
    },
  ],
  comments: {
    21: [
      { body: "It keeps timing out when Firestore writes are slow. Happened before during the hackathon too.", user: { login: "kabir-k" }, created_at: "2026-10-17T09:10:00Z", html_url: "https://github.com/codecraft-club/techfest-app/issues/21#issuecomment-1" },
    ],
  },
  commits: [
    { sha: "a91f3c2d7e", html_url: "https://github.com/codecraft-club/techfest-app/commit/a91f3c2d7e", commit: { message: "Add scripts/reconcile.js to recover missed webhook payments", author: { name: "Riya Sharma", date: "2026-10-12T21:00:00Z" } }, author: { login: "riya-dev" } },
    { sha: "5be20f9a11", html_url: "https://github.com/codecraft-club/techfest-app/commit/5be20f9a11", commit: { message: "Switch payments from Stripe to Razorpay for UPI support", author: { name: "Riya Sharma", date: "2026-09-10T15:20:00Z" } }, author: { login: "riya-dev" } },
    { sha: "0c77d14e93", html_url: "https://github.com/codecraft-club/techfest-app/commit/0c77d14e93", commit: { message: "Leaderboard: first version of the contest table", author: { name: "Kabir Khan", date: "2026-10-28T19:45:00Z" } }, author: { login: "kabir-k" } },
  ],
};

export const SAMPLE_WORKLOG: Omit<LogEntry, "id">[] = [
  { kind: "decision", text: "Freeze new features after 1 Dec 2026", why: "the team needs two weeks of testing before the sponsor demo", author: "Riya Sharma", at: "2026-10-26T10:00:00Z", access: "member" },
  { kind: "risk", text: "Webhook retries can double-charge students until idempotency is added", why: "two students were charged twice in the mock drive", author: "Riya Sharma", at: "2026-10-18T22:30:00Z", access: "member" },
  { kind: "task", text: "Admin dashboard export to CSV", owner: "Kabir Khan", due: "2026-12-01", author: "Kabir Khan", at: "2026-10-29T17:00:00Z", access: "member" },
  { kind: "contact", text: "Prof. Anita Rao approves every change to the payment flow", author: "Riya Sharma", at: "2026-10-25T09:05:00Z", access: "member" },
  { kind: "decision", text: "Request the second sponsor tranche only after the demo", why: "the contract releases it after the demo", author: "Riya Sharma", at: "2026-10-22T11:00:00Z", access: "lead" },
];

export function createSampleProject(id: string): Project {
  const at = nowIso();
  const sources = [
    normalizeGithub(GITHUB, "member", "Riya Sharma"),
    ...Object.entries(SAMPLE_FILES).map(([name, f]) => parseUpload({ name, text: f.text, access: f.access, addedBy: "Riya Sharma" })),
  ];
  const worklog: LogEntry[] = SAMPLE_WORKLOG.map((e, i) => ({ ...e, id: `w-sample-${i + 1}` }));
  sources.push(...worklogSources(worklog));
  return {
    id,
    title: "TechFest 2026 Event App",
    description: "CodeCraft coding club's registration, payment and certificate app. Riya (outgoing lead) hands it to Arjun.",
    createdAt: at,
    updatedAt: at,
    isSample: true,
    people: [
      { name: "Riya Sharma", aliases: ["riya-dev", "Riya"], role: "Outgoing club lead" },
      { name: "Arjun Mehta", aliases: ["arjun-m", "Arjun"], role: "Incoming member" },
      { name: "Kabir Khan", aliases: ["kabir-k", "Kabir"], role: "Frontend developer" },
      { name: "Neha Iyer", aliases: ["neha-iyer", "Neha"], role: "Treasurer" },
      { name: "Dev Patel", aliases: ["dev-p"], role: "Design" },
      { name: "Anita Rao", aliases: ["Prof. Rao", "Prof Rao", "Prof. Anita Rao"], role: "Faculty mentor" },
    ],
    leaver: "Riya Sharma",
    successor: "Arjun Mehta",
    successorRole: "member",
    reviewer: "Anita Rao",
    sources,
    worklog,
    claims: [],
    questions: [],
    versions: [],
    audit: [{ at, actor: "System", action: "Sample project created", detail: "Synthetic data: GitHub repo, WhatsApp export, meeting notes, task board, sponsor emails (Lead only), private notes (Private), work log" }],
    stage: "sources",
  };
}
