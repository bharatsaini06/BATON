// Round 3 tests: Ask Baton, live capture, signatures, the workspace API (accounts, roles, signed
// links, connectors) and the Supabase adapter contract. Run: npm test
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { runPipeline } from "../src/core/pipeline";
import { buildPackage } from "../src/core/plan";
import { createSampleProject } from "../src/core/sample";
import { ask, retrieve, verifyAnswer } from "../src/core/ask";
import { parseCommand, taggedLines, fromGithub, makeEvent, toLogEntry } from "../src/core/capture";
import { worklogSources } from "../src/core/worklog";
import { signToken, verifyToken, hashPassword, checkPassword, verifyDiscord, verifyGithub, verifySlack, hmac } from "../server/crypto";
import { supabaseDb, supabaseAuth } from "../server/db";
import type { Project, SharePackage } from "../src/core/types";

async function samplePackage(role: "member" | "lead" = "member"): Promise<{ p: Project; pkg: SharePackage }> {
  const p = createSampleProject("r3proj");
  p.successorRole = role;
  const out = await runPipeline({ project: p.title, leaver: p.leaver, successor: p.successor, successorRole: role, people: p.people, sources: p.sources });
  p.claims = out.claims.map((c) => ({ ...c, review: { decision: "approved" as const } }));
  p.questions = out.questions; p.run = out.run;
  return { p, pkg: buildPackage(p, "Prof. Anita Rao") };
}

// ---------------------------------------------------------------- Ask Baton
test("ask: answers from approved facts with citations, owner fact first", async () => {
  const { pkg } = await samplePackage();
  const r = await ask(pkg, "Who owns the payment webhook?");
  assert.equal(r.found, true);
  assert.match(r.sentences[0].text, /Riya Sharma owns webhook fixes/);
  for (const s of r.sentences) { assert.ok(s.claimIds.length > 0); for (const id of s.claimIds) assert.ok(pkg.claims.some((c) => c.id === id)); }
});

test("ask: says 'not in the handover' when no approved fact covers the question", async () => {
  const { pkg } = await samplePackage();
  for (const q of ["What is the wifi password?", "How much did ByteForge pay?", "Who is the hostel warden?"]) {
    const r = await ask(pkg, q);
    assert.equal(r.found, false, q);
    assert.equal(r.sentences.length, 0);
  }
});

test("ask: never presents a conflict or a gap as settled", async () => {
  const { pkg } = await samplePackage();
  const demo = await ask(pkg, "When is the sponsor demo?");
  assert.match(demo.sentences[0].text, /^Unresolved conflict/);
  const domain = await ask(pkg, "Who handles the domain renewal?");
  assert.match(domain.sentences[0].text, /^Known gap/);
});

test("ask: a Member's answers cannot contain Lead-only facts (they are not in the package)", async () => {
  const member = await samplePackage("member");
  const lead = await samplePackage("lead");
  const leadOnly = lead.pkg.chunks.filter((c) => c.access === "lead");
  assert.ok(leadOnly.length > 0, "the Lead package cites Lead-only evidence");
  assert.equal(member.pkg.chunks.filter((c) => c.access !== "member").length, 0);
  const text = JSON.stringify(await ask(member.pkg, "What did the sponsor ByteForge agree to pay and when?"));
  assert.ok(!/75,?000|40,?000/.test(text));
  assert.ok(/75,?000|40,?000/.test(JSON.stringify(lead.pkg)), "the amounts exist for a Lead");
});

test("ask: model sentences are kept only when their cited facts support them", async () => {
  const { pkg } = await samplePackage();
  const q = "Why did we choose Razorpay?";
  const { hits } = retrieve(pkg, q);
  const good = verifyAnswer({ found: true, sentences: [{ text: "Payments stay on Razorpay instead of Stripe because UPI is a must for students.", facts: ["F1"] }] }, q, hits, pkg);
  assert.equal(good.sentences.length, 1);
  const invented = verifyAnswer({ found: true, sentences: [
    { text: "Razorpay was chosen because the founder's cousin works there and gave a 90% discount.", facts: ["F1"] },
    { text: "Stripe is banned in India.", facts: [] },
    { text: "Payments stay on Razorpay.", facts: ["F99"] },
  ] }, q, hits, pkg);
  assert.equal(invented.sentences.length, 0);
  assert.equal(invented.dropped, 3);
});

