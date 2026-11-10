// AI path over real HTTP: Baton server → OpenAI-compatible mock model server.
// Checks streaming progress, the AI engine label, quote verification and the permission gate.
import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) failures++; };
let seenPrompt = "";

const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    const user = JSON.parse(body).messages.find((m) => m.role === "user").content;
    seenPrompt += user;
    const blocks = [...user.matchAll(/^\[(s[^\]]+)\] \([^\n]*\)\n([^\n]+)/gm)].slice(0, 6);
    const claims = blocks.map(([, id, text]) => ({ type: "open_task", statement: text.slice(0, 120), basis: "stated", quote: text.slice(0, 60), chunk_id: id }));
    claims.push({ type: "risk", statement: "The database password is stored in plain text", basis: "stated", quote: "password stored in plain text", chunk_id: blocks[0]?.[1] || "x" });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ claims }) } }] }));
  });
});
await new Promise((r) => mock.listen(4400, r));

const server = spawn(process.execPath, ["dist/server.mjs"], { cwd: root, env: { ...process.env, PORT: "4318", AI_PROVIDER: "openai", OPENAI_API_KEY: "test", AI_BASE_URL: "http://localhost:4400/v1", AI_MODEL: "mock-model", DATA_DIR: path.join(root, ".data-test") }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise((r) => server.stdout.on("data", (d) => String(d).includes("running") && r()));

try {
  const health = await (await fetch("http://localhost:4318/api/health")).json();
  ok(health.ai.configured && health.ai.model === "mock-model", "health shows the configured AI model");
  const test = await (await fetch("http://localhost:4318/api/ai/test", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json();
  ok(test.ok === false || test.ok === true, `AI test endpoint responds (${test.message})`);
  const { project: p } = await (await fetch("http://localhost:4318/api/sample")).json();
  const res = await fetch("http://localhost:4318/api/generate", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ project: p.title, leaver: p.leaver, successor: p.successor, successorRole: "member", people: p.people, sources: p.sources, engine: "ai" }),
  });
  const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
  const progress = lines.filter((l) => l.type === "progress");
  const result = lines.find((l) => l.type === "result");
  ok(progress.length >= 6, `streamed ${progress.length} progress events`);
  ok(result?.run.engine === "ai" && result.run.model === "mock-model", "run used the AI engine");
  const ai = result.claims.filter((c) => c.engine === "ai");
  ok(ai.some((c) => c.status === "verified"), `AI claims with real quotes are verified (${ai.filter((c) => c.status === "verified").length})`);
  ok(ai.find((c) => /plain text/.test(c.statement))?.status === "inferred", "invented AI quote is downgraded to inferred");
  ok(!seenPrompt.includes("75,000") && !seenPrompt.includes("CodeCraft@2026") && !seenPrompt.includes("recommending Kabir"), "model never received Lead-only or Private text");
} catch (e) {
  failures++;
  console.log("FAIL  exception:", e.message);
} finally {
  server.kill();
  mock.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll AI-path checks passed");
process.exit(failures ? 1 : 0);
