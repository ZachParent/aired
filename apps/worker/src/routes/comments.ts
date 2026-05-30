import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { Context } from "hono";
import type { AppBindings } from "../types.js";
import { parseMetadata } from "@aired/core";
import { rateLimit } from "../middleware/rate-limit.js";
import { TIERS } from "../lib/rate-limit-tiers.js";
import {
  buildComment,
  getOrCreateCommentAuthor,
  loadComments,
  saveComments,
  visibleComments,
} from "../lib/comments.js";

const comments = new Hono<AppBindings>();

function pageIdParam(c: Context<AppBindings>): string | null {
  const id = c.req.param("id");
  return typeof id === "string" && id.length > 0 ? id : null;
}

async function requirePageViewable(c: Context<AppBindings>, id: string) {
  const raw = await c.env.PAGES_KV.get(`page:${id}`);
  if (raw === null) {
    return { ok: false as const, response: c.json({ error: "Page not found" }, 404) };
  }
  const metadata = parseMetadata(raw);
  if (metadata === null) {
    return { ok: false as const, response: c.json({ error: "Page metadata is corrupted" }, 500) };
  }
  if (metadata.pin !== null) {
    const pinCookie = getCookie(c, `pin_${id}`) ?? null;
    if (pinCookie !== metadata.pin) {
      return { ok: false as const, response: c.json({ error: "PIN required" }, 403) };
    }
  }
  return { ok: true as const, metadata };
}

comments.get("/pages/:id/comments/session", async (c) => {
  const id = pageIdParam(c);
  if (id === null) return c.json({ error: "Page id is required" }, 400);
  const page = await requirePageViewable(c, id);
  if (!page.ok) return page.response;
  const identity = await getOrCreateCommentAuthor(c);
  return c.json({ identity });
});

comments.get("/pages/:id/comments", async (c) => {
  const id = pageIdParam(c);
  if (id === null) return c.json({ error: "Page id is required" }, 400);
  const page = await requirePageViewable(c, id);
  if (!page.ok) return page.response;
  const allComments = await loadComments(c.env.PAGES_KV, id);
  return c.json({ comments: visibleComments(allComments) });
});

comments.post("/pages/:id/comments", rateLimit(TIERS.comments), async (c) => {
  const id = pageIdParam(c);
  if (id === null) return c.json({ error: "Page id is required" }, 400);
  const page = await requirePageViewable(c, id);
  if (!page.ok) return page.response;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return c.json({ error: "Request body must be a JSON object" }, 400);
  }

  const req = body as Record<string, unknown>;
  const author = await getOrCreateCommentAuthor(c);
  const comment = buildComment({
    pageId: id,
    parentId: typeof req.parentId === "string" ? req.parentId : null,
    body: req.body,
    anchor: req.anchor,
    author,
  });

  if ("error" in comment) {
    return c.json({ error: comment.error }, 400);
  }

  const allComments = await loadComments(c.env.PAGES_KV, id);
  allComments.push(comment);
  await saveComments(c.env.PAGES_KV, id, allComments);

  return c.json({ comment, identity: author }, 201);
});

export { comments };
