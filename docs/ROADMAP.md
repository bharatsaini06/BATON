# Baton — product roadmap

Baton today covers one handover end to end: capture, reconstruction, verification, Gap Interview, review, a role-safe package, Ask Baton, workspaces with roles, and live capture from Discord, Slack and GitHub. The roadmap below keeps the same rule that makes Baton trustworthy: **a statement is only as strong as the source it can point to**, and the successor never receives what their role may not see.

## Who it is for first

College clubs, student startups and hackathon teams, where people leave every semester and knowledge lives in WhatsApp, Discord, GitHub and a few documents. The same flow fits small companies and NGOs with high turnover.

## Next 30 days — pilot and close the gaps

| Item | Why |
|---|---|
| Pilot with two or three college clubs during their end-of-semester handovers | Real handovers, real feedback; measure the outcomes below |
| Password reset and invitation emails | Today invitations are links and there is no reset email |
| OCR for scanned PDFs | Scanned notes are rejected today |
| Hindi and Hinglish patterns in the offline rules engine | Many student chats mix languages; the AI path already handles them |
| Google Drive and Notion import | The two most common document stores after GitHub |
| More conflict types (budgets and amounts, a decision later reversed) | Conflicts cover owners and dates today |

## 3 months — catch the risk before someone leaves

| Item | Why |
|---|---|
| Knowledge-risk view: work, accounts and decisions that only one person can explain | Shows the gap while the person is still around |
| Weekly capture reminders in Discord | Keeps the work log alive without extra meetings |
| Microsoft Teams, and channel-scoped OAuth for Slack and Discord history | Today Slack and Discord capture /baton commands; OAuth adds past messages from chosen channels |
| Jira, Linear and Trello live sync | Task ownership changes arrive without exports |
| Encrypted sync for Private sources | Private notes are device-only today |

## 6 months — from one handover to an organisation's memory

| Item | Why |
|---|---|
| Ask Baton across every approved handover in a workspace, still role-filtered | New members can ask "how did we handle sponsors last year?" |
| Google Workspace sign-in for colleges and single sign-on | Fits how institutions manage accounts |
| Self-hosted package (Docker + Postgres) | For teams that must keep data on their own servers |
| Handover templates per role (treasurer, tech lead, event head) | Coverage checks tuned to what each role must pass on |

## How we will measure it

- Time for a successor to make their first useful contribution, with and without a Baton handover.
- Share of Ask Baton questions answered with a source vs "not in the handover" (the second number shows where handovers are thin).
- Share of claims Verified before review, and flags raised by successors after handover.
- Number of facts captured live per week, per team.

## What will not change

- Code, not the model, decides whether a claim is Verified.
- The permission gate runs before any AI call.
- A person approves every claim before anyone else sees it.
