// AI provider adapters. One small interface, three backends:
//   gemini     — Google Gemini API (free tier available)
//   anthropic  — Anthropic Messages API (Claude)
//   openai     — any OpenAI-compatible Chat Completions API (OpenAI, Groq, OpenRouter, local servers)
// Keys live only in server environment variables. They are never sent to the browser.
import type { CallModel } from "../src/core/extract-ai";

export type Provider = "gemini" | "anthropic" | "openai";

export interface AiConfig { provider: Provider; model: string; key: string; baseUrl: string; timeoutMs: number }

const DEFAULT_MODEL: Record<Provider, string> = {
  gemini: "gemini-2.5-flash",
  anthropic: "claude-haiku-5-5",
  openai: "gpt-4.1-mini",
};

export function aiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig | null {
  const explicit = (env.AI_PROVIDER || "").toLowerCase().trim();
  if (explicit === "none" || explicit === "off" || explicit === "rules") return null;
  const keys: Record<Provider, string | undefined> = {
    gemini: env.GEMINI_API_KEY || env.GOOGLE_API_KEY,
    anthropic: env.ANTHROPIC_API_KEY,
    openai: env.OPENAI_API_KEY,
  };
  let provider: Provider | undefined = (["gemini", "anthropic", "openai"] as Provider[]).find((p) => p === explicit);
  if (!provider) provider = (["gemini", "anthropic", "openai"] as Provider[]).find((p) => keys[p]);
  if (!provider) return null;
  const key = keys[provider] || env.AI_API_KEY;
  if (!key) return null;
  return {
    provider,
    key,
    model: env.AI_MODEL || DEFAULT_MODEL[provider],
    baseUrl: (env.AI_BASE_URL || (provider === "openai" ? "https://api.openai.com/v1" : "")).replace(/\/$/, ""),
    timeoutMs: Number(env.AI_TIMEOUT_MS) || 45000,
  };
}

export const PROVIDER_LABEL: Record<Provider, string> = { gemini: "Google Gemini", anthropic: "Anthropic Claude", openai: "OpenAI-compatible" };

async function post(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    const text = await res.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 300) }; }
    if (!res.ok) {
      const d = data as { error?: { message?: string } | string; message?: string };
      const msg = typeof d.error === "string" ? d.error : d.error?.message || d.message || text.slice(0, 200);
      const err = new Error(`${res.status} ${msg}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return data;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export function makeCallModel(cfg: AiConfig): CallModel {
  if (cfg.provider === "gemini") {
    return async (system, user) => {
      const data = (await post(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`,
        { "x-goog-api-key": cfg.key },
        {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { temperature: 0.1, responseMimeType: "application/json", maxOutputTokens: 8192 },
        },
        cfg.timeoutMs,
      )) as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } };
      if (data.promptFeedback?.blockReason) throw new Error(`blocked by provider safety filter (${data.promptFeedback.blockReason})`);
      const cand = data.candidates?.[0];
      const text = cand?.content?.parts?.map((p) => p.text || "").join("") || "";
      if (!text) throw new Error(`empty reply${cand?.finishReason ? ` (${cand.finishReason})` : ""}`);
      return text;
    };
  }
  if (cfg.provider === "anthropic") {
    return async (system, user) => {
      const data = (await post(
        "https://api.anthropic.com/v1/messages",
        { "x-api-key": cfg.key, "anthropic-version": "2023-06-01" },
        { model: cfg.model, max_tokens: 8192, temperature: 0.1, system, messages: [{ role: "user", content: user }] },
        cfg.timeoutMs,
      )) as { content?: { type: string; text?: string }[] };
      const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
      if (!text) throw new Error("empty reply");
      return text;
    };
  }
  return async (system, user) => {
    const body = { model: cfg.model, temperature: 0.1, messages: [{ role: "system", content: system }, { role: "user", content: user }] };
    let data: { choices?: { message?: { content?: string } }[] };
    try {
      data = (await post(`${cfg.baseUrl}/chat/completions`, { authorization: `Bearer ${cfg.key}` }, { ...body, response_format: { type: "json_object" } }, cfg.timeoutMs)) as typeof data;
    } catch (e) {
      // some compatible servers do not support response_format; retry once without it
      if ((e as { status?: number }).status === 400) data = (await post(`${cfg.baseUrl}/chat/completions`, { authorization: `Bearer ${cfg.key}` }, body, cfg.timeoutMs)) as typeof data;
      else throw e;
    }
    const text = data.choices?.[0]?.message?.content || "";
    if (!text) throw new Error("empty reply");
    return text;
  };
}

/** Cheap round trip used by the "Test AI connection" button. */
export async function testConnection(cfg: AiConfig): Promise<{ ok: boolean; ms: number; message: string }> {
  const t0 = Date.now();
  try {
    const call = makeCallModel({ ...cfg, timeoutMs: Math.min(cfg.timeoutMs, 20000) });
    const text = await call('Reply with JSON only: {"ok":true}', "Health check.");
    const ok = /"ok"\s*:\s*true/.test(text);
    return { ok, ms: Date.now() - t0, message: ok ? "Model replied with valid JSON" : `Unexpected reply: ${text.slice(0, 80)}` };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, message: (e as Error).message };
  }
}