test("ask: with a model — verified wording is used; invented wording falls back to approved facts; injection in a fact is inert", async () => {
  const { pkg } = await samplePackage();
  let prompt = "";
  const okModel = async (_s: string, u: string) => { prompt = u; return JSON.stringify({ found: true, sentences: [{ text: "Riya Sharma owns webhook fixes.", facts: ["F1"] }] }); };
  const a = await ask(pkg, "Who owns the payment webhook?", okModel);
  assert.equal(a.engine, "ai");
  assert.equal(a.sentences[0].claimIds.length, 1);
  assert.ok(prompt.includes("F1 [Owner"));
  const liar = async () => JSON.stringify({ found: true, sentences: [{ text: "Kabir secretly owns the webhook and the bank account 99887766.", facts: ["F1"] }] });
  const b = await ask(pkg, "Who owns the payment webhook?", liar);
  assert.equal(b.engine, "extractive");
  assert.ok(!JSON.stringify(b.sentences).includes("99887766"));
  const down = async () => { throw new Error("503"); };
  assert.equal((await ask(pkg, "Who owns the payment webhook?", down)).found, true);
  const refuses = async () => '{"found": false, "sentences": []}';
  assert.equal((await ask(pkg, "Who owns the payment webhook?", refuses)).found, false);
});

test("ask: 'what should I do first' answers from the Day 1 plan", async () => {
  const { pkg } = await samplePackage();
  const r = await ask(pkg, "What should I do first?");
  assert.equal(r.found, true);
  assert.ok(r.sentences.every((s) => s.claimIds.length > 0));
});

// ---------------------------------------------------------------- capture
test("capture: parses chat commands", () => {
  assert.deepEqual(parseCommand("decision Use Razorpay because fees are lower"), { kind: "decision", text: "Use Razorpay", why: "fees are lower" });
  assert.deepEqual(parseCommand("task Fix the webhook @arjun due 2026-12-01"), { kind: "task", text: "Fix the webhook", owner: "arjun", due: "2026-12-01" });
  assert.deepEqual(parseCommand("owner payments -> Riya Sharma"), { kind: "note", text: "Riya Sharma owns payments" });
  assert.equal(parseCommand("risk: Domain expires in March | site goes down")?.why, "site goes down");
  assert.equal(parseCommand("hello there"), null);
  assert.equal(parseCommand("decision"), null);
});

test("capture: GitHub events become ownership, task and tagged decision items", () => {
  const issue = { number: 21, title: "Webhook fails on retries", html_url: "https://github.com/o/r/issues/21", assignee: null, body: "Risk: students can be double charged\nsome text" };
  const opened = fromGithub("issues", { action: "opened", issue, sender: { login: "riya-dev" } });
  assert.equal(opened[0].kind, "task");
  assert.equal(opened[1].kind, "risk");
  const assigned = fromGithub("issues", { action: "assigned", issue, assignee: { login: "arjun" }, sender: { login: "riya-dev" } });
  assert.equal(assigned[0].owner, "arjun");
  const merged = fromGithub("pull_request", { action: "closed", pull_request: { number: 5, title: "Add idempotency", merged: true, html_url: "u", body: "Decision: store event ids in Firestore because Redis is not available on the free plan" }, sender: { login: "riya-dev" } });
  assert.deepEqual(merged.map((m) => m.kind), ["note", "decision"]);
  assert.equal(merged[1].why, "Redis is not available on the free plan");
  const push = fromGithub("push", { commits: [{ message: "fix typo", url: "u" }, { message: "refactor\n\nDecision: drop the legacy export", url: "u2", author: { username: "kabir" } }], sender: { login: "x" } });
  assert.equal(push.length, 1);
  assert.equal(push[0].author, "kabir");
  assert.equal(fromGithub("star", { action: "created" }).length, 0);
  assert.equal(taggedLines("- Decision: keep the old API\n> risk - quota may run out\nplain").length, 2);
});

