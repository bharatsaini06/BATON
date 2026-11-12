# CodersInPune Round 3 — submission text (Team ATHRAV)

Copy each block into the form. Replace every **[bracketed]** item first.

## Final working project link
https://baton-henna.vercel.app — the sample works with no sign-in (*Try the sample project*). To see accounts, connectors and signed links: *Sign in → Create account*.

## Source-code repository
https://github.com/bharatsaini06/BATON (public)

## Updated project PDF
**[Drive link to the Round 3 PDF — Anyone with the link → Viewer, tested in a private window]**

## Completed improvements (the three named in Round 2)
1. **Live connectors with continuous capture — done.** `/baton decision | risk | task | owner | note` from Discord (Slack uses the same command), and a GitHub webhook that logs issue assignments, merged pull requests and `Decision:` / `Risk:` lines. Each request is verified by signature, secrets are redacted on arrival, each item has an access tag. Items arrive in a workspace Capture inbox and enter a project's work log, where the same permission gate, extraction and quote check apply.
2. **Ask Baton, grounded Q&A — done.** The successor asks in plain language. Answers use only approved claims from that role-filtered handover, every sentence has citations that open the evidence, code removes any model sentence its cited facts do not support, and Baton answers "Not in the handover" (and tells the reviewer) when nothing approved covers the question.
3. **Real accounts and organisation access control — done.** Sign-in, workspaces, invitation links, roles per person (Member / Lead / Owner); workspace data in Postgres protected by Row-Level Security; signed share links with expiry, revocation and open counts; approvals, acknowledgements, flags and questions tied to the signed-in account.

## Other fixes since Round 2
- Projects saved to a workspace open on any device (Round 2: one browser only).
- Identity comes from the account in a workspace (Round 2: chosen per step).
- README placeholders removed; team and links filled in.

## Technical details
- **Frontend:** React 19 + TypeScript; new Account, Workspace (members, connectors, capture inbox, handovers), Live capture panel, signed-link manager and Ask Baton panel.
- **Backend:** one TypeScript API (Node server or Vercel function). New: auth, workspaces, invitations, roles, workspace projects and packages, signed links, connector webhooks (`/api/hooks/discord`, `/api/hooks/github/:id`, `/api/hooks/slack`), capture inbox, `/api/ask`.
- **Access control:** Supabase Auth + Postgres. Calls for a signed-in person carry that person's token, so Row-Level Security policies decide what they read or write; the service key is used only after the server has verified a webhook signature, an invitation or a signed link.
- **Signatures:** Discord Ed25519, GitHub HMAC-SHA256, Slack signing secret, share links HMAC-SHA256 with expiry and a revocation check in the database.
- **Ask Baton:** keyword retrieval over approved claims → model prompted with numbered facts only → each returned sentence checked against its cited facts in code → unsupported sentences dropped → fallback to the approved facts as written.
- **Services / libraries:** Supabase (Postgres, Auth), Discord Interactions API, GitHub Webhooks, Google Gemini / Anthropic / OpenAI-compatible APIs (configurable), Upstash Redis, Vercel; React, zod, pdf.js, JSZip, esbuild, Playwright. AI assistance: Claude was used as a coding and writing assistant; the team reviewed the decisions.

## Testing notes
Type-check clean. Round 2 suites still pass (20 core, 5 provider contracts, 27 browser, 7 AI path). New: 14 Round 3 unit/API tests, 48 Row-Level Security checks on PostgreSQL 16, 29 browser checks of the Round 3 journey. Live check on the deployed site: **[write what you confirmed with the checklist in docs/CONNECTORS.md — date, what worked, anything that did not]**. Feedback from people who tried it: **[add real notes only]**.

## Known limitations
See README → Known limitations (connectors are signed commands and webhooks, not OAuth; Slack not run against a live workspace; Private sources stay on the author's device; no password-reset email).

## Team-member contributions
| Member | Contribution |
|---|---|
| Bharat Saini (team lead) | **[what Bharat did — backend]** |
| Chitransh Nagar | **[AI / ML]** |
| Bhavishay Jhalani | **[frontend]** |
| Dhaksh Sharma | **[research]** |
