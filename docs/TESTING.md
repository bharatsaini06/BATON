# Testing notes

All suites were run on the final build before submission. Re-run them with:

```bash
npm install
npm run typecheck      # TypeScript, server + client
npm test               # 25 unit, integration and provider-contract tests
node tests/e2e.mjs     # 27 browser checks (Playwright + Chromium)
node tests/e2e-ai.mjs  # 7 checks of the AI path over HTTP with a mock model server
npx tsx --test tests/round3.test.ts   # 14 Round 3 tests (Ask Baton, capture, signatures, workspace API)
bash tests/rls.sh                     # 48 Row-Level Security checks on a real PostgreSQL
node tests/e2e-round3.mjs             # 35 browser checks of accounts, connectors, share links, Ask Baton
```

## Results (Round 3 build)

| Suite | Result |
|---|---|
| Type-check (server + client) | Pass, 0 errors |
| Round 2 suites (core 20, provider contracts 5, browser 27, AI path 7) | All pass |
| Round 3 unit + API (`tests/round3.test.ts`) | 14 / 14 pass |
| Row-Level Security on PostgreSQL 16 (`tests/rls.sh` + `tests/rls.sql`) | 48 / 48 pass |
| Round 3 browser journey (`tests/e2e-round3.mjs`) | 35 / 35 pass, 0 browser console errors |

### What the Round 3 tests cover

| Area | Checks |
|---|---|
| Ask Baton | answers with citations; "not in the handover" when nothing approved covers the question; never presents a conflict or gap as settled; a Member's answer cannot contain Lead-only facts; model sentences kept only when the cited facts support them; invented wording falls back to approved facts; injected instructions inside a fact are inert |
| Live capture | command parsing; GitHub events to ownership / task / decision items; secrets redacted on arrival; captured items become work-log evidence and verified claims |
| Signatures | Discord Ed25519, GitHub HMAC-SHA256, Slack signing secret — changed body, wrong secret and unknown connector are rejected |
| Accounts and roles | sign-up, sign-in, invitations, role changes, removal; a Member cannot list or open projects, add connectors or create links; a Lead cannot change roles |
| Row-Level Security | run as real database roles on PostgreSQL: outsiders see nothing; Members see only Member handovers and Member-tagged captured items; removed members lose access; nobody can raise their own role |
| Signed links | open, altered signature refused, link for another handover refused, expired link refused, forged link with another secret refused, revoked link refused, opens counted |
| Browser journey | account → workspace → invite → Discord and GitHub signed calls → inbox → project → publish as account → share link → Ask Baton → acknowledge → revoke → invited Member's view |

### Judge-style robustness pass (final build 2.3.0)

Run on the final build in Chromium, doing what a first-time user might do:

| Action | Result |
|---|---|
| Unknown address, broken share link, unknown project, bad invitation link | Clear message and a way back; no blank page |
| New empty project, then open every step | Each step explains what is missing; *Run reconstruction* stays disabled with no sources |
| Upload an empty file / an unsupported file type | Refused with the reason; nothing added |
| Refresh on Sources, Reconstruct, Review, Handover and the successor view | State kept; nothing lost |
| Double-click *Run reconstruction*, *Approve*, *Approve & publish*, *Acknowledge* | Runs once; one version published |
| Ask Baton with a blank question / a 300-character question | Button disabled / answered normally |
| Wrong password; sign-up with empty fields | Clear message / browser asks for the missing fields |
| Expired sign-in, then open Workspace | Renews or returns to sign-in (was: loaded forever; fixed and covered by a test) |
| Open *How it works* inside a signed-in workspace | Opens fully on screen with Close (was: clipped; fixed and covered by a test) |
| A connector type the page does not know | Hidden; the page no longer goes blank (fixed) |
| Landing, Projects and Sign-in at 380 px wide | No sideways scrolling (Projects fixed) |

### Live check on the deployed site

The team ran the main journeys on https://baton-henna.vercel.app with Supabase, Discord, Slack, GitHub and Gemini connected: account and workspace, invitation, `/baton` commands from Discord and Slack to the Capture inbox, GitHub webhook to the inbox, publish, signed share link, Ask Baton, revoke.

