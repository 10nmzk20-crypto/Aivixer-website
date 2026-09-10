import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "../env";
import { providerName } from "../ai/provider";

/**
 * 認証。優先順位:
 *  1. Cloudflare Access（CF_ACCESS_TEAM_DOMAIN と CF_ACCESS_AUD が設定されているとき）… 通行証（JWT）を検証
 *  2. 共有パスワード（APP_PASSWORD）… ログイン画面でパスワードを入れるとクッキーを発行
 *  3. 開発環境（ENVIRONMENT=development）… 認証なし
 *  4. どれも無い本番 … すべての API を拒否（設定漏れで社内データが公開されるのを防ぐ）
 */
export type AuthMode = "access" | "password" | "open" | "locked";

export function authMode(env: Env): AuthMode {
  if (env.CF_ACCESS_TEAM_DOMAIN && env.CF_ACCESS_AUD) return "access";
  if (env.APP_PASSWORD) return "password";
  if (env.ENVIRONMENT === "development") return "open";
  return "locked";
}

const SESSION_COOKIE = "vixer_ai_session";
const SESSION_DAYS = 30;

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksFor = "";

async function verifyAccessJwt(env: Env, token: string): Promise<boolean> {
  const team = env.CF_ACCESS_TEAM_DOMAIN!;
  const issuer = `https://${team}.cloudflareaccess.com`;
  if (!jwks || jwksFor !== team) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    jwksFor = team;
  }
  try {
    await jwtVerify(token, jwks, { issuer, audience: env.CF_ACCESS_AUD! });
    return true;
  } catch {
    return false;
  }
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sessionSecret(env: Env): string {
  return env.APP_SESSION_SECRET || `vixer-ai-company:${env.APP_PASSWORD}`;
}

async function makeSession(env: Env): Promise<string> {
  const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  return `${exp}.${await hmac(sessionSecret(env), `session:${exp}`)}`;
}

async function verifySession(env: Env, value: string | undefined): Promise<boolean> {
  if (!value) return false;
  const [expStr, sig] = value.split(".");
  const exp = Number(expStr);
  if (!exp || !sig || exp < Date.now()) return false;
  return timingSafeEqual(sig, await hmac(sessionSecret(env), `session:${exp}`));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function isAuthenticated(c: Context<{ Bindings: Env }>): Promise<boolean> {
  const env = c.env;
  switch (authMode(env)) {
    case "open":
      return true;
    case "locked":
      return false;
    case "access": {
      const token = c.req.header("Cf-Access-Jwt-Assertion") || getCookie(c, "CF_Authorization");
      return token ? verifyAccessJwt(env, token) : false;
    }
    case "password":
      return verifySession(env, getCookie(c, SESSION_COOKIE));
  }
}

/** /api 配下を守るミドルウェア */
export const requireAuth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const mode = authMode(c.env);
  if (await isAuthenticated(c)) return next();
  if (mode === "locked") {
    return c.json(
      { error: "auth_not_configured", mode, message: "認証が設定されていません。Cloudflare Access（CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD）か、共有パスワード（APP_PASSWORD）を設定してください。" },
      401,
    );
  }
  return c.json({ error: "unauthorized", mode, message: "ログインが必要です。" }, 401);
};

export async function loginHandler(c: Context<{ Bindings: Env }>) {
  const mode = authMode(c.env);
  if (mode !== "password") return c.json({ error: "not_password_mode", mode }, 400);
  const body = await c.req.json<{ password?: string }>().catch(() => ({}) as { password?: string });
  const ok = typeof body.password === "string" && timingSafeEqual(body.password, c.env.APP_PASSWORD!);
  if (!ok) return c.json({ error: "invalid_password", message: "パスワードが違います。" }, 401);
  setCookie(c, SESSION_COOKIE, await makeSession(c.env), {
    httpOnly: true,
    secure: c.env.ENVIRONMENT !== "development",
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  return c.json({ ok: true });
}

export async function logoutHandler(c: Context<{ Bindings: Env }>) {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
}

export async function meHandler(c: Context<{ Bindings: Env }>) {
  const mode = authMode(c.env);
  // AI の種類（mock か claude か）だけを返す。API キーなどの秘密情報は一切返さない
  return c.json({ mode, authenticated: await isAuthenticated(c), ai_provider: providerName(c.env), ai_model: providerName(c.env) === "mock" ? "mock" : c.env.AI_MODEL || "claude-opus-5" });
}
