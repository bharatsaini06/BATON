// HTTP API. One `handle(req, res)` used by both the standalone Node server and the Vercel function.
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { aiConfig, makeCallModel, testConnection, PROVIDER_LABEL } from "./ai";
import { fetchGithub, GithubError } from "./github";
import { getStore } from "./storage";
import { parseUpload } from "../src/core/parsers";
import { normalizeGithub, parseRepoInput } from "../src/core/github";
import { worklogSources } from "../src/core/worklog";
import { runPipeline } from "../src/core/pipeline";
import { applyInterview } from "../src/core/interview";
import { buildPackage } from "../src/core/plan";
import { createSampleProject } from "../src/core/sample";
import type { Project, SharePackage, SectionKey } from "../src/core/types";
import { uid } from "../src/core/text";
import { HttpError, json, limit, parse, readRaw, type Route } from "./http";
import { workspaceRoutes, workspaceHealth, resolvePackage, recordEvent } from "./workspace";
export { HttpError };

export const VERSION = "2.1.0";

// ---------------------------------------------------------------- helpers

export function securityHeaders(res: ServerResponse) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
}

// ---------------------------------------------------------------- schemas (structural checks on input)

const Access = z.enum(["member", "lead", "private"]);
const Role = z.enum(["member", "lead"]);
const anyArray = z.array(z.any());

const UploadBody = z.object({
  name: z.string().min(1).max(200),
  text: z.string().max(6_000_000).optional(),
  pages: z.array(z.string().max(2_000_000)).max(2000).optional(),
  sourceFormat: z.enum(["pdf", "docx"]).optional(),
  access: Access,
  addedBy: z.string().max(100).optional(),
}).refine((b) => b.text !== undefined || b.pages !== undefined, "text or pages is required");

const GithubBody = z.object({ repo: z.string().min(3).max(300), access: Access, addedBy: z.string().max(100).optional() });
const WorklogBody = z.object({ entries: anyArray.max(5000), existingIds: z.record(z.string(), z.string()).optional() });

const GenerateBody = z.object({
  project: z.string().max(200),
  leaver: z.string().max(100),
  successor: z.string().max(100),
  successorRole: Role,
  people: anyArray.max(500),
  sources: anyArray.max(200),
  engine: z.enum(["auto", "ai", "rules"]).default("auto"),
});

const InterviewBody = z.object({
  leaver: z.string().max(100),
  successorRole: Role,
  sources: anyArray,
  claims: anyArray,
  questions: anyArray,
  answers: z.record(z.string(), z.string().max(2000)),
});

const PublishBody = z.object({ project: z.any(), approvedBy: z.string().min(1).max(100), previous: z.any().optional() });
const AckBody = z.object({ section: z.enum(["state", "owners", "open", "risks", "timeline", "plan"]), by: z.string().min(1).max(100) });
const FlagBody = z.object({ claimId: z.string().max(100), note: z.string().min(1).max(1000), by: z.string().min(1).max(100) });

// ---------------------------------------------------------------- routes

