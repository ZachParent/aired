import { getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import type { AppBindings } from "../types.js";

const PAGE_ACCESS_MAX_AGE_SECONDS = 60 * 60;
const PAGE_ACCESS_TOKEN_VERSION = 1;

type PageAccessTokenPayload = {
  v: typeof PAGE_ACCESS_TOKEN_VERSION;
  pageId: string;
  exp: number;
};

export function pageAccessCookieName(pageId: string): string {
  return `aired_page_access_${pageId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

function isConfiguredSecret(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0 && value !== "undefined";
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

function textToBase64Url(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function base64UrlToText(value: string): string | null {
  const bytes = base64UrlToBytes(value);
  if (bytes === null) return null;
  try {
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  let diff = aBytes.length ^ bBytes.length;
  const length = Math.max(aBytes.length, bBytes.length);
  for (let i = 0; i < length; i += 1) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

async function hmacSha256Base64Url(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

function parsePayload(raw: string | null): PageAccessTokenPayload | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      parsed.v !== PAGE_ACCESS_TOKEN_VERSION ||
      typeof parsed.pageId !== "string" ||
      typeof parsed.exp !== "number"
    ) {
      return null;
    }
    return {
      v: PAGE_ACCESS_TOKEN_VERSION,
      pageId: parsed.pageId,
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}

export async function createPageAccessToken(
  pageId: string,
  secret: string,
  nowMs = Date.now(),
): Promise<string> {
  if (!isConfiguredSecret(secret)) {
    throw new Error("SESSION_SECRET is not configured");
  }
  const payload: PageAccessTokenPayload = {
    v: PAGE_ACCESS_TOKEN_VERSION,
    pageId,
    exp: Math.floor(nowMs / 1000) + PAGE_ACCESS_MAX_AGE_SECONDS,
  };
  const encodedPayload = textToBase64Url(JSON.stringify(payload));
  const signature = await hmacSha256Base64Url(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export async function verifyPageAccessToken(
  token: string,
  pageId: string,
  secret: string,
  nowMs = Date.now(),
): Promise<boolean> {
  if (!isConfiguredSecret(secret)) return false;
  const parts = token.split(".");
  if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined) {
    return false;
  }

  const expectedSignature = await hmacSha256Base64Url(parts[0], secret);
  if (!timingSafeEqual(parts[1], expectedSignature)) {
    return false;
  }

  const payload = parsePayload(base64UrlToText(parts[0]));
  if (payload === null) return false;

  const nowSeconds = Math.floor(nowMs / 1000);
  return payload.pageId === pageId && payload.exp > nowSeconds;
}

export async function hasPageAccess(c: Context<AppBindings>, pageId: string): Promise<boolean> {
  const token = getCookie(c, pageAccessCookieName(pageId));
  if (token === undefined) return false;
  return verifyPageAccessToken(token, pageId, c.env.SESSION_SECRET);
}

export async function setPageAccessCookie(c: Context<AppBindings>, pageId: string): Promise<void> {
  const token = await createPageAccessToken(pageId, c.env.SESSION_SECRET);
  setCookie(c, pageAccessCookieName(pageId), token, {
    secure: true,
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: PAGE_ACCESS_MAX_AGE_SECONDS,
  });
}

export function verifyPagePin(candidate: string, expected: string | null): boolean {
  return expected !== null && timingSafeEqual(candidate, expected);
}
