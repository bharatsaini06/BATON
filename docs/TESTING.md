# Testing notes

All suites were run on the final build before submission. Re-run them with:

```bash
npm install
npm run typecheck      # TypeScript, server + client
npm test               # 25 unit, integration and provider-contract tests
node tests/e2e.mjs     # 27 browser checks (Playwright + Chromium)
node tests/e2e-ai.mjs  # 7 checks of the AI path over HTTP with a mock model server
```

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

## Structured feedback

**[Add 3–5 short notes from classmates or club members who tried the deployed link, e.g. "Found the evidence drawer immediately; wanted a way to filter by person." Report only real feedback.]**
