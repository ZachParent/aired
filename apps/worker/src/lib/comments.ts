import { getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import type { AppBindings } from "../types.js";

export const COMMENT_SESSION_COOKIE_NAME = "aired_comment_session";

const COMMENT_LIST_LIMIT = 200;
const COMMENT_BODY_LIMIT = 2000;
const COMMENT_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

const ADJECTIVES = [
  "Quiet",
  "Blue",
  "Pixel",
  "Copper",
  "Neon",
  "Silver",
  "Soft",
  "Violet",
  "Amber",
  "Cloud",
  "Signal",
  "Bright",
];

const NOUNS = [
  "Lantern",
  "Comet",
  "Harbor",
  "Signal",
  "Ridge",
  "Orbit",
  "Echo",
  "Relay",
  "Static",
  "Beacon",
  "Circuit",
  "Prism",
];

const ICONS = ["spark", "dot", "wave", "ring", "beam", "prism", "orbit", "flare"];

export type CommentAnchor = {
  selector: string;
  selectorVersion: 1;
  textQuote: string | null;
  elementPath: string[];
  elementHash: string | null;
  rect: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number };
};

export type CommentAuthor = {
  type: "anonymous" | "github";
  displayName: string;
  icon: string | null;
  avatarUrl: string | null;
  githubLogin: string | null;
  githubUserId: number | null;
};

export type PageComment = {
  id: string;
  pageId: string;
  parentId: string | null;
  body: string;
  anchor: CommentAnchor;
  author: CommentAuthor;
  status: "open" | "resolved";
  createdAt: string;
  updatedAt: string;
};

type AnonymousCommentSession = {
  id: string;
  displayName: string;
  icon: string;
  createdAt: string;
  lastSeenAt: string;
};

export function commentsKey(pageId: string): string {
  return `comments:${pageId}`;
}

function commentSessionKey(id: string): string {
  return `comment_session:${id}`;
}

function randomIndex(length: number): number {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return (bytes[0] ?? 0) % length;
}

function pick(values: readonly string[]): string {
  return values[randomIndex(values.length)] ?? values[0] ?? "Anonymous";
}

function createAnonymousSession(): AnonymousCommentSession {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    displayName: `${pick(ADJECTIVES)} ${pick(NOUNS)}`,
    icon: pick(ICONS),
    createdAt: now,
    lastSeenAt: now,
  };
}

function parseAnonymousSession(raw: string | null): AnonymousCommentSession | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.displayName !== "string" ||
      typeof parsed.icon !== "string" ||
      typeof parsed.createdAt !== "string"
    ) {
      return null;
    }
    return {
      id: parsed.id,
      displayName: parsed.displayName,
      icon: parsed.icon,
      createdAt: parsed.createdAt,
      lastSeenAt: typeof parsed.lastSeenAt === "string" ? parsed.lastSeenAt : parsed.createdAt,
    };
  } catch {
    return null;
  }
}

export async function getOrCreateCommentAuthor(c: Context<AppBindings>): Promise<CommentAuthor> {
  const user = c.get("user");
  if (user !== null) {
    return {
      type: "github",
      displayName: user.name ?? user.login,
      icon: null,
      avatarUrl: `https://avatars.githubusercontent.com/u/${user.id}?s=80`,
      githubLogin: user.login,
      githubUserId: user.id,
    };
  }

  const cookieValue = getCookie(c, COMMENT_SESSION_COOKIE_NAME) ?? null;
  let session = parseAnonymousSession(
    cookieValue ? await c.env.PAGES_KV.get(commentSessionKey(cookieValue)) : null,
  );

  if (session === null) {
    session = createAnonymousSession();
  }

  const updated = { ...session, lastSeenAt: new Date().toISOString() };
  await c.env.PAGES_KV.put(
    commentSessionKey(updated.id),
    JSON.stringify(updated),
    { expirationTtl: COMMENT_SESSION_MAX_AGE_SECONDS },
  );

  setCookie(c, COMMENT_SESSION_COOKIE_NAME, updated.id, {
    secure: true,
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: COMMENT_SESSION_MAX_AGE_SECONDS,
  });

  return {
    type: "anonymous",
    displayName: updated.displayName,
    icon: updated.icon,
    avatarUrl: null,
    githubLogin: null,
    githubUserId: null,
  };
}

