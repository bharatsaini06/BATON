# Architecture and technical decisions

## Data flow

1. **Ingest (server, stateless).** The browser sends a file's text (PDF and DOCX are converted to text in the browser with pdf.js and JSZip, so binaries never leave the device), a pasted text, a GitHub repository name, or work-log entries.
   - Format detection: WhatsApp (Android and iOS export formats, multi-line messages), Discord (DiscordChatExporter JSON), Slack (export JSON), task boards (CSV with Name/Status/Assignee/Due columns), Markdown and plain text.
   - Each source is split into **chunks** with a precise **locator**: file + line range + heading, PDF page, chat author + message time, CSV row, GitHub issue/PR number + URL, commit SHA, or Gap Interview question.
   - **Redaction** runs on every chunk before it is returned: private keys, API keys (OpenAI/Anthropic style, Razorpay, AWS, Google, GitHub, Slack), JWTs, `KEY=value` and `password: value` secrets, connection strings, Luhn-valid card numbers, emails and phone numbers. Counts are shown per source.
2. **Store (browser).** The project — sources, chunks, work log, claims, review decisions, audit log — is saved in IndexedDB (memory fallback in private browsing). The server keeps nothing at this point.
3. **Reconstruct (server, streamed).** `POST /api/generate` returns NDJSON progress events and a final result.
   1. **Permission gate** — keeps only chunks whose (source, chunk) access tag the successor role may see. A chunk is never more visible than its source. Private is never visible to a successor.
   2. **Extraction** — either the AI model (prompted with numbered chunks, strict JSON schema, one retry on invalid JSON, concurrency 3, up to 8 batches of about 12k characters) or the offline rules engine (sentence patterns for decisions, ownership, open work, deadlines, risks, dependencies, contacts, recurring problems and next steps; structured handling of work-log entries, CSV rows and GitHub issues). If an AI batch fails, its chunks go to the rules engine and a warning is shown.
   3. **Verification** — for each candidate the code searches the cited chunk for the quote (exact, then whitespace/quote/dash-normalised, then ellipsis fragments, then punctuation-insensitive). If the cited id is wrong it searches the other *visible* chunks. A claim is **Verified** only if the quote is found, the basis is "stated", every named person appears in the evidence, and at least a third of the statement's content words appear in the chunk. Otherwise it is **Inferred** with the reason recorded.
   4. **Merge** — near-duplicates (same type, ≥0.72 token overlap or identical quote) pool their evidence. At most 14 claims per type, ranked by status, confidence and evidence count.
   5. **Conflicts** — owner and date claims of the same type about the same subject (token overlap) but with different values, from different chunks, are both marked **Conflicting** with the other source named.
   6. **Coverage checklist** — adds **Missing** items: open work with no owner, dependencies with no contact, assets mentioned but unowned (domain, hosting, database, payment gateway, social accounts, budget), no description of access transfer, no decisions, no open work.
   7. **Questions** — one per conflict group, one per missing item, plus up to five highest-confidence inferred claims.
4. **Gap Interview (server, stateless).** Answers become a **leaver testimony** source (access = successor's role level). Conflict and missing answers create new Verified claims citing the testimony and mark the originals resolved; "Yes" confirms an inferred claim; "No" rejects it; "I don't know" keeps the gap and records that it is confirmed unknown.
5. **Review (browser).** Approve, edit (original wording kept), reject (with note), bulk-approve verified. Readiness score = 45% verified share + 35% reviewed share + 10 if no unresolved conflicts + up to 10 for few open gaps.
6. **Publish (server).** `POST /api/publish` builds a **package**: approved/edited claims only, dropped automatically if any cited chunk is not visible to the role, plus only the cited chunks, a Day 1 / Week 1 plan, a decision timeline, the number of withheld sources and a diff from the previous version. The package is stored (Upstash Redis REST, JSON file, or memory) and in the browser.
7. **Successor view.** Loads the package from the browser or the server. Acknowledgements and flags are saved locally and sent to the server when the package is stored there; flags appear in the reviewer's screen.

## Why these decisions

| Decision | Reason |
|---|---|
| Status decided by code, not the model | Research on generative search found only 51.5% of sentences fully supported by their own citations (Liu et al., 2023). A citation is not proof; a string match against stored text is checkable. |
| Gate before the AI | The model cannot leak what it never receives. This also means the AI provider only ever processes text the successor is entitled to. |
| Local-first workspace | Raw sources (chats, notes) are the most sensitive data. Keeping them in the browser removes a whole class of server-side risk for the demo; only approved, filtered packages are stored. |
| Rules engine fallback | The demo must never break because of a missing key, a quota or an outage. Same verifier and permissions apply. |
| Typed claims over summaries | Small claims can each be checked, cited, reviewed, edited, rejected, versioned and acknowledged. |
| Committed build output | Deploys on Vercel/Render without any build step, so the judged link is reproducible. |

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Version, AI provider/model, storage mode |
| POST | `/api/ai/test` | Round-trip test of the configured model |
| GET | `/api/sample` | Synthetic sample project |
| POST | `/api/ingest/upload` | Parse + redact text (or PDF/DOCX pages) into a source |
| POST | `/api/ingest/github` | Import a public repository (read-only) |
| POST | `/api/ingest/worklog` | Build work-log sources from entries |
| POST | `/api/generate` | Run the pipeline (NDJSON stream) |
| POST | `/api/interview` | Apply Gap Interview answers |
| POST | `/api/publish` | Build and store a handover package |
| GET | `/api/share/:id` | Load a package |
| POST | `/api/share/:id/ack` | Acknowledge a section |
| POST | `/api/share/:id/flag` | Flag a claim as wrong |

All inputs are validated with zod; bodies are limited to 8 MB (4.5 MB on Vercel). Rate limits per IP: generate 40 / 10 min, GitHub import 20 / 10 min, AI test 10 / 10 min. Security headers: strict Content-Security-Policy (no third-party scripts), `X-Frame-Options: DENY`, `nosniff`, referrer and permissions policies.

## Evidence model

```
Source   id · name · kind · format · access · stats(chunks, chars, redactions) · warnings
  └─ Chunk   id · text (redacted) · locator · author · time · access · meta
Claim    id · type · statement · subject · field · value · basis · status · statusReason
         evidence[ chunkId · sourceId · quote · match ] · conflictGroup · resolvedBy
         engine (ai | rules | worklog | testimony | coverage) · review{decision, by, at, note, original}
Package  id · version · role · approvedBy/At · claims · cited chunks · plan · timeline
         hiddenSources · excluded · changes · acknowledgements · flags
```