test("capture: secrets are redacted on arrival and items flow into the normal pipeline as work-log evidence", async () => {
  const { event, redactions } = makeEvent({ orgId: "o", connectorId: "c", source: "discord", access: "member" }, { kind: "decision", text: "Rotate the key sk_live_9xQ2LmT7vWc4KpZr8sN1ab and use Razorpay", why: "the old key leaked", author: "riya" });
  assert.ok(redactions >= 1);
  assert.ok(!event.text.includes("9xQ2LmT7"));
  const entry = toLogEntry(event);
  const own = toLogEntry(makeEvent({ orgId: "o", connectorId: "c", source: "github", access: "lead" }, { ...parseCommand("owner hosting -> Kabir Khan")!, author: "riya" }).event);
  const sources = worklogSources([entry, own]);
  assert.deepEqual(sources.map((s) => s.access).sort(), ["lead", "member"]);
  const p = createSampleProject("cap");
  const out = await runPipeline({ project: p.title, leaver: p.leaver, successor: p.successor, successorRole: "lead", people: p.people, sources: [...p.sources.filter((s) => s.kind !== "worklog"), ...sources] });
  assert.ok(out.claims.some((c) => c.type === "decision" && /Razorpay/.test(c.statement) && c.status === "verified" && c.evidence[0].sourceId === sources.find((s) => s.access === "member")!.id));
  assert.ok(out.claims.some((c) => c.type === "owner" && /hosting/i.test(c.statement) && /Kabir/.test(c.statement)), "ownership captured from GitHub becomes an owner claim");
});

// ---------------------------------------------------------------- signatures
test("crypto: signed tokens, passwords, Discord / GitHub / Slack signatures", () => {
  const t = signToken({ l: "link1", p: "pkg1", exp: Math.floor(Date.now() / 1000) + 60 }, "secret-secret-secret");
  assert.equal(verifyToken(t, "secret-secret-secret").ok, true);
  assert.deepEqual(verifyToken(t, "other-secret-other"), { ok: false, reason: "signature" });
  const forged = Buffer.from(JSON.stringify({ l: "link1", p: "pkg2", exp: 0 })).toString("base64url") + "." + t.split(".")[1];
  assert.deepEqual(verifyToken(forged, "secret-secret-secret"), { ok: false, reason: "signature" });
  assert.deepEqual(verifyToken(signToken({ exp: 1 }, "s".repeat(20)), "s".repeat(20)), { ok: false, reason: "expired" });
  const h = hashPassword("correct horse");
  assert.ok(checkPassword("correct horse", h) && !checkPassword("wrong", h) && !h.includes("correct"));

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
  const body = '{"type":1}', ts = "1700000000";
  const sig = crypto.sign(null, Buffer.from(ts + body), privateKey).toString("hex");
  assert.equal(verifyDiscord(pub, sig, ts, body), true);
  assert.equal(verifyDiscord(pub, sig, ts, '{"type":2}'), false);
  assert.equal(verifyDiscord(pub, "00".repeat(64), ts, body), false);
  assert.equal(verifyDiscord("zz", sig, ts, body), false);

  assert.equal(verifyGithub("whsec", "{}", "sha256=" + hmac("whsec", "{}", "hex")), true);
  assert.equal(verifyGithub("whsec", '{"a":1}', "sha256=" + hmac("whsec", "{}", "hex")), false);
  assert.equal(verifyGithub("whsec", "{}", undefined), false);
  const now = Date.now(), sts = String(Math.floor(now / 1000));
  assert.equal(verifySlack("ss", sts, "text=hi", "v0=" + hmac("ss", `v0:${sts}:text=hi`, "hex"), now), true);
  assert.equal(verifySlack("ss", String(Math.floor(now / 1000) - 900), "text=hi", "v0=" + hmac("ss", `v0:${Math.floor(now / 1000) - 900}:text=hi`, "hex"), now), false, "replayed request");
});

