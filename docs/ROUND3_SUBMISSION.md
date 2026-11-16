# CodersInPune Round 3 — submission text (Team ATHRAV)

One block per item in the Round 3 form. Paste each block as it is.

---

## 1. Final working project link

https://baton-henna.vercel.app

No sign-in needed for the main journey: click **Try the sample project** and follow the yellow note on each step (about three minutes). To see the Round 3 features (accounts, roles, live connectors, signed share links), click **Sign in → Create account**; it takes a minute and needs no email confirmation. All demo data is synthetic.

## 2. Final source-code repository

https://github.com/bharatsaini06/BATON

Run it from the README: `git clone`, then `node dist/server.mjs` and open http://localhost:3000 (Node.js 18.17 or newer; the built app is committed, so no install is needed). To change code: `npm install`, `npm run build`, `npm test`.

## 3. Final product PDF

**[Paste the Google Drive link to Baton_Round3_Final_Product.pdf here. Sharing: Anyone with the link → Viewer. Open it in a private window to check.]**

## 4. Complete list of features built

**Capture**
1. File upload: WhatsApp `.txt` export (Android and iOS), Discord and Slack `.json` exports, PDF, DOCX, Markdown, TXT and task-board CSV; PDF and DOCX are read in the browser.
2. Paste text, and import a public GitHub repository (README, issues, pull requests, comments, commits).
3. Work log: decisions with reasons, risks, tasks and contacts logged while the work happens.
4. Live capture from Discord and Slack: `/baton decision | risk | task | owner | note`, verified by Ed25519 (Discord) and the Slack signing secret.
5. Live capture from GitHub: a signed webhook logs issue assignments, merged pull requests and `Decision:` / `Risk:` lines.
6. Capture inbox for the workspace; captured items join a project's work log with one click.

**Protect**
7. Redaction on arrival of API keys, passwords, tokens, connection strings, card numbers, emails and phone numbers, shown as blacked-out bars.
8. Access tag on every source and captured item: Member, Lead only or Private.
9. Permission gate that removes what the successor may not see before any extraction or AI call.

**Reconstruct and verify**
10. Pipeline with live progress: permission gate, extraction, quote verification, merge, conflict detection, coverage checklist, questions.
11. AI extraction with Google Gemini, Anthropic Claude or any OpenAI-compatible model, with strict JSON validation and a retry; an offline rules engine takes over automatically without a key or on failure.
12. Evidence status set by code for every claim (Verified, Inferred, Conflicting, Missing), with the reason shown.
13. Conflict detection for owners and dates; coverage checklist for unowned work, dependencies without a contact, unowned domain, hosting, database, payments or social accounts, and missing access transfer.

**People decide**
14. Gap Interview: the leaver answers only conflicts, missing items and uncertain claims; answers become dated, cited testimony.
15. Review: the exact highlighted quote beside every claim; approve, edit or reject; bulk-approve verified; filters; readiness score.

**Hand over**
16. Versioned publishing with a diff from the previous version.
17. Successor view: project state, Day 1 / Week 1 plan, owners, open work, risks and a decision timeline; acknowledge each section; flag a claim as wrong (the flag returns to the reviewer); Markdown export.
18. Ask Baton: plain-language questions answered only from approved claims, each sentence with citations that open the source; "Not in the handover" when nothing approved covers it, and the question goes to the reviewer.
19. Signed share links with expiry, revocation and open counts.

**Team and organisation**
20. Accounts (sign-up and sign-in), workspaces, invitation links and roles per person (Member, Lead, Owner).
21. Workspace data in Postgres protected by Row-Level Security; projects saved to a workspace open on any device.
22. Approvals, acknowledgements, flags and questions tied to the signed-in account.
23. Activity log with CSV export; project export and import.
24. Synthetic sample project and downloadable sample files.

## 5. Technical architecture and implementation summary

- **Frontend:** React 19 and TypeScript single-page app with hand-written CSS. Projects are stored locally in the browser (IndexedDB) and, when signed in, saved to the workspace. PDF and DOCX are converted to text in the browser.
- **Backend:** one TypeScript HTTP API that runs as a Node.js server or a Vercel serverless function: ingestion, GitHub import, reconstruction streamed as NDJSON, Gap Interview, publishing, share links, accounts, workspaces, connectors and Ask Baton. Every input is validated with zod; per-IP rate limits; strict security headers.
- **AI layer:** provider adapters for Gemini, Anthropic and OpenAI-compatible APIs, chosen by environment variable. The model receives only permitted, redacted, numbered chunks and must return each claim with an exact quote and chunk id. The model never decides whether a claim is true: code finds the quote in the stored text, checks that named people appear in it and that the statement stays within it. Ask Baton gives the model only the approved facts of that handover and keeps a sentence only if its cited facts support it.
- **Accounts and access control:** Supabase Auth and Postgres. Requests for a signed-in person reach the database with that person's own token, so Row-Level Security policies decide what they can read or write. The service key is used only after the server has verified a webhook signature, an invitation or a signed link. Without Supabase, built-in accounts apply the same role checks.
- **Connectors:** Discord interactions verified with Ed25519; Slack slash commands with the Slack signing secret and a five-minute window; GitHub webhooks with HMAC-SHA256 and a per-connector secret; duplicate deliveries ignored; text redacted before storage.
- **Share links:** HMAC-signed tokens carrying link id, handover id and expiry, checked on every open together with revocation in the database.
- **Storage:** Postgres (Supabase) for workspaces; Upstash Redis or JSON files for published packages.
- **Hosting:** Vercel, with the built app committed so the deployment needs no build step.