function parseAnchor(value: unknown): CommentAnchor | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const obj = value as Record<string, unknown>;
  const rect = obj.rect;
  const viewport = obj.viewport;
  if (
    typeof obj.selector !== "string" ||
    obj.selector.length === 0 ||
    obj.selector.length > 1000 ||
    obj.selectorVersion !== 1 ||
    !Array.isArray(obj.elementPath) ||
    typeof rect !== "object" ||
    rect === null ||
    Array.isArray(rect) ||
    typeof viewport !== "object" ||
    viewport === null ||
    Array.isArray(viewport)
  ) {
    return null;
  }
  const rectObj = rect as Record<string, unknown>;
  const viewportObj = viewport as Record<string, unknown>;
  if (
    typeof rectObj.x !== "number" ||
    typeof rectObj.y !== "number" ||
    typeof rectObj.width !== "number" ||
    typeof rectObj.height !== "number" ||
    typeof viewportObj.width !== "number" ||
    typeof viewportObj.height !== "number"
  ) {
    return null;
  }
  return {
    selector: obj.selector,
    selectorVersion: 1,
    textQuote: typeof obj.textQuote === "string" ? obj.textQuote.slice(0, 240) : null,
    elementPath: obj.elementPath
      .filter((part): part is string => typeof part === "string")
      .slice(0, 24),
    elementHash: typeof obj.elementHash === "string" ? obj.elementHash.slice(0, 80) : null,
    rect: {
      x: rectObj.x,
      y: rectObj.y,
      width: rectObj.width,
      height: rectObj.height,
    },
    viewport: {
      width: viewportObj.width,
      height: viewportObj.height,
    },
  };
}

function parseComment(raw: unknown): PageComment | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const author = obj.author;
  const anchor = parseAnchor(obj.anchor);
  if (
    typeof obj.id !== "string" ||
    typeof obj.pageId !== "string" ||
    typeof obj.body !== "string" ||
    anchor === null ||
    typeof author !== "object" ||
    author === null ||
    Array.isArray(author) ||
    typeof obj.createdAt !== "string" ||
    typeof obj.updatedAt !== "string"
  ) {
    return null;
  }
  const authorObj = author as Record<string, unknown>;
  const authorType = authorObj.type === "github" ? "github" : "anonymous";
  return {
    id: obj.id,
    pageId: obj.pageId,
    parentId: typeof obj.parentId === "string" ? obj.parentId : null,
    body: obj.body,
    anchor,
    author: {
      type: authorType,
      displayName: typeof authorObj.displayName === "string" ? authorObj.displayName : "Anonymous",
      icon: typeof authorObj.icon === "string" ? authorObj.icon : null,
      avatarUrl: typeof authorObj.avatarUrl === "string" ? authorObj.avatarUrl : null,
      githubLogin: typeof authorObj.githubLogin === "string" ? authorObj.githubLogin : null,
      githubUserId: typeof authorObj.githubUserId === "number" ? authorObj.githubUserId : null,
    },
    status: obj.status === "resolved" ? "resolved" : "open",
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

export async function loadComments(kv: KVNamespace, pageId: string): Promise<PageComment[]> {
  const raw = await kv.get(commentsKey(pageId));
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(parseComment).filter((comment): comment is PageComment => comment !== null);
  } catch {
    return [];
  }
}

export async function saveComments(
  kv: KVNamespace,
  pageId: string,
  comments: PageComment[],
): Promise<void> {
  await kv.put(
    commentsKey(pageId),
    JSON.stringify(comments.slice(-COMMENT_LIST_LIMIT)),
  );
}

export function visibleComments(comments: PageComment[]): PageComment[] {
  return comments.filter((comment) => comment.status !== "resolved" || comment.body.length > 0);
}

export function buildComment(input: {
  pageId: string;
  parentId: string | null;
  body: unknown;
  anchor: unknown;
  author: CommentAuthor;
}): PageComment | { error: string } {
  if (typeof input.body !== "string" || input.body.trim().length === 0) {
    return { error: "Comment body is required." };
  }
  const body = input.body.trim().slice(0, COMMENT_BODY_LIMIT);
  const anchor = parseAnchor(input.anchor);
  if (anchor === null) {
    return { error: "A valid element anchor is required." };
  }
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    pageId: input.pageId,
    parentId: input.parentId,
    body,
    anchor,
    author: input.author,
    status: "open",
    createdAt: now,
    updatedAt: now,
  };
}

export function pageIdFromUrlOrId(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    const match = url.pathname.match(/^\/p\/([^/]+)/);
    return match?.[1] ?? null;
  } catch {
    return trimmed.replace(/^\/?p\//, "") || null;
  }
}