// ---------------------------------------------------------------- Supabase adapter contract
test("supabase adapter: user calls carry the user's token (so RLS applies); service calls use the service key", async () => {
  const seen: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  const fake = (async (url: string, init: RequestInit) => {
    seen.push({ url: String(url), method: init.method || "GET", headers: init.headers as Record<string, string>, body: init.body as string });
    return new Response(init.method === "GET" ? "[]" : init.method === "PATCH" ? '[{"id":"1"}]' : "", { status: 200 });
  }) as unknown as typeof fetch;
  const db = supabaseDb({ url: "https://x.supabase.co", anon: "sb_publishable_abc", service: "sb_secret_xyz" }, fake);
  await db.select("projects", { org_id: "o1", id: ["a", "b"], revoked: null }, { as: "user.jwt", columns: "id,title", order: "updated_at.desc", limit: 5 });
  assert.equal(seen[0].headers.apikey, "sb_publishable_abc");
  assert.equal(seen[0].headers.authorization, "Bearer user.jwt");
  assert.ok(seen[0].url.startsWith("https://x.supabase.co/rest/v1/projects?select=id%2Ctitle&org_id=eq.o1&id=in.(%22a%22,%22b%22)&revoked=is.null&order=updated_at.desc&limit=5"), seen[0].url);
  await db.insert("capture_events", { id: "c1" });
  assert.equal(seen[1].headers.apikey, "sb_secret_xyz");
  assert.equal(seen[1].headers.authorization, undefined, "new secret keys go on the apikey header only");
  assert.equal(seen[1].headers.prefer, "return=minimal");
  assert.equal(await db.update("share_links", { id: "l1" }, { revoked_at: "now" }, "user.jwt"), 1);
  await db.upsert("packages", { id: "p-v1" }, "user.jwt");
  assert.ok(seen[3].url.endsWith("packages?on_conflict=id") && seen[3].headers.prefer.includes("merge-duplicates"));
  const legacy = supabaseDb({ url: "https://x.supabase.co", anon: "eyJanon", service: "eyJservice" }, fake);
  await legacy.select("orgs", {});
  assert.equal(seen[4].headers.authorization, "Bearer eyJservice");
  const noService = supabaseDb({ url: "https://x.supabase.co", anon: "a" }, fake);
  await assert.rejects(() => noService.select("orgs", {}), /SUPABASE_SERVICE_ROLE_KEY/);
});

test("supabase adapter: RLS refusals, expired sessions and auth flows map to clear errors", async () => {
  const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  await assert.rejects(() => supabaseDb({ url: "u", anon: "a", service: "s" }, reply(403, { message: 'new row violates row-level security policy for table "projects"' })).insert("projects", {}, "t"), /permission/);
  await assert.rejects(() => supabaseDb({ url: "u", anon: "a", service: "s" }, reply(401, { message: "JWT expired" })).select("orgs", {}, { as: "t" }), /expired/);
  await assert.rejects(() => supabaseDb({ url: "u", anon: "a", service: "s" }, reply(404, { message: "Could not find the table 'public.orgs' in the schema cache" })).select("orgs", {}), /schema\.sql/);
  const session = { access_token: "at", refresh_token: "rt", expires_in: 3600, user: { id: "u1", email: "A@B.co", user_metadata: { name: "Asha" } } };
  const s = await supabaseAuth({ url: "u", anon: "a" }, reply(200, session)).login("a@b.co", "x");
  assert.deepEqual(s.user, { id: "u1", email: "a@b.co", name: "Asha" });
  assert.deepEqual(await supabaseAuth({ url: "u", anon: "a" }, reply(200, { id: "u1", email: "a@b.co", confirmation_sent_at: "x" })).signup("a@b.co", "password1", "A"), { needsConfirm: true });
  await assert.rejects(() => supabaseAuth({ url: "u", anon: "a" }, reply(400, { error_description: "Invalid login credentials" })).login("a@b.co", "x"), /Invalid login credentials/);
  assert.equal(await supabaseAuth({ url: "u", anon: "a" }, reply(401, {})).user("bad"), null);
});