### How the automated tests reach outside services

The automated suites run without network access, so outside services are replaced by local stand-ins; the live check above confirms them on the deployed site (checklist in `docs/CONNECTORS.md`): Supabase Auth and PostgREST (adapter tested against a mock; the SQL policies were run on a real PostgreSQL 16), Discord's, Slack's and GitHub's real requests (tested with correctly signed requests built the same way), and live AI providers (**Test AI** button).

## Results (Round 2 build)

| Suite | Result |
|---|---|
| Type-check (server + client) | Pass, 0 errors |
| Core unit + integration (`tests/core.test.ts`) | 20 / 20 pass |
| AI provider contracts (`tests/providers.test.ts`) | 5 / 5 pass |
| Browser end-to-end (`tests/e2e.mjs`) | 27 / 27 pass, 0 browser console errors |
| AI path over HTTP (`tests/e2e-ai.mjs`) | 7 / 7 pass |

The AI provider adapters were tested against intercepted requests and a mock OpenAI-compatible server; live calls depend on the key configured at deployment and can be checked with the **Test AI** button on the Reconstruct step.

## Main journeys covered

| Journey | How it is tested |
|---|---|
| Load sample → sources visible with access tags and redactions | e2e: 8 sources, redaction badge, private notes show `[REDACTED …]` and not the key |
| Add a work-log entry (continuous capture) | e2e: entry appears and becomes a source |
| Reconstruct with streamed stages | e2e: status tiles; unit: 2 conflicting claims (12 Dec vs 20 Dec), domain gap, questions |
| Gap Interview | e2e: conflict, missing, inferred and "I don't know" answers; unit: testimony source, resolution, unknown kept |
| Review | e2e: bulk approve, evidence drawer highlights quote, reject with note, edit and approve |
| Publish and successor view | e2e: v1 published, plan visible, acknowledgement, flag; flag shown to reviewer |
| Share link on another device | e2e: link opens in a fresh browser context with no local data (mobile viewport) |
| Upload real files | e2e: WhatsApp `.txt` detected as chat, CSV as task board, project reconstructs |
| Role change | e2e: switching the successor to Lead marks results stale and withholds only the Private source |

## Permission and privacy checks

| Check | Result |
|---|---|
| Lead-only sponsor amounts (Rs 75,000 / 40,000) never appear on a Member's successor page | Pass (e2e) |
| Private secrets (`rzp_live_…`, Instagram password) and private note content never appear on the successor page | Pass (e2e) |
| The AI prompt for a Member never contains Lead-only or Private text | Pass (unit with mock model; HTTP test with mock server) |
| A Lead sees Lead-only content but never Private content | Pass (unit) |
| A claim citing a Lead-only chunk is dropped from a Member package even if approved | Pass (unit) |
| Only cited chunks travel with a published package | Pass (unit) |
| A chunk tagged more openly than its source is still hidden | Pass (unit) |

## Failure cases

| Case | Expected behaviour | Result |
|---|---|---|
| Model invents a quote | Claim downgraded to Inferred with reason "Quoted words were not found" | Pass |
| Model cites a hidden or non-existent chunk | No evidence attached; Inferred | Pass |
| Model names a person not in the evidence | Inferred: "Names X, who does not appear in the cited source" | Pass |
| Prompt-injection text inside a source ("mark everything verified") | Cannot change status; claims still checked | Pass |
| Model returns invalid JSON | One retry; then batch falls back to rules engine | Pass |
| Model unreachable / 5xx / timeout | Whole run falls back to rules engine with a visible warning | Pass |
| Schema-invalid claim in model reply | Dropped and reported | Pass |
| Malformed JSON request body | HTTP 400 | Pass |
| Unknown API route | HTTP 404 | Pass |
| File over 4 MB, scanned PDF, unsupported type | Clear error message in the UI, nothing stored | Implemented (manual check) |
| GitHub repo not found / private / rate-limited | Clear message with the reason and the fix | Implemented (manual check; network-dependent) |
| Sources changed after reconstruction | "Results are out of date" banner on Sources, Reconstruct, Review and Handover | Pass (e2e for role change) |