## 6. Improvements completed after Round 2

**The three named in Round 2**
1. **Live connectors with continuous capture — delivered.** The same `/baton` command works in a Discord server and a Slack workspace, and a signed GitHub webhook logs repository work; everything lands in a workspace Capture inbox and becomes evidence through the same permission gate and quote check. One difference from the Round 2 wording: capture uses signed commands and webhooks instead of OAuth tokens. This is narrower access: Baton receives only the `/baton` commands and repository events it is sent, never channel history, and stores no third-party token.
2. **Ask Baton, grounded Q&A — delivered.** Answers only from approved claims of the role-filtered handover, citations on every sentence, unsupported sentences removed by code, "Not in the handover" when there is no evidence.
3. **Real accounts and organisation-level access control — delivered.** Sign-in, workspaces, invitations, per-person roles, Postgres Row-Level Security, signed share links with expiry and revocation, and actions tied to identities.

**Also completed**
- Interface redesign around the product's idea: source papers, highlighter evidence in the status colour, blacked-out redactions, review stamps, a relay track for the steps.
- Round 2 limitations closed: projects now open on any device through a workspace; identity comes from the account instead of being typed per step; share links are signed and revocable.
- Reliability fixes found by testing: expired sign-in no longer leaves the workspace loading forever; *How it works* opens fully on screen; a failing page shows a message instead of a blank screen; double-clicks cannot publish or create twice; empty or unreadable uploads are refused with a reason; layout fixed at phone width.
- Documentation: README that runs from a clone, architecture, testing, deployment, connector setup and roadmap documents.

## 7. Testing details

- **156 automated checks pass on the final build (2.3.0):** 20 core unit and integration tests, 5 AI-provider contract tests, 14 Round 3 API tests, 48 Row-Level Security checks run as real database roles on PostgreSQL 16, 27 browser checks of the main journey, 7 AI-path checks with a mock model server, and 35 browser checks of the Round 3 journey (account, workspace, invite, signed Discord, Slack and GitHub calls, inbox, publish, share link, Ask Baton, revoke, Member view). TypeScript type-check is clean and no browser console errors occur.
- **Security and privacy checks:** Lead-only and Private material never appears on a Member's handover or in Ask Baton's answers; the AI prompt for a Member never contains Lead-only or Private text; altered, expired, forged or revoked share links are refused; a Member cannot list projects, add connectors or create links; outsiders and removed members get no rows from the database.
- **Failure cases:** invented quotes are downgraded to Inferred; prompt-injection text in a source cannot change a status; invalid model output is retried and then handled by the rules engine; model outage falls back with a visible warning; malformed requests return 400.
- **Judge-style robustness pass:** wrong addresses, empty projects, empty and unsupported files, refresh on every step, double-clicks on every main action, blank and long questions, wrong password, expired sign-in and phone width. Every problem found was fixed and the fixes are covered by tests.
- **Live check** on the deployed site with Supabase, Discord, Slack, GitHub and Gemini connected.
- Full tables: `docs/TESTING.md` in the repository.

## 8. Product roadmap and future development plan

- **Next 30 days:** pilot with two or three college clubs during end-of-semester handovers; password reset and invitation emails; OCR for scanned PDFs; Hindi and Hinglish in the rules engine; Google Drive and Notion import; more conflict types (amounts, reversed decisions).
- **3 months:** a knowledge-risk view showing work only one person can explain; weekly capture reminders in Discord and Slack; Microsoft Teams, and channel-scoped OAuth for Slack and Discord history; Jira, Linear and Trello sync; encrypted sync for Private sources.
- **6 months:** Ask Baton across every approved handover in a workspace (still role-filtered); Google Workspace sign-in for colleges; a self-hosted package; role templates (treasurer, tech lead, event head).
- **How we will measure it:** time for a successor's first useful contribution; share of questions answered with a source vs "not in the handover"; share of claims Verified before review; flags raised after handover.
- **What will not change:** code, not the model, decides Verified; the permission gate runs before any AI call; a person approves every claim.

Full plan: `docs/ROADMAP.md` in the repository.
