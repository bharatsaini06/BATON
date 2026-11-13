// End-to-end test of the judge journey in a real browser (Playwright + Chromium).
// Starts the built server, walks through every step, checks permissions, and saves screenshots.
// Usage: npm run build && node tests/e2e.mjs [--shots=dir]
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4317;
const BASE = `http://localhost:${PORT}`;
const shotsArg = process.argv.find((a) => a.startsWith("--shots="));
const SHOTS = shotsArg ? shotsArg.slice(8) : path.join(root, "tests/screenshots");
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) failures++; };

const server = spawn(process.execPath, ["dist/server.mjs"], { cwd: root, env: { ...process.env, PORT: String(PORT), DATA_DIR: path.join(root, ".data-test"), AI_PROVIDER: "none" }, stdio: ["ignore", "pipe", "pipe"] });
server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
await new Promise((res) => server.stdout.on("data", (d) => String(d).includes("running") && res()));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && !/ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|CONNECTION|PROXY|TUNNEL|FAILED)|fonts\.g/.test(m.text() + m.location().url) && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(String(e)));
const shot = (name) => page.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: true });

try {
  // ---- API smoke
  const health = await (await fetch(`${BASE}/api/health`)).json();
  ok(health.ok && health.ai.configured === false, "health endpoint reports rules engine");
  const sec = await fetch(`${BASE}/`);
  ok(/default-src 'self'/.test(sec.headers.get("content-security-policy") || ""), "security headers present");
  const nf = await fetch(`${BASE}/api/nope`);
  ok(nf.status === 404, "unknown API route returns 404");
  const bad = await fetch(`${BASE}/api/ingest/upload`, { method: "POST", headers: { "content-type": "application/json" }, body: "{bad" });
  ok(bad.status === 400, "malformed JSON returns 400");

  // ---- landing
  await page.goto(BASE + "/");
  await page.getByRole("heading", { name: /the project stays/i }).waitFor();
  await shot("01-landing");
  await page.getByRole("button", { name: "Try the sample project" }).click();

  // ---- sources
  await page.waitForURL(/\/p\/.+\/sources/);
  await page.getByText("Connected sources").waitFor();
  const srcCount = await page.locator(".source-card").count();
  ok(srcCount === 8, `sample has 8 sources (got ${srcCount})`);
  ok(await page.getByText(/redacted/).first().isVisible(), "redaction badge visible");
  await shot("02-sources");
  await page.locator(".source-card", { hasText: "riya-private-notes.md" }).getByRole("button", { name: "View" }).click();
  const drawerText = await page.locator(".drawer").innerText();
  ok(drawerText.includes("[REDACTED") && !drawerText.includes("rzp_live_9xQ2"), "private notes show redaction, not the secret");
  await shot("03-source-drawer");
  await page.keyboard.press("Escape");

  // ---- work log capture
  await page.getByRole("radio", { name: /Work log/ }).click();
  await page.locator("#w-text").fill("Keep registration form fields unchanged until the demo");
  await page.locator("#w-why").fill("the sponsor already reviewed the form");
  await page.getByRole("button", { name: "Add to work log" }).click();
  await page.getByText("6 entries", { exact: true }).waitFor();
  ok(true, "work log entry added");

  // ---- reconstruct
  await page.getByRole("button", { name: /Reconstruct the handover/ }).click();
  await page.waitForURL(/reconstruct/);
  await page.getByRole("button", { name: /Run reconstruction/ }).click();
  await page.locator(".status-tiles").waitFor({ timeout: 30000 });
  const tiles = await page.locator(".tile-num").allInnerTexts();
  ok(tiles.length === 4 && +tiles[0] > 10, `reconstruction produced claims (verified=${tiles[0]}, inferred=${tiles[1]}, conflicting=${tiles[2]}, missing=${tiles[3]})`);
  ok(+tiles[2] >= 2, "date conflict detected");
  await shot("04-reconstruct");

  // ---- gap interview
  await page.getByRole("button", { name: /Gap Interview question/ }).click();
  await page.waitForURL(/interview/);
  const qCount = await page.locator(".question").count();
  ok(qCount >= 4, `gap interview has questions (${qCount})`);
  const conflictQ = page.locator(".question", { hasText: "different dates" });
  await conflictQ.getByText("20 Dec 2026").click();
  const missingQ = page.locator(".question", { hasText: "domain" }).first();
  await missingQ.locator("textarea").fill("Neha Iyer renews the domain from the club budget every March");
  const inferredQ = page.locator(".question", { hasText: "Is this correct?" }).first();
  if (await inferredQ.count()) await inferredQ.getByText("Yes, correct").click();
  const unknownQ = page.locator(".question", { hasText: "database" }).first();
  if (await unknownQ.count()) await unknownQ.getByRole("button", { name: "I don't know" }).click();
  await shot("05-interview");
  await page.getByRole("button", { name: "Submit answers" }).click();
  await page.getByText(/resolved and saved as leaver testimony/).waitFor();
  ok(true, "interview answers submitted");

  // ---- review
  await page.goto(page.url().replace("/interview", "/review"));
  await page.getByRole("button", { name: /Approve all verified/ }).waitFor();
  await page.getByRole("button", { name: /Approve all verified/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Approve \d+/ }).click();
  await page.getByText(/verified claims approved/).waitFor();
  // testimony-backed claim exists and is verified
  ok(await page.locator(".claim", { hasText: "confirmed by Riya Sharma" }).count() > 0, "conflict resolved by testimony claim");
  // open evidence
  await page.locator(".claim", { hasText: "Kabir Khan owns leaderboard" }).first().locator(".ev-chip").first().click();
  ok(await page.locator(".drawer mark").count() > 0, "evidence drawer highlights the quote");
  await shot("06-evidence");
  await page.keyboard.press("Escape");
  // reject an inferred claim, approve a missing one
  const pendingInferred = page.locator(".claim.claim-inferred:not(.dec-approved):not(.dec-rejected)").first();
  if (await pendingInferred.count()) {
    await pendingInferred.getByRole("button", { name: "Reject" }).click();
    await pendingInferred.locator("input").fill("Not confirmed");
    await pendingInferred.getByRole("button", { name: "Reject" }).last().click();
  }
  const missing = page.locator(".claim.claim-missing:not(.dec-approved)").first();
  if (await missing.count()) await missing.getByRole("button", { name: "Approve" }).click();
  // edit one claim
  const editTarget = page.locator(".claim", { hasText: "Registration closes" }).first();
  if (await editTarget.count()) {
    await editTarget.getByRole("button", { name: "Undo" }).click().catch(() => {});
    await editTarget.getByRole("button", { name: "Edit" }).click();
    await editTarget.locator("textarea").fill("Registration closes on 5 Dec 2026 at midnight");
    await editTarget.getByRole("button", { name: "Save & approve" }).click();
  }
  await page.waitForTimeout(300);
  await shot("07-review");

  // ---- publish
  await page.getByRole("button", { name: /Prepare the handover/ }).click();
  await page.waitForURL(/publish/);
  await page.getByRole("button", { name: /Approve & publish v1/ }).click();
  await page.getByText(/is ready for Arjun/).waitFor();
  await shot("08-publish");
  await page.getByRole("link", { name: "Open successor view" }).click();

  // ---- successor
  await page.waitForURL(/\/h\//);
  await page.getByText("Day 1").first().waitFor();
  const body = await page.locator("body").innerText();
  ok(!body.includes("75,000") && !body.includes("40,000"), "Lead-only sponsor amounts never reach a Member successor");
  ok(!body.includes("CodeCraft@2026") && !body.includes("rzp_live"), "private secrets never reach the successor");
  ok(!/recommending Kabir/i.test(body), "private note content never reaches the successor");
  ok(/withheld for your role/.test(body), "successor sees that sources were withheld");
  ok(/20 Dec/.test(body), "resolved demo date shown");
  await shot("09-successor");
  await page.locator("#sec-plan").getByRole("button", { name: "Acknowledge" }).click();
  await page.getByText(/Acknowledged by Arjun/).first().waitFor();
  await page.locator("#sec-owners .claim").first().getByRole("button", { name: "Flag as wrong" }).click();
  await page.getByRole("dialog").locator("textarea").fill("Kabir moved to the design team last week");
  await page.getByRole("button", { name: "Send flag" }).click();
  await page.getByText("Flag sent to the reviewer").waitFor();
  ok(true, "acknowledge and flag work");

  // share link works in a fresh browser context (server storage)
  const id = page.url().split("/h/")[1];
  const fresh = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await fresh.newPage();
  await p2.goto(`${BASE}/h/${id}`);
  await p2.getByText("Day 1").first().waitFor();
  ok(true, "share link opens in a fresh browser (no local data)");
  await p2.screenshot({ path: path.join(SHOTS, "10-successor-mobile.png"), fullPage: true });
  await fresh.close();

  // ---- flag visible to reviewer; role switch to Lead changes visibility
  const pid = (await page.evaluate(() => location.pathname)).split("/h/")[1].replace(/-v\d+$/, "");
  await page.goto(`${BASE}/p/${pid}/review`);
  await page.getByText(/flagged 1 item/).waitFor();
  ok(true, "successor flag appears in reviewer screen");
  await page.goto(`${BASE}/p/${pid}/setup`);
  await page.getByRole("radio", { name: "Lead" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText(/successor role changed/).waitFor();
  await page.waitForTimeout(300); // let the browser database write finish before reloading
  await page.goto(`${BASE}/p/${pid}/reconstruct`);
  ok(await page.getByText("Results are out of date").waitFor({ timeout: 8000 }).then(() => true, () => false), "role change marks results stale");
  const withheld = await page.locator(".gate-box").innerText();
  ok(/Withheld \(1\)/.test(withheld), "as Lead only the Private source is withheld");

  // ---- new project with real upload
  await page.goto(BASE + "/projects");
  await page.getByRole("button", { name: "New project" }).click();
  await page.waitForURL(/setup/);
  await page.locator("#title").fill("Upload test");
  await page.locator("#leaver").fill("Riya Sharma");
  await page.locator("#succ").fill("Arjun Mehta");
  await page.locator("#rev").fill("Anita Rao");
  await page.getByRole("button", { name: /Save and add sources/ }).click();
  await page.waitForURL(/sources/);
  await page.locator('input[type="file"]').setInputFiles([path.join(root, "public/samples/codecraft-core-team-whatsapp.txt"), path.join(root, "public/samples/trello-board-export.csv")]);
  await page.locator(".source-card").nth(1).waitFor();
  const kinds = await page.locator(".source-card .muted.small").allInnerTexts();
  ok(kinds.some((k) => k.startsWith("Chat export")) && kinds.some((k) => k.startsWith("Task board")), "uploads detected as chat export and task board");
  await page.getByRole("button", { name: /Reconstruct the handover/ }).click();
  await page.getByRole("button", { name: /Run reconstruction/ }).click();
  await page.locator(".status-tiles").waitFor({ timeout: 30000 });
  ok(true, "uploaded project reconstructs");
  await shot("11-upload-project");

  ok(consoleErrors.length === 0, `no browser console errors${consoleErrors.length ? ": " + consoleErrors.slice(0, 3).join(" | ") : ""}`);
} catch (e) {
  failures++;
  console.log("FAIL  exception:", e.message);
  await shot("zz-failure").catch(() => {});
} finally {
  await browser.close();
  server.kill();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll end-to-end checks passed");
process.exit(failures ? 1 : 0);
