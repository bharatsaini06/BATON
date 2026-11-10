# CodersInPune Round 2 — submission text (Team ATHRAV)

Copy each block into the submission form. Replace every **[bracketed]** item first.

---

## Working project link
**[https://your-project.vercel.app]** — no sign-in. Click **Try the sample project** and follow the yellow guide on each step.

## Source-code repository link
**[https://github.com/your-username/baton]** (public)

## Updated project PDF
**[Google Drive link to Baton_Round2_Project_Document.pdf — sharing: Anyone with the link → Viewer, tested in incognito]**

## List of completed features
1. Source connectors: file upload (WhatsApp .txt, Discord/Slack .json, PDF, DOCX, Markdown, TXT, task-board CSV), paste text, and public GitHub import (README, issues, PRs, comments, commits).
2. Work log for continuous capture: decisions with reasons, risks, tasks and contacts logged while the work happens, dated, attributed and access-tagged.
3. Redaction on ingestion: API keys, secrets, passwords, connection strings, card numbers, emails and phone numbers.
4. Per-source access tags (Member / Lead only / Private) and a permission gate that runs before any extraction or AI call.
5. Reconstruction pipeline with live progress: permission gate → extraction → quote verification → merge → conflict detection → coverage checklist → questions.
6. AI extraction (Gemini, Claude or any OpenAI-compatible model) with strict JSON schema validation and retry, plus an offline rules engine and automatic fallback.
7. Code-based evidence status for every claim: Verified, Inferred, Conflicting, Missing — with the reason shown.
8. Gap Interview: the leaver answers only conflicts, missing items and uncertain inferences; answers become cited leaver testimony.
9. Review: evidence drawer with the exact highlighted quote, approve / edit / reject, bulk-approve verified, filters, readiness score.
10. Versioned publishing with share links; a successor view with project state, Day 1 / Week 1 plan, owners, open work, risks and decision timeline; per-section acknowledgement; "flag as wrong" that returns to the reviewer; Markdown export and version diff.
11. Activity (audit) log with CSV export; project export/import.
12. Synthetic sample project and downloadable sample files for testing uploads.

## Technology and implementation details
- **Frontend:** React 19 + TypeScript single-page app, hand-written CSS (Inter font), react-icons. Work in progress is stored locally in the browser (IndexedDB); PDF and DOCX are converted to text in the browser with pdf.js and JSZip.
- **Backend:** one TypeScript HTTP API that runs as a Node.js server or a Vercel serverless function. Endpoints for ingestion, GitHub import, reconstruction (streamed NDJSON), Gap Interview, publishing and share links. Inputs validated with zod, per-IP rate limits, strict security headers (CSP).
- **AI layer:** provider adapters for the Google Gemini API, Anthropic Messages API and OpenAI-compatible Chat Completions, selected by environment variable. The model receives only permitted, redacted chunks, each with an id, and must return claims with an exact quote and chunk id in a JSON schema. The model never decides whether a claim is true: code checks the quote against the stored chunk, checks that named people appear in the evidence and that the statement stays within it. Without a key, or if the model fails, an offline rules engine produces the claims and the same checks apply.
- **Analysis:** duplicate merging, owner/date conflict detection, a handover coverage checklist (unowned work, dependencies without a contact, unowned domain/hosting/database/payments, access transfer), and Gap Interview question generation.
- **Storage:** published packages only (approved, role-permitted claims plus the chunks they cite) in Upstash Redis or JSON files.
- **Testing:** 20 core tests, 5 AI-provider contract tests, 27 Playwright browser checks of the full journey including leak checks, 7 AI-path checks over HTTP with a mock model — all passing.
- **APIs, models, libraries, services:** Google Gemini API / Anthropic API / OpenAI-compatible API (configurable), GitHub REST API, Upstash Redis REST, Vercel; React, react-icons, zod, pdf.js, JSZip, esbuild, TypeScript, tsx, Playwright; Inter font (OFL). Datasets: synthetic sample data written by the team. AI assistance: Claude was used as a coding and writing assistant; the team reviewed all decisions.

## Explanation of changes made to the original plan
- **Stack simplified** from Next.js + FastAPI + Supabase to a React app and one TypeScript API, so the same core code runs on the server and in tests and deploys as one project.
- **Local-first storage instead of a server database.** Raw sources stay in the user's browser; only approved, role-filtered packages are stored. Row-Level Security moves to Round 3 together with real accounts.
- **No vector search.** Student-team projects fit in a few extraction batches; exact quote verification matters more than similarity search.
- **More than one AI provider plus an offline rules engine**, so the product works on a free tier and never breaks without a key.
- **Gap Interview, conflict detection, version history and acknowledgement were built in Round 2** (planned for Round 3) because they are central to trust.
- **New: work log for continuous capture**, because the Round 2 brief asks for knowledge to be captured while the work is happening, not only when someone leaves.

## Three major improvements for Round 3
1. **Live connectors with continuous capture.** A Slack/Discord bot (`/baton decision …`) and a GitHub webhook that log decisions, risks and ownership changes as they happen, using scoped read-only OAuth instead of manual exports — so the handover is always nearly ready before anyone leaves.
2. **Ask Baton — grounded Q&A for the successor.** The successor asks questions in plain language; answers are built only from approved claims and their cited source text, always with citations, respect the successor's role, and say "not in the handover" when no evidence exists.
3. **Real accounts and organisation-level access control.** Sign-in, invitations and per-person roles; server-side workspaces protected by Postgres Row-Level Security; signed share links with expiry and revocation; acknowledgements and approvals tied to real identities.
