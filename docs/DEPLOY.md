# Deploying Baton

The repository contains the built app (`public/`) and server (`dist/`), so hosting needs **no install and no build step**.

## Option A — Vercel (recommended, free, always on)

1. Create a **public** GitHub repository and push this folder to it:
   ```bash
   git init
   git add .
   git commit -m "Baton — Round 2 build"
   git branch -M main
   git remote add origin https://github.com/<your-username>/baton.git
   git push -u origin main
   ```
   (Or upload the folder on github.com with *Add file → Upload files*.)
2. Go to [vercel.com](https://vercel.com), sign in with GitHub, click **Add New → Project**, choose the repository and click **Deploy**. Keep every setting as it is — `vercel.json` sets the output folder, the API function and the routes.
3. **AI (optional, free):** get a key at [Google AI Studio](https://aistudio.google.com/apikey). In Vercel open *Project → Settings → Environment Variables*, add `GEMINI_API_KEY`, then *Deployments → … → Redeploy*. The header pill changes from "Rules engine (offline)" to "AI: Google Gemini". Use **Test AI** on the Reconstruct step to confirm.
   - Other providers: `ANTHROPIC_API_KEY`, or `OPENAI_API_KEY` (+ `AI_BASE_URL` for Groq/OpenRouter). Set `AI_MODEL` to choose a model.
4. **Durable share links (recommended):** in Vercel open *Storage → Create → Upstash (Redis)* (free plan), connect it to the project, then redeploy. Baton reads `KV_REST_API_URL` / `KV_REST_API_TOKEN` or `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`. `/api/health` then shows `"storage": {"mode": "upstash", "durable": true}`.
5. **Check like a judge:** open the deployment URL in a private/incognito window → *Try the sample project* → run through to the successor view. Open `/api/health` to confirm the AI and storage settings.

### Round 3 additions (accounts, connectors, signed links)

6. **Accounts with Row-Level Security:** create a Supabase project, run `supabase/schema.sql`, and add `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `SESSION_SECRET`. 
7. **Discord:** add `DISCORD_APP_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`.
8. Redeploy, then follow the step-by-step guide and checklist in [CONNECTORS.md](CONNECTORS.md).

## Option B — Render (free web service)

1. Push to GitHub as above.
2. On [render.com](https://render.com): *New → Blueprint* → select the repository (it reads `render.yaml`), or *New → Web Service* with start command `node dist/server.mjs`.
3. Add `GEMINI_API_KEY` under *Environment* if you want AI extraction.
4. Note: free Render services sleep after inactivity; the first request can take ~50 seconds. Published packages are stored on the instance disk and are lost on redeploy unless you add Upstash variables.

## Option C — any computer with Node.js 18.17+

```bash
node dist/server.mjs            # http://localhost:3000
PORT=8080 GEMINI_API_KEY=... node dist/server.mjs
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| Header says "Rules engine (offline)" after adding a key | Redeploy after setting the variable; check the variable name |
| **Test AI** fails with 400/404 model error | Set `AI_MODEL` to a model your key can use (for example a current Gemini Flash model) |
| **Test AI** fails with 429 | Provider quota reached; the app keeps working with the rules engine |
| GitHub import says rate limit | Add `GITHUB_TOKEN` (a fine-grained token with public read access) |
| Share link shows "not found" on another device | Add Upstash storage (step 4) and publish again |
| "Upload is too large" | Export a shorter chat date range or split the file (4 MB per file on Vercel) |
