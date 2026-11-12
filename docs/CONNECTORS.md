# Live connectors and accounts — setup

All secrets go into the host's environment variables (Vercel → Project → Settings → Environment Variables), never into the repository. Redeploy after changing them. `/api/health` shows what is switched on.

## 1. Accounts and Row-Level Security (Supabase)

1. Create a project at supabase.com.
2. Authentication → Sign In / Providers → Email → turn **Confirm email** off (the free plan sends very few emails per hour; Baton invitations are links, not emails).
3. SQL Editor → New query → paste all of `supabase/schema.sql` → Run. It is safe to run again.
4. Project Settings → API → set on the host:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_ANON_KEY` (or `SUPABASE_PUBLISHABLE_KEY`) | anon / publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`) | service_role / secret key |
| `SESSION_SECRET` (or `SHARE_LINK_SECRET`) | any random string of 40+ characters; signs share links |

`/api/health` then shows `"accounts": {"mode": "supabase", "rls": true}`. Without these variables Baton uses built-in accounts stored in the package store, with the same role checks.

How access is enforced: each request made for a signed-in person reaches Postgres with that person's own token, so the policies in `schema.sql` decide what they can read or write. The service key is used only for creating a workspace with its first owner, accepting an invitation, inbound webhooks, and opening a handover through a verified signed link.

## 2. Discord

1. discord.com/developers/applications → New Application. Set on the host: `DISCORD_APP_ID` (or `DISCORD_APPLICATION_ID`), `DISCORD_PUBLIC_KEY`, and `DISCORD_BOT_TOKEN` (Bot → Reset Token). Redeploy.
2. In Baton: Workspace → Live connectors → **Add Discord**.
3. In the Developer Portal → General Information → **Interactions Endpoint URL** = the Endpoint URL shown on the connector card (`https://<your-site>/api/hooks/discord`). Discord checks the signature when you save.
4. On the connector card press **Register command**, then use the install link to add the app to your server.
5. In the server: `/baton link code:<code from the card>`.
6. Log knowledge at any time:

| Command | Example |
|---|---|
| `/baton decision` | text: Use Razorpay · why: UPI is a must |
| `/baton risk` | text: Domain expires in March |
| `/baton task` | text: Fix the webhook @arjun due 2026-12-01 |
| `/baton owner` | text: payments -> Riya |
| `/baton note` | text: Venue office closes at 5 pm |

Each command accepts `visibility: member | lead`. A Lead-only item never reaches a Member's inbox or handover.

## 3. GitHub webhook

1. Workspace → Live connectors → **Add GitHub webhook**. The card shows a Payload URL and a Secret.
2. Repository → Settings → Webhooks → Add webhook: paste the Payload URL, content type `application/json`, paste the Secret, choose *Let me select individual events* → Issues, Issue comments, Pull requests, Pushes.
3. What is captured: an issue opened, assigned, unassigned, closed or reopened; a pull request opened, merged or sent for review; and any line starting with `Decision:`, `Risk:`, `Task:`, `Owner:` or `Note:` in an issue, pull request, comment or commit message.

## 4. Slack (optional)

Create a Slack app with a slash command `/baton` whose Request URL is `https://<your-site>/api/hooks/slack`, set `SLACK_SIGNING_SECRET`, add a Slack connector in Baton and run the `/baton link …` command shown on its card.

## 5. From capture to handover

Captured items appear in Workspace → Capture inbox. In a workspace project open Sources → **Live capture** → *Add to the work log*. From there they are ordinary evidence: permission gate, extraction, quote verification, review and publishing all apply.

## Checklist after deploying

1. `/api/health` shows `accounts.mode: "supabase"`, `connectors.discord: true`, an AI provider, and durable storage.
2. Create an account, create a workspace, invite a second email as Member and accept in a private window.
3. `/baton decision …` in Discord → item appears in the Capture inbox within seconds.
4. Assign an issue in the GitHub repository → item appears.
5. Load the sample → *Save to <workspace>* → Live capture → add → Reconstruct → Review → publish.
6. Create a share link → open it in a private window → Ask Baton a question → revoke the link → reload: it no longer opens.