const routes: Route[] = [
  ["GET", /^\/api\/health$/, async ({ res }) => {
    const ai = aiConfig();
    const store = await getStore();
    json(res, 200, {
      ok: true,
      version: VERSION,
      ai: ai ? { configured: true, provider: ai.provider, providerLabel: PROVIDER_LABEL[ai.provider], model: ai.model } : { configured: false },
      storage: { mode: store.mode, durable: store.durable },
      github: { token: !!process.env.GITHUB_TOKEN },
      ...workspaceHealth(),
    });
  }],

  ["POST", /^\/api\/ai\/test$/, async ({ req, res }) => {
    limit(req, "aitest", 10);
    const ai = aiConfig();
    if (!ai) return json(res, 200, { ok: false, ms: 0, message: "No AI key is configured on the server. Baton is using the offline rules engine." });
    json(res, 200, await testConnection(ai));
  }],

  ["GET", /^\/api\/sample$/, async ({ res }) => {
    json(res, 200, { project: createSampleProject(uid("p")) });
  }],

  ["POST", /^\/api\/ingest\/upload$/, async ({ body, res }) => {
    const b = parse(UploadBody, await body());
    const source = parseUpload(b);
    json(res, 200, { source });
  }],

  ["POST", /^\/api\/ingest\/github$/, async ({ req, body, res }) => {
    limit(req, "github", 20);
    const b = parse(GithubBody, await body());
    const repo = parseRepoInput(b.repo);
    if (!repo) throw new HttpError(400, "Enter a repository as owner/name or a github.com URL.");
    try {
      const { bundle, warnings } = await fetchGithub(repo, process.env.GITHUB_TOKEN);
      const source = normalizeGithub(bundle, b.access, b.addedBy);
      source.warnings.push(...warnings);
      json(res, 200, { source });
    } catch (e) {
      if (e instanceof GithubError) throw new HttpError(e.status, e.message);
      throw new HttpError(502, `Could not reach GitHub: ${(e as Error).message}`);
    }
  }],

  ["POST", /^\/api\/ingest\/worklog$/, async ({ body, res }) => {
    const b = parse(WorklogBody, await body());
    json(res, 200, { sources: worklogSources(b.entries, b.existingIds as never) });
  }],

  ["POST", /^\/api\/generate$/, async ({ req, body, res }) => {
    limit(req, "generate", 40);
    const b = parse(GenerateBody, await body());
    const ai = b.engine === "rules" ? null : aiConfig();
    if (b.engine === "ai" && !ai) throw new HttpError(400, "AI engine requested but no AI key is configured on the server.");
    // stream progress as NDJSON so the user sees each pipeline stage
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Accel-Buffering", "no");
    const send = (o: unknown) => res.write(JSON.stringify(o) + "\n");
    try {
      const out = await runPipeline(
        { project: b.project, leaver: b.leaver, successor: b.successor, successorRole: b.successorRole, people: b.people, sources: b.sources },
        {
          callModel: ai ? makeCallModel(ai) : undefined,
          provider: ai ? PROVIDER_LABEL[ai.provider] : undefined,
          model: ai?.model,
          onProgress: (stage, message) => send({ type: "progress", stage, message }),
        },
      );
      send({ type: "result", ...out });
    } catch (e) {
      send({ type: "error", message: (e as Error).message || "Generation failed" });
    }
    res.end();
  }],

  ["POST", /^\/api\/interview$/, async ({ body, res }) => {
    const b = parse(InterviewBody, await body());
    json(res, 200, applyInterview(b, b.answers));
  }],

  ["POST", /^\/api\/publish$/, async ({ body, res }) => {
    const b = parse(PublishBody, await body());
    const project = b.project as Project;
    if (!project?.id || !Array.isArray(project.claims) || !Array.isArray(project.sources)) throw new HttpError(400, "Invalid project");
    const pkg = buildPackage(project, b.approvedBy, b.previous as SharePackage | undefined);
    if (!pkg.claims.length) throw new HttpError(400, "Approve at least one claim before publishing.");
    const store = await getStore();
    let stored = false;
    try {
      await store.set(`pkg:${pkg.id}`, JSON.stringify(pkg));
      stored = true;
    } catch { /* the browser keeps a copy; the link still works on this device */ }
    json(res, 200, { package: pkg, stored, durable: stored && store.durable, storage: store.mode });
  }],

  ["GET", /^\/api\/share\/([\w-]{3,120})$/, async (c) => {
    const r = await resolvePackage(c, c.params[0]);
    json(c.res, 200, { package: r.pkg, access: r.via });
  }],

  ["POST", /^\/api\/share\/([\w-]{3,120})\/ack$/, async (c) => {
    const b = parse(AckBody, await c.body());
    const r = await resolvePackage(c, c.params[0]);
    json(c.res, 200, { package: await recordEvent(r, "ack", { section: b.section as SectionKey }, b.by) });
  }],

  ["POST", /^\/api\/share\/([\w-]{3,120})\/flag$/, async (c) => {
    const b = parse(FlagBody, await c.body());
    const r = await resolvePackage(c, c.params[0]);
    json(c.res, 200, { package: await recordEvent(r, "flag", { claimId: b.claimId, note: b.note }, b.by) });
  }],

  ...workspaceRoutes,
];

export async function handle(req: IncomingMessage, res: ServerResponse, opts: { body?: unknown; raw?: string } = {}): Promise<void> {
  securityHeaders(res);
  const url = new URL(req.url || "/", "http://local");
  const forced = url.searchParams.get("__path");
  const path = forced !== null ? "/api/" + forced.replace(/^\/+/, "") : url.pathname.replace(/\/+$/, "") || "/";
  url.searchParams.delete("__path");
  const method = (req.method || "GET").toUpperCase();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "localhost");
  const proto = String(req.headers["x-forwarded-proto"] || (/^(localhost|127\.)/.test(host) ? "http" : "https")).split(",")[0];
  try {
    for (const [m, re, fn] of routes) {
      const match = re.exec(path);
      if (!match) continue;
      if (m !== method) continue;
      let rawP: Promise<string> | undefined;
      let bodyP: Promise<unknown> | undefined;
      const pre = opts.body;
      const raw = () => (rawP ||= opts.raw !== undefined ? Promise.resolve(opts.raw) : pre !== undefined && pre !== null && pre !== "" ? Promise.resolve(typeof pre === "string" ? pre : Buffer.isBuffer(pre) ? pre.toString("utf8") : JSON.stringify(pre)) : readRaw(req));
      const body = () => (bodyP ||= (async () => {
        if (opts.raw === undefined && pre !== undefined && pre !== null && pre !== "" && typeof pre !== "string" && !Buffer.isBuffer(pre)) return pre;
        const text = await raw();
        if (!text) return {};
        try { return JSON.parse(text); } catch { throw new HttpError(400, "Body is not valid JSON"); }
      })());
      await fn({ req, res, params: match.slice(1), body, raw, query: url.searchParams, origin: `${proto}://${host}` });
      return;
    }
    if (routes.some(([, re]) => re.test(path))) throw new HttpError(405, "Method not allowed");
    throw new HttpError(404, "Not found");
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error("[baton]", e);
    if (!res.headersSent) json(res, status, { error: e instanceof HttpError ? e.message : "Internal error. Please try again." });
    else res.end();
  }
}
