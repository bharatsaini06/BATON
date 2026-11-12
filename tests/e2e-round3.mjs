// Round 3 browser test: accounts, workspace, live capture (signed Discord + GitHub calls),
// workspace publishing, signed share links (open, revoke) and Ask Baton.
// Usage: npm run build && node tests/e2e-round3.mjs [--shots=dir]
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4319, BASE = `http://localhost:${PORT}`;
const shotsArg = process.argv.find((a) => a.startsWith("--shots="));
const SHOTS = shotsArg ? shotsArg.slice(8) : path.join(root, "tests/screenshots");
mkdirSync(SHOTS, { recursive: true });
const DATA = path.join(root, ".data-test-r3");
rmSync(DATA, { recursive: true, force: true });

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) failures++; };
const keys = crypto.generateKeyPairSync("ed25519");
const env = { ...process.env, PORT: String(PORT), DATA_DIR: DATA, AI_PROVIDER: "none", BATON_NO_RATE_LIMIT: "1", SESSION_SECRET: "e2e-secret-e2e-secret-e2e-secret", DISCORD_PUBLIC_KEY: keys.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex") };
for (const k of ["SUPABASE_URL", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
const server = spawn(process.execPath, ["dist/server.mjs"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
await new Promise((res) => server.stdout.on("data", (d) => String(d).includes("running") && res()));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const consoleErrors = [];
const watch = (p) => { p.on("console", (m) => m.type() === "error" && !/status of 4\d\d/.test(m.text()) && consoleErrors.push(m.text())); p.on("pageerror", (e) => consoleErrors.push(String(e))); };
watch(page);
const shot = (name, p = page) => p.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: true });

try {
  const health = await (await fetch(`${BASE}/api/health`)).json();
  ok(health.accounts?.mode === "builtin" && health.signedLinks === true, "health reports accounts and signed links");

  // ---- create an account and a workspace
  await page.goto(BASE + "/account?mode=signup");
  await shot("r3-01-account");
  await page.locator("#a-name").fill("Anita Rao");
  await page.locator("#a-email").fill("anita@example.test");
  await page.locator("#a-pass").fill("password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/workspace/);
  await page.getByLabel("Workspace name").fill("CodeCraft Club");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByRole("heading", { name: "CodeCraft Club" }).waitFor();
  ok(/Owner/.test(await page.locator(".role-pill").first().innerText()), "creator is the workspace owner");

  // ---- invite a member
  await page.locator("#inv-email").fill("arjun@example.test");
  await page.getByRole("button", { name: "Create invitation link" }).click();
  await page.locator(".invite-row").first().waitFor();
  const inviteUrl = (await page.locator(".invite-row .mono").first().innerText()).trim();
  ok(/\/join\//.test(inviteUrl), "invitation link created");
  await shot("r3-02-members");

  // ---- connectors: add Discord and GitHub, then send signed calls the way the services do
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem("baton:session")).token);
  const api = async (method, p, body, headers = {}) => {
    const r = await fetch(BASE + p, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), authorization: `Bearer ${token}`, ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
    return { status: r.status, j: await r.json().catch(() => ({})) };
  };
  const orgId = (await api("GET", "/api/auth/me")).j.orgs[0].id;
  await page.getByRole("radio", { name: /Live connectors/ }).click();
  await page.getByRole("button", { name: /^Add Discord/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Add connec/ }).click();
  await page.getByText("Interactions Endpoint URL").first().waitFor();
  await page.getByRole("button", { name: /^Add GitHub/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Add connec/ }).click();
  await page.getByText("Payload URL").first().waitFor();
  await shot("r3-03-connectors");
  const conns = (await api("GET", `/api/orgs/${orgId}/connectors`)).j.connectors;
  const dc = conns.find((c) => c.kind === "discord"), gh = conns.find((c) => c.kind === "github");
  const discord = async (name, options, tamper = false) => {
    const raw = JSON.stringify({ type: 2, guild_id: "guild-1", channel_id: "chan-1", member: { user: { id: "u1", username: "riya", global_name: "Riya Sharma" } }, data: { name: "baton", options: [{ type: 1, name, options: Object.entries(options).map(([k, v]) => ({ name: k, type: 3, value: v })) }] } });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = crypto.sign(null, Buffer.from(ts + raw), keys.privateKey).toString("hex");
    const r = await fetch(`${BASE}/api/hooks/discord`, { method: "POST", headers: { "content-type": "application/json", "x-signature-ed25519": sig, "x-signature-timestamp": ts }, body: tamper ? raw.replace("riya", "eve") : raw });
    return { status: r.status, j: await r.json().catch(() => ({})) };
  };
  ok((await discord("decision", { text: "x" }, true)).status === 401, "Discord call with a changed body is rejected");
  ok(/Linked/.test((await discord("link", { code: dc.linkCode })).j.data?.content || ""), "Discord server linked with the one-time code");
  const logged = await discord("decision", { text: "Keep the leaderboard read-only during judging", why: "scores were edited by mistake last year" });
  ok(/Logged decision/.test(logged.j.data?.content || ""), "/baton decision is logged from Discord");
  const ghBody = JSON.stringify({ action: "assigned", issue: { number: 21, title: "Razorpay webhook fails on retries", html_url: "https://github.com/codecraft-club/techfest-app/issues/21" }, assignee: { login: "kabir-k" }, sender: { login: "riya-dev" }, repository: { full_name: "codecraft-club/techfest-app" } });
  const sign = (secret) => "sha256=" + crypto.createHmac("sha256", secret).update(ghBody).digest("hex");
  const ghCall = (secret, id) => fetch(gh.webhookUrl.replace(/^https?:\/\/[^/]+/, BASE), { method: "POST", headers: { "content-type": "application/json", "x-github-event": "issues", "x-github-delivery": id, "x-hub-signature-256": sign(secret) }, body: ghBody });
  ok((await ghCall("wrong-secret", "d-0")).status === 401, "GitHub webhook with a wrong secret is rejected");
  ok((await ghCall(gh.secret, "d-1")).status === 200, "signed GitHub webhook is accepted");

  await page.getByRole("radio", { name: /Capture inbox/ }).click();
  await page.locator(".capture-item").nth(1).waitFor({ timeout: 15000 });
  const inbox = await page.locator(".capture-list").innerText();
  ok(/leaderboard read-only/.test(inbox) && /Razorpay webhook/.test(inbox), "capture inbox shows the Discord and GitHub items");
  await shot("r3-04-capture-inbox");

  // ---- sample project into the workspace, captured items into the work log
  await page.goto(BASE + "/");
  await page.getByRole("button", { name: "Try the sample project" }).click();
  await page.waitForURL(/\/p\/.+\/sources/);
  await page.getByRole("button", { name: /Save to CodeCraft Club/ }).click();
  await page.getByText(/CodeCraft Club · synced/).waitFor();
  ok(true, "project saved to the workspace");
  await page.getByRole("radio", { name: /Live capture/ }).click();
  await page.getByRole("button", { name: /Add all 2 to the work log/ }).click();
  await page.getByText("No new captured items").waitFor();
  ok(true, "captured items added to the project's work log");
  await shot("r3-05-live-capture");

  // ---- reconstruct, approve, publish as the signed-in account
  await page.getByRole("button", { name: /Reconstruct the handover/ }).click();
  await page.waitForURL(/reconstruct/);
  await page.getByRole("button", { name: /Run reconstruction/ }).click();
  await page.locator(".status-tiles").waitFor({ timeout: 30000 });
  await page.goto(page.url().replace("/reconstruct", "/review"));
  await page.getByRole("button", { name: /Approve all verified/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Approve \d+/ }).click();
  await page.getByText(/verified claims approved/).waitFor();
  ok(await page.locator(".claim", { hasText: "leaderboard read-only" }).count() > 0, "the Discord decision became a claim with evidence");
  await page.waitForTimeout(300);
  await page.goto(page.url().replace("/review", "/publish"));
  ok(/Approved by\s+Anita Rao\s+\(your account\)/.test(await page.locator("body").innerText()), "approver is the signed-in account");
  await page.getByRole("button", { name: /Approve & publish v1/ }).click();
  await page.getByText(/is ready for Arjun/).waitFor();
  await page.getByRole("button", { name: "Create share link" }).click();
  await page.locator(".link-row").first().waitFor();
  const shareUrl = (await page.locator(".link-row .mono").first().innerText()).trim();
  ok(/\/h\/.+\?k=/.test(shareUrl), "signed share link created");
  await shot("r3-06-share-links");

  // ---- the successor, on another device, with only the link
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p2 = await ctx2.newPage();
  watch(p2);
  await p2.goto(shareUrl.split("?")[0]);
  await p2.getByText("Handover not available").waitFor();
  ok(/share link, or sign in/.test(await p2.locator("body").innerText()), "without the link the workspace handover does not open");
  await p2.goto(shareUrl.replace(/.$/, (c) => (c === "A" ? "B" : "A")));
  await p2.getByText("Handover not available").waitFor();
  ok(true, "an altered link is refused");
  await p2.goto(shareUrl);
  await p2.getByText(/Opened with a signed share link/).waitFor();
  ok(true, "the signed link opens the handover");
  const body = await p2.locator("body").innerText();
  ok(!body.includes("75,000") && !body.includes("rzp_live"), "Lead-only and Private material is not in the shared handover");

  // ---- Ask Baton
  await p2.getByLabel("Your question").fill("Who owns the leaderboard?");
  await p2.getByRole("button", { name: "Ask", exact: true }).click();
  await p2.locator(".ask-a").first().waitFor();
  ok(/Kabir/.test(await p2.locator(".ask-a").first().innerText()) && await p2.locator(".ask-a .ask-cite").count() > 0, "Ask Baton answers with a citation");
  await p2.locator(".ask-a .ask-cite").first().click();
  ok(await p2.locator(".drawer").count() > 0, "a citation opens the evidence");
  await p2.keyboard.press("Escape");
  await p2.getByLabel("Your question").fill("What is the wifi password of the lab?");
  await p2.getByRole("button", { name: "Ask", exact: true }).click();
  await p2.getByText("Not in the handover.").waitFor();
  ok(true, "Ask Baton says when the handover does not cover a question");
  await p2.getByLabel("Your question").fill("What did we pay the sponsors and what is the Razorpay key?");
  await p2.getByRole("button", { name: "Ask", exact: true }).click();
  await p2.locator(".ask-thread > div").nth(2).waitFor();
  const askText = await p2.locator(".ask-thread").innerText();
  ok(!askText.includes("75,000") && !askText.includes("rzp_live"), "Ask Baton cannot reveal withheld material");
  await shot("r3-07-ask-baton", p2);
  await p2.locator("#sec-plan").getByRole("button", { name: "Acknowledge" }).click();
  await p2.getByText(/Acknowledged by Arjun/).first().waitFor();
  ok(true, "acknowledgement through the link is recorded");

  // ---- revoke: the same link stops working
  await page.reload();
  await page.locator(".link-row").first().waitFor();
  ok(/opened [1-9]/.test(await page.locator(".link-row").first().innerText()), "reviewer sees that the link was opened");
  await page.getByRole("button", { name: "Revoke" }).click();
  await page.getByText(/Link revoked/).waitFor();
  await p2.goto(shareUrl);
  await p2.getByText("Handover not available").waitFor();
  ok(/revoked/.test(await p2.locator("body").innerText()), "a revoked link no longer opens");
  await shot("r3-08-revoked", p2);

  // ---- the invited member joins and sees only what a Member may
  await p2.goto(inviteUrl.replace(/^https?:\/\/[^/]+/, BASE));
  await p2.getByRole("link", { name: "Create account to join" }).click();
  await p2.locator("#a-name").fill("Arjun Mehta");
  await p2.locator("#a-pass").fill("password-456");
  await p2.getByRole("button", { name: "Create account" }).click();
  await p2.getByRole("button", { name: /Accept as Arjun Mehta/ }).click();
  await p2.waitForURL(/\/workspace/);
  await p2.getByRole("heading", { name: "CodeCraft Club" }).waitFor();
  ok(await p2.getByRole("radio", { name: /Live connectors/ }).isDisabled(), "a Member cannot manage connectors");
  await p2.getByRole("radio", { name: /Handovers/ }).click();
  await p2.getByText("TechFest 2026 Event App").first().waitFor();
  await p2.goto(shareUrl.split("?")[0]);
  await p2.getByText(/Opened as/).waitFor();
  ok(/workspace role: Member/.test(await p2.locator(".access-bar").innerText()), "the Member opens the handover with their own account");
  await shot("r3-09-member-view", p2);
  const mTok = await p2.evaluate(() => JSON.parse(localStorage.getItem("baton:session")).token);
  const asMember = (p, method = "GET", b) => fetch(BASE + p, { method, headers: { authorization: `Bearer ${mTok}`, ...(b ? { "content-type": "application/json" } : {}) }, body: b ? JSON.stringify(b) : undefined });
  const pid = page.url().match(/\/p\/([^/]+)/)[1];
  const mList = await (await asMember(`/api/orgs/${orgId}/projects`)).json();
  ok(mList.projects.length === 0 && (await asMember(`/api/projects/${pid}`)).status >= 400, "a Member cannot list or open workspace projects (raw sources)");
  ok((await asMember(`/api/orgs/${orgId}/connectors`, "POST", { kind: "github", defaultAccess: "member" })).status === 403, "a Member cannot add a connector");

  ok(consoleErrors.length === 0, `no browser console errors${consoleErrors.length ? ": " + consoleErrors.slice(0, 3).join(" | ") : ""}`);
} catch (e) {
  failures++;
  console.error("FAIL  test aborted:", e.message.split("\n").slice(0, 6).join("\n"));
  await shot("r3-error").catch(() => {});
} finally {
  await browser.close();
  server.kill();
  rmSync(DATA, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll Round 3 browser checks passed");
process.exit(failures ? 1 : 0);