// ---------------------------------------------------------------- workspace API over HTTP (built-in accounts)
let server: http.Server, base = "", dir = "";
const discordKeys = crypto.generateKeyPairSync("ed25519");

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "baton-r3-"));
  Object.assign(process.env, {
    DATA_DIR: dir, BATON_NO_RATE_LIMIT: "1", SESSION_SECRET: "test-secret-test-secret-test", AI_PROVIDER: "none", SLACK_SIGNING_SECRET: "slack-secret",
    DISCORD_PUBLIC_KEY: discordKeys.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex"),
  });
  for (const k of ["SUPABASE_URL", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete process.env[k];
  const { handle } = await import("../server/handler");
  server = http.createServer((req, res) => void handle(req, res));
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(async () => { server?.close(); await fs.rm(dir, { recursive: true, force: true }); });

type Res = { status: number; j: any };
async function call(method: string, p: string, body?: unknown, token?: string, headers: Record<string, string> = {}): Promise<Res> {
  const res = await fetch(base + p, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  const t = await res.text();
  return { status: res.status, j: t ? JSON.parse(t) : {} };
}
async function signup(name: string): Promise<{ token: string; id: string; email: string }> {
  const email = `${name.toLowerCase()}@example.test`;
  const r = await call("POST", "/api/auth/signup", { email, password: "password-123", name });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  return { token: r.j.session.token, id: r.j.session.user.id, email };
}

test("workspace API: accounts, invitations, roles, projects, publishing, signed links, Ask Baton, connectors", async () => {
  // ---- accounts
  assert.equal((await call("GET", "/api/health")).j.accounts.mode, "builtin");
  const owner = await signup("Olivia"), lead = await signup("Leo"), member = await signup("Mira"), outsider = await signup("Zed");
  assert.equal((await call("POST", "/api/auth/signup", { email: owner.email, password: "password-123", name: "Dup" })).status, 400);
  assert.equal((await call("POST", "/api/auth/signup", { email: "x@example.test", password: "short", name: "X" })).status, 400);
  assert.equal((await call("POST", "/api/auth/login", { email: owner.email, password: "wrong-password" })).status, 400);
  assert.equal((await call("POST", "/api/auth/login", { email: owner.email.toUpperCase(), password: "password-123" })).status, 200);
  assert.equal((await call("GET", "/api/auth/me")).status, 401);
  assert.equal((await call("GET", "/api/auth/me", undefined, "forged.token")).status, 401);

  // ---- workspace + invitations
  const org = (await call("POST", "/api/orgs", { name: "TechFest Club" }, owner.token)).j.org;
  assert.equal(org.role, "owner");
  const invLead = (await call("POST", `/api/orgs/${org.id}/invites`, { email: lead.email, role: "lead" }, owner.token)).j.invite;
  const invMember = (await call("POST", `/api/orgs/${org.id}/invites`, { email: member.email, role: "member" }, owner.token)).j.invite;
  const tok = (u: string) => u.split("/join/")[1];
  assert.equal((await call("POST", `/api/invites/${tok(invLead.url)}/accept`, {}, outsider.token)).status, 403, "an invitation only works for the invited email");
  assert.equal((await call("GET", "/api/auth/me", undefined, lead.token)).j.invites.length, 1);
  assert.equal((await call("POST", `/api/invites/${tok(invLead.url)}/accept`, {}, lead.token)).j.org.role, "lead");
  assert.equal((await call("POST", `/api/invites/${tok(invMember.url)}/accept`, {}, member.token)).j.org.role, "member");
  assert.equal((await call("POST", `/api/invites/${tok(invMember.url)}/accept`, {}, member.token)).status, 404, "single use");
  assert.equal((await call("GET", `/api/orgs/${org.id}`, undefined, outsider.token)).status, 403);
  assert.equal((await call("GET", `/api/orgs/${org.id}`, undefined, owner.token)).j.members.length, 3);
  assert.equal((await call("POST", `/api/orgs/${org.id}/invites`, { email: "new@example.test", role: "lead" }, lead.token)).status, 403, "a lead cannot invite leads");
  assert.equal((await call("POST", `/api/orgs/${org.id}/invites`, { email: "new@example.test", role: "member" }, member.token)).status, 403);
  assert.equal((await call("PATCH", `/api/orgs/${org.id}/members/${member.id}`, { role: "owner" }, lead.token)).status, 403, "only an owner changes roles");
  assert.equal((await call("PATCH", `/api/orgs/${org.id}/members/${owner.id}`, { role: "member" }, owner.token)).status, 400, "last owner is protected");

  // ---- projects: Private material never reaches the server; members cannot read raw projects
  const { p } = await samplePackage("member");
  assert.ok(p.sources.some((s) => s.access === "private"));
  const put = await call("PUT", `/api/projects/${p.id}`, { orgId: org.id, project: p }, lead.token);
  assert.equal(put.status, 200);
  assert.ok(put.j.withheldPrivate >= 1);
  const got = await call("GET", `/api/projects/${p.id}`, undefined, owner.token);
  assert.ok(got.j.project.sources.length > 0 && got.j.project.sources.every((s: any) => s.access !== "private"));
  assert.ok(!JSON.stringify(got.j).includes("rzp_live_"));
  assert.equal((await call("GET", `/api/projects/${p.id}`, undefined, member.token)).status, 403);
  assert.equal((await call("GET", `/api/projects/${p.id}`, undefined, outsider.token)).status, 403);
  assert.equal((await call("PUT", `/api/projects/${p.id}`, { orgId: org.id, project: p }, member.token)).status, 403);
  assert.equal((await call("GET", `/api/orgs/${org.id}/projects`, undefined, member.token)).j.projects.length, 0);
  assert.equal((await call("GET", `/api/orgs/${org.id}/projects`, undefined, lead.token)).j.projects.length, 1);

  // ---- publishing: approver is the signed-in identity, not a typed name
  assert.equal((await call("POST", `/api/orgs/${org.id}/publish`, { project: p }, member.token)).status, 403);
  const pub = await call("POST", `/api/orgs/${org.id}/publish`, { project: p }, lead.token);
  assert.equal(pub.j.package.approvedBy, "Leo");
  const pkgId = pub.j.package.id;
  const leadPkg = (await samplePackage("lead")).p;
  leadPkg.id = "r3lead";
  const pubLead = await call("POST", `/api/orgs/${org.id}/publish`, { project: leadPkg }, owner.token);
  assert.equal(pubLead.j.package.role, "lead");

  // ---- opening a handover: member sees Member handovers only; outsiders and anonymous visitors see nothing
  assert.equal((await call("GET", `/api/share/${pkgId}`, undefined, member.token)).status, 200);
  assert.equal((await call("GET", `/api/share/${pubLead.j.package.id}`, undefined, member.token)).status, 403);
  assert.equal((await call("GET", `/api/share/${pubLead.j.package.id}`, undefined, lead.token)).status, 200);
  assert.equal((await call("GET", `/api/share/${pkgId}`, undefined, outsider.token)).status, 403);
  assert.equal((await call("GET", `/api/share/${pkgId}`)).status, 401);
  assert.deepEqual((await call("GET", `/api/orgs/${org.id}/packages`, undefined, member.token)).j.packages.map((x: any) => x.role), ["member"]);

  // ---- signed links: create, open, tamper, expire, revoke
  assert.equal((await call("POST", `/api/packages/${pkgId}/links`, { days: 7 }, member.token)).status, 403);
  const link = (await call("POST", `/api/packages/${pkgId}/links`, { days: 7, label: "For Arjun" }, lead.token)).j.link;
  const k = new URL(link.url).searchParams.get("k")!;
  const open = await call("GET", `/api/share/${pkgId}?k=${encodeURIComponent(k)}`);
  assert.equal(open.status, 200);
  assert.equal(open.j.access.kind, "link");
  assert.equal((await call("GET", `/api/share/${pkgId}?k=${encodeURIComponent(k.slice(0, -2) + "xx")}`)).status, 403, "tampered signature");
  assert.equal((await call("GET", `/api/share/${pubLead.j.package.id}?k=${encodeURIComponent(k)}`)).status, 403, "a link only opens its own handover");
  const expired = signToken({ l: link.id, p: pkgId, exp: Math.floor(Date.now() / 1000) - 5 }, "test-secret-test-secret-test");
  assert.equal((await call("GET", `/api/share/${pkgId}?k=${encodeURIComponent(expired)}`)).status, 410);
  const forgedNever = signToken({ l: link.id, p: pkgId, exp: 0 }, "attacker-secret-attacker");
  assert.equal((await call("GET", `/api/share/${pkgId}?k=${encodeURIComponent(forgedNever)}`)).status, 403);

  // ---- acknowledgements and flags carry identity
  const ack = await call("POST", `/api/share/${pkgId}/ack`, { section: "plan", by: "Someone Else" }, member.token);
  assert.equal(ack.j.package.acknowledgements.plan.by, "Mira", "a signed-in member acknowledges as themselves");
  const viaLink = await call("POST", `/api/share/${pkgId}/flag?k=${encodeURIComponent(k)}`, { claimId: pub.j.package.claims[0].id, note: "Out of date", by: "Arjun Mehta" });
  assert.equal(viaLink.j.package.flags[0].by, "Arjun Mehta");
  assert.equal((await call("POST", `/api/share/${pkgId}/ack`, { section: "plan", by: "X" })).status, 401);

  // ---- Ask Baton over HTTP: grounded, role-safe, unanswered questions reach the reviewer
  const a1 = await call("POST", `/api/ask?k=${encodeURIComponent(k)}`, { id: pkgId, question: "Who owns the payment webhook?", by: "Arjun Mehta" });
  assert.equal(a1.j.answer.found, true);
  assert.ok(a1.j.answer.sentences[0].claimIds.length > 0);
  const a2 = await call("POST", `/api/ask?k=${encodeURIComponent(k)}`, { id: pkgId, question: "How much did ByteForge pay?", by: "Arjun Mehta" });
  assert.equal(a2.j.answer.found, false);
  assert.ok(!/75,?000|40,?000/.test(JSON.stringify(a2.j)));
  assert.equal((await call("POST", "/api/ask", { id: pkgId, question: "Who owns the payment webhook?" })).status, 401, "no link, no session");
  assert.equal((await call("POST", "/api/ask", { id: pubLead.j.package.id, question: "How much did ByteForge pay?" }, member.token)).status, 403);
  const reviewerView = await call("GET", `/api/share/${pkgId}`, undefined, lead.token);
  assert.deepEqual(reviewerView.j.package.questions.map((q: any) => q.found), [true, false]);
  const local = (await samplePackage()).pkg; local.id = "only-in-browser";
  assert.equal((await call("POST", "/api/ask", { id: local.id, question: "Who owns the leaderboard?", package: local })).j.answer.found, true, "browser-only demo handovers can be asked too");

  await call("POST", `/api/links/${link.id}/revoke`, {}, lead.token);
  assert.equal((await call("GET", `/api/share/${pkgId}?k=${encodeURIComponent(k)}`)).status, 410, "revoked link stops working");
  assert.ok((await call("GET", `/api/packages/${pkgId}/links`, undefined, lead.token)).j.links[0].revokedAt);

  // ---- connectors: members cannot see webhook secrets
  assert.equal((await call("GET", `/api/orgs/${org.id}/connectors`, undefined, member.token)).status, 403);
  const gh = (await call("POST", `/api/orgs/${org.id}/connectors`, { kind: "github", repo: "techfest/portal", projectId: p.id, defaultAccess: "member" }, lead.token)).j.connector;
  const dc = (await call("POST", `/api/orgs/${org.id}/connectors`, { kind: "discord", defaultAccess: "member" }, lead.token)).j.connector;
  const sl = (await call("POST", `/api/orgs/${org.id}/connectors`, { kind: "slack", defaultAccess: "lead" }, owner.token)).j.connector;

  // GitHub webhook: signature required, duplicates ignored, items land in the inbox
  const hookPath = new URL(gh.webhookUrl).pathname;
  const payload = JSON.stringify({ action: "assigned", issue: { number: 21, title: "Razorpay webhook fails on retries", html_url: "https://github.com/techfest/portal/issues/21" }, assignee: { login: "arjun-m" }, sender: { login: "riya-dev" }, repository: { full_name: "techfest/portal" } });
  const ghHeaders = (body: string, secret = gh.secret, id = "d-1") => ({ "x-github-event": "issues", "x-github-delivery": id, "x-hub-signature-256": "sha256=" + hmac(secret, body, "hex") });
  assert.equal((await call("POST", hookPath, payload, undefined, { ...ghHeaders(payload, "wrong-secret"), "content-type": "application/json" })).status, 401);
  assert.equal((await call("POST", hookPath, payload, undefined, { ...ghHeaders(payload), "content-type": "application/json" })).j.captured, 1);
  assert.equal((await call("POST", hookPath, payload, undefined, { ...ghHeaders(payload), "content-type": "application/json" })).j.duplicate, true);
  assert.equal((await call("POST", "/api/hooks/github/00000000-0000-0000-0000-000000000000", payload, undefined, ghHeaders(payload))).status, 404);

  // Discord: Ed25519 signature, PING, link, then a decision
  const discord = async (body: unknown, tamper = false) => {
    const raw = JSON.stringify(body), ts = String(Math.floor(Date.now() / 1000));
    const sig = crypto.sign(null, Buffer.from(ts + raw), discordKeys.privateKey).toString("hex");
    return call("POST", "/api/hooks/discord", tamper ? raw.replace("decision", "decisioN") : raw, undefined, { "x-signature-ed25519": sig, "x-signature-timestamp": ts, "content-type": "application/json" });
  };
  const cmd = (name: string, options: Record<string, string>, guild = "guild-1") => ({ type: 2, id: "i-" + Math.random(), guild_id: guild, member: { user: { username: "riya", global_name: "Riya Sharma" } }, data: { name: "baton", options: [{ type: 1, name, options: Object.entries(options).map(([n, value]) => ({ name: n, value })) }] } });
  assert.deepEqual((await discord({ type: 1 })).j, { type: 1 });
  assert.equal((await discord(cmd("decision", { text: "x" }), true)).status, 401, "body changed after signing");
  assert.match((await discord(cmd("decision", { text: "Use Cloudflare for DNS" }))).j.data.content, /not linked/);
  assert.match((await discord(cmd("link", { code: "BTN-NOPE" }))).j.data.content, /not found/);
  assert.match((await discord(cmd("link", { code: dc.linkCode }))).j.data.content, /Linked to the Baton workspace “TechFest Club”/);
  const logged = await discord(cmd("decision", { text: "Use Cloudflare for DNS, token ghp_abcdefghijklmnopqrstuvwxyz0123456789", why: "the college DNS is slow to update", visibility: "lead" }));
  assert.match(logged.j.data.content, /Logged decision/);
  assert.equal(logged.j.data.flags, 64);
  assert.ok(!logged.j.data.content.includes("ghp_abcdef"), "secrets are redacted before storage");
  assert.match((await discord(cmd("task", { text: "Renew the domain" }, "other-guild"))).j.data.content, /not linked/, "another server cannot write into this workspace");

  // Slack: signed form body
  const slack = async (text: string) => {
    const raw = new URLSearchParams({ team_id: "T1", team_domain: "techfest", user_name: "kabir", text, trigger_id: "t" + Math.random() }).toString();
    const ts = String(Math.floor(Date.now() / 1000));
    return call("POST", "/api/hooks/slack", raw, undefined, { "content-type": "application/x-www-form-urlencoded", "x-slack-request-timestamp": ts, "x-slack-signature": "v0=" + hmac("slack-secret", `v0:${ts}:${raw}`, "hex") });
  };
  assert.match((await slack(`link ${sl.linkCode}`)).j.text, /Linked/);
  assert.match((await slack("risk Sponsor contract is not signed yet because legal is slow")).j.text, /Logged risk/);
  assert.equal((await call("POST", "/api/hooks/slack", "text=risk+x", undefined, { "content-type": "application/x-www-form-urlencoded", "x-slack-request-timestamp": "1", "x-slack-signature": "v0=00" })).status, 401);

  // ---- capture inbox: Lead-tagged items are hidden from Members; only leads triage
  const inboxLead = (await call("GET", `/api/orgs/${org.id}/capture?status=new`, undefined, lead.token)).j.events;
  assert.deepEqual(inboxLead.map((e: any) => e.source).sort(), ["discord", "github", "slack"]);
  const inboxMember = (await call("GET", `/api/orgs/${org.id}/capture`, undefined, member.token)).j.events;
  assert.deepEqual(inboxMember.map((e: any) => e.source), ["github"]);
  assert.equal((await call("GET", `/api/orgs/${org.id}/capture`, undefined, outsider.token)).status, 403);
  const ghEvent = inboxLead.find((e: any) => e.source === "github");
  assert.equal(ghEvent.owner, "arjun-m");
  assert.equal(ghEvent.projectId, p.id);
  assert.equal((await call("POST", `/api/orgs/${org.id}/capture/update`, { ids: [ghEvent.id], status: "added" }, member.token)).status, 403);
  assert.equal((await call("POST", `/api/orgs/${org.id}/capture/update`, { ids: [ghEvent.id], status: "added", projectId: p.id }, lead.token)).j.updated, 1);
  assert.equal((await call("GET", `/api/orgs/${org.id}/capture?status=new`, undefined, lead.token)).j.events.length, 2);

  // ---- removing a member ends their access immediately
  await call("DELETE", `/api/orgs/${org.id}/members/${member.id}`, undefined, owner.token);
  assert.equal((await call("GET", `/api/share/${pkgId}`, undefined, member.token)).status, 403);

  // ---- the no-login demo path from Round 2 still works
  const demo = await call("POST", "/api/publish", { project: { ...p, id: "demo-open" }, approvedBy: "Prof. Anita Rao" });
  assert.equal(demo.status, 200);
  assert.equal((await call("GET", `/api/share/${demo.j.package.id}`)).j.access.kind, "open");
});
