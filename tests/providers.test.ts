// Contract tests for the AI provider adapters: request shape and reply parsing for Gemini,
// Anthropic and OpenAI-compatible APIs, using an intercepted fetch (no network needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { aiConfig, makeCallModel } from "../server/ai";

type Captured = { url: string; headers: Record<string, string>; body: any };
function intercept(reply: (c: Captured) => { status?: number; json: unknown }) {
  const calls: Captured[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const c = { url: String(url), headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) };
    calls.push(c);
    const r = reply(c);
    return new Response(JSON.stringify(r.json), { status: r.status || 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

test("provider auto-detection from environment variables", () => {
  assert.equal(aiConfig({}), null);
  assert.equal(aiConfig({ GEMINI_API_KEY: "g" })?.provider, "gemini");
  assert.equal(aiConfig({ ANTHROPIC_API_KEY: "a" })?.provider, "anthropic");
  assert.equal(aiConfig({ OPENAI_API_KEY: "o", AI_BASE_URL: "https://api.groq.com/openai/v1/" })?.baseUrl, "https://api.groq.com/openai/v1");
  assert.equal(aiConfig({ GEMINI_API_KEY: "g", AI_PROVIDER: "none" }), null);
  assert.equal(aiConfig({ GEMINI_API_KEY: "g", AI_MODEL: "gemini-x" })?.model, "gemini-x");
});

test("Gemini adapter: JSON mode, system instruction, key header", async () => {
  const m = intercept(() => ({ json: { candidates: [{ content: { parts: [{ text: '{"claims":[]}' }] } }] } }));
  try {
    const call = makeCallModel(aiConfig({ GEMINI_API_KEY: "gk" })!);
    const out = await call("SYS", "USER");
    assert.equal(out, '{"claims":[]}');
    const c = m.calls[0];
    assert.match(c.url, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.5-flash:generateContent$/);
    assert.equal(c.headers["x-goog-api-key"], "gk");
    assert.equal(c.body.systemInstruction.parts[0].text, "SYS");
    assert.equal(c.body.contents[0].parts[0].text, "USER");
    assert.equal(c.body.generationConfig.responseMimeType, "application/json");
  } finally { m.restore(); }
});

test("Anthropic adapter: messages API shape and text extraction", async () => {
  const m = intercept(() => ({ json: { content: [{ type: "text", text: '{"claims":[1]}' }] } }));
  try {
    const out = await makeCallModel(aiConfig({ ANTHROPIC_API_KEY: "ak" })!)("SYS", "USER");
    assert.equal(out, '{"claims":[1]}');
    const c = m.calls[0];
    assert.equal(c.url, "https://api.anthropic.com/v1/messages");
    assert.equal(c.headers["x-api-key"], "ak");
    assert.equal(c.headers["anthropic-version"], "2023-06-01");
    assert.equal(c.body.system, "SYS");
    assert.equal(c.body.messages[0].role, "user");
  } finally { m.restore(); }
});

test("OpenAI-compatible adapter: retries without response_format on 400", async () => {
  let n = 0;
  const m = intercept((c) => (++n === 1 && c.body.response_format ? { status: 400, json: { error: { message: "response_format not supported" } } } : { json: { choices: [{ message: { content: '{"claims":[]}' } }] } }));
  try {
    const out = await makeCallModel(aiConfig({ OPENAI_API_KEY: "ok", AI_BASE_URL: "https://example.test/v1", AI_MODEL: "llama" })!)("SYS", "USER");
    assert.equal(out, '{"claims":[]}');
    assert.equal(m.calls.length, 2);
    assert.equal(m.calls[0].url, "https://example.test/v1/chat/completions");
    assert.equal(m.calls[0].headers.authorization, "Bearer ok");
    assert.equal(m.calls[1].body.response_format, undefined);
  } finally { m.restore(); }
});

test("provider errors surface a readable message", async () => {
  const m = intercept(() => ({ status: 401, json: { error: { message: "API key not valid" } } }));
  try {
    await assert.rejects(makeCallModel(aiConfig({ GEMINI_API_KEY: "bad" })!)("s", "u"), /401 API key not valid/);
  } finally { m.restore(); }
});
