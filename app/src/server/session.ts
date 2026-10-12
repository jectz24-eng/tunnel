import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const NONCE_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60_000;
export const SESSION_COOKIE = "tunnel_session";

function secret(): Buffer {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return Buffer.from(s);
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET (32+ chars) is required in production");
  // Development only: a per-process secret (sessions reset on restart).
  return ((globalThis as any).__tunnelDevSecret ??= randomBytes(32));
}

const mac = (data: string) => createHmac("sha256", secret()).update(data).digest("base64url");

function safeEq(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Stateless single-use-window nonce bound to the address and issue time. */
export function buildSignInMessage(address: string, origin: string) {
  const issuedAt = new Date().toISOString();
  const nonce = `${randomBytes(9).toString("base64url")}.${mac(`${address}|${issuedAt}`)}`;
  return [
    `${new URL(origin).host} wants you to sign in with your Solana account:`,
    address,
    "",
    "Sign in to TUNNEL. This request will not trigger a blockchain transaction, move funds or cost any fees.",
    "",
    `URI: ${origin}`,
    "Version: 1",
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");
}

/** Validates the message structure, binding, nonce MAC and freshness. */
export function checkSignInMessage(message: string, address: string, origin: string): string | null {
  const lines = message.split("\n");
  if (lines[1] !== address) return "address mismatch";
  if (!lines[0]?.startsWith(`${new URL(origin).host} wants you`)) return "domain mismatch";
  const nonce = /^Nonce: (.+)$/m.exec(message)?.[1];
  const issuedAt = /^Issued At: (.+)$/m.exec(message)?.[1];
  if (!nonce || !issuedAt) return "malformed message";
  const [, tag] = nonce.split(".");
  if (!tag || !safeEq(tag, mac(`${address}|${issuedAt}`))) return "invalid nonce";
  const age = Date.now() - Date.parse(issuedAt);
  if (!(age >= -30_000 && age <= NONCE_TTL_MS)) return "message expired";
  return null;
}

export function issueSession(address: string) {
  const exp = Date.now() + SESSION_TTL_MS;
  return { value: `${address}.${exp}.${mac(`${address}.${exp}`)}`, maxAge: SESSION_TTL_MS / 1000 };
}

export function readSession(cookie: string | undefined): string | null {
  if (!cookie) return null;
  const [address, exp, tag] = cookie.split(".");
  if (!address || !exp || !tag) return null;
  if (!safeEq(tag, mac(`${address}.${exp}`)) || Number(exp) < Date.now()) return null;
  return address;
}

const ADMIN_TTL_MS = 12 * 60 * 60_000;
export const ADMIN_COOKIE = "tunnel_admin";

/** Admin session after a correct password. Its MAC domain differs from wallet sessions, so one cannot stand in for the other. */
export function issueAdminSession() {
  const exp = Date.now() + ADMIN_TTL_MS;
  return { value: `${exp}.${mac(`admin|${exp}`)}`, maxAge: ADMIN_TTL_MS / 1000 };
}

export function readAdminSession(cookie: string | undefined): boolean {
  if (!cookie) return false;
  const [exp, tag] = cookie.split(".");
  return !!exp && !!tag && safeEq(tag, mac(`admin|${exp}`)) && Number(exp) >= Date.now();
}
