// Signing and verification helpers. Node's built-in crypto only — no dependencies.
import crypto from "node:crypto";

export const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");
export const randomId = (n = 16) => crypto.randomBytes(n).toString("base64url");
export const uuid = () => crypto.randomUUID();

export function safeEqual(a: string | Buffer, b: string | Buffer): boolean {
  const A = Buffer.from(a), B = Buffer.from(b);
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

export const hmac = (secret: string, data: string | Buffer, enc: "hex" | "base64url" = "base64url") => crypto.createHmac("sha256", secret).update(data).digest(enc);

/** Compact signed token: base64url(JSON payload) + "." + HMAC. `exp` is seconds since epoch (0 = never). */
export function signToken(payload: Record<string, unknown>, secret: string): string {
  const body = b64u(JSON.stringify(payload));
  return `${body}.${hmac(secret, body)}`;
}
export function verifyToken<T extends { exp?: number }>(token: string, secret: string, now = Date.now()): { ok: true; payload: T } | { ok: false; reason: "malformed" | "signature" | "expired" } {
  const i = token.lastIndexOf(".");
  if (i < 1) return { ok: false, reason: "malformed" };
  const body = token.slice(0, i), sig = token.slice(i + 1);
  if (!safeEqual(sig, hmac(secret, body))) return { ok: false, reason: "signature" };
  let payload: T;
  try { payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return { ok: false, reason: "malformed" }; }
  if (payload.exp && payload.exp * 1000 < now) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString("base64url")}$${crypto.scryptSync(password, salt, 32).toString("base64url")}`;
}
export function checkPassword(password: string, stored: string): boolean {
  const [alg, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  return safeEqual(crypto.scryptSync(password, Buffer.from(salt, "base64url"), 32).toString("base64url"), hash);
}

/** Discord interactions: Ed25519 signature over timestamp + raw body, checked with the app's public key. */
export function verifyDiscord(publicKeyHex: string, signatureHex: string, timestamp: string, rawBody: string): boolean {
  try {
    if (!/^[0-9a-f]{64}$/i.test(publicKeyHex) || !/^[0-9a-f]{128}$/i.test(signatureHex)) return false;
    const key = crypto.createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKeyHex, "hex")]), format: "der", type: "spki" });
    return crypto.verify(null, Buffer.from(timestamp + rawBody), key, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}

/** GitHub webhooks: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(secret, raw body). */
export function verifyGithub(secret: string, rawBody: string, header: string | undefined): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  return safeEqual(header, "sha256=" + hmac(secret, rawBody, "hex"));
}

/** Slack requests: v0=HMAC-SHA256(signing secret, "v0:timestamp:body"); rejects requests older than 5 minutes. */
export function verifySlack(secret: string, timestamp: string | undefined, rawBody: string, signature: string | undefined, now = Date.now()): boolean {
  if (!timestamp || !signature || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  return safeEqual(signature, "v0=" + hmac(secret, `v0:${timestamp}:${rawBody}`, "hex"));
}
