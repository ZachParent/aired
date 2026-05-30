import { Hono } from "hono";
import type { AppBindings } from "../types.js";
import { parseMetadata, serializeMetadata } from "@aired/core";
import { applyPageHeaders } from "../middleware/security.js";
import { loadStats, saveStats } from "../lib/stats.js";
import { hasPageAccess, setPageAccessCookie, verifyPagePin } from "../lib/page-access.js";

const viewer = new Hono<AppBindings>();

// GET /p/:id — serve the published HTML page
viewer.get("/p/:id", async (c) => {
  const id = c.req.param("id");

  const raw = await c.env.PAGES_KV.get(`page:${id}`);
  if (raw === null) {
    return c.text("Page not found", 404);
  }

  const metadata = parseMetadata(raw);
  if (metadata === null) {
    return c.text("Page metadata is corrupted", 500);
  }

  // Check read limit
  if (metadata.reads !== null && metadata.readCount >= metadata.reads) {
    return new Response(
      `<!DOCTYPE html><html><head><title>Gone</title></head><body>
      <h1>410 Gone</h1>
      <p>This page has reached its maximum view limit and is no longer available.</p>
      </body></html>`,
      {
        status: 410,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    );
  }

  // Check PIN protection
  if (metadata.pin !== null) {
    if (!(await hasPageAccess(c, id))) {
      return new Response(renderPinPage(id), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
  }

  // Fetch HTML from R2
  const obj = await c.env.PAGES_BUCKET.get(`pages/${id}/index.html`);
  if (obj === null) {
    return c.text("Page content not found", 404);
  }

  const html = await obj.text();

  // Increment read count (eventually consistent — slight inaccuracy is acceptable)
  const newReadCount = metadata.readCount + 1;
  const updated = { ...metadata, readCount: newReadCount };
  const kvOptions: KVNamespacePutOptions = {};
  if (!metadata.permanent && metadata.expiresAt !== null) {
    const remaining = Math.floor(
      (new Date(metadata.expiresAt).getTime() - Date.now()) / 1000,
    );
    if (remaining > 0) {
      kvOptions.expirationTtl = remaining;
    }
  }
  // Fire-and-forget — don't block response
  // Two KV writes: page metadata (readCount) + merged stats blob
  const country = (c.req.header("CF-IPCountry") ?? "XX").toUpperCase();
  c.executionCtx.waitUntil(
    Promise.all([
      c.env.PAGES_KV.put(`page:${id}`, serializeMetadata(updated), kvOptions),
      (async () => {
        const stats = await loadStats(c.env.PAGES_KV);
        stats.views += 1;
        stats.geo[country] = (stats.geo[country] ?? 0) + 1;
        stats.recent.unshift({
          title: metadata.title ?? "Untitled",
          country,
          ts: Date.now(),
        });
        if (stats.recent.length > 20) stats.recent.length = 20;
        await saveStats(c.env.PAGES_KV, stats);
      })(),
    ]).catch(() => {}),
  );

  const headers = new Headers();
  applyPageHeaders(headers);

  // Extract title from HTML for OG tags
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const pageTitle = titleMatch?.[1]?.trim() || metadata.title || "Shared page";

  const origin = new URL(c.req.url).origin;
  const wrappedHtml = injectAiredBar(html, {
    id,
    origin,
    title: pageTitle,
    readCount: newReadCount,
  });

  return new Response(wrappedHtml, { status: 200, headers });
});

// POST /p/:id/verify-pin — verify PIN, set cookie, redirect
viewer.post("/p/:id/verify-pin", async (c) => {
  const id = c.req.param("id");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    // Try form data fallback
    try {
      const form = await c.req.formData();
      body = { pin: form.get("pin") };
    } catch {
      return c.json({ error: "Invalid request body" }, 400);
    }
  }

  if (typeof body !== "object" || body === null) {
    return c.json({ error: "Request body must be a JSON object" }, 400);
  }

  const { pin } = body as Record<string, unknown>;
  if (typeof pin !== "string") {
    return c.json({ error: "pin is required" }, 400);
  }

  const raw = await c.env.PAGES_KV.get(`page:${id}`);
  if (raw === null) {
    return c.json({ error: "Page not found" }, 404);
  }

  const metadata = parseMetadata(raw);
  if (metadata === null) {
    return c.json({ error: "Page metadata is corrupted" }, 500);
  }

  if (metadata.pin === null) {
    return c.json({ error: "Page is not PIN protected" }, 400);
  }

  if (!verifyPagePin(pin, metadata.pin)) {
    return c.json({ error: "Incorrect PIN" }, 403);
  }

  try {
    await setPageAccessCookie(c, id);
  } catch {
    return c.json({ error: "Page access is not configured" }, 503);
  }

  return c.json({ ok: true });
});

// --- Helpers ---

/**
 * Injects OG meta tags into <head> and appends the floating comment control before </body>.
 */
function injectAiredBar(
  html: string,
  opts: { id: string; origin: string; title: string; readCount: number },
): string {
  const { id, origin, title } = opts;

  const ogImageUrl = `${origin}/og/${id}`;
  const ogTags = `
  <!-- aired OG tags -->
  <meta property="og:title" content="${escapeAttr(title)}" />
  <meta property="og:description" content="Shared via aired.sh — publish HTML artifacts instantly." />
  <meta property="og:type" content="website" />
  <meta property="og:image" content="${ogImageUrl}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content="${ogImageUrl}" />`;

  // Inject OG tags before </head>
  let out = html.replace(/<\/head>/i, `${ogTags}\n</head>`);
  // If no </head>, prepend at the top (best-effort)
  if (out === html) {
    out = ogTags + "\n" + html;
  }

  const escapedOrigin = escapeAttr(origin);
  const escapedId = escapeAttr(id);
  const bar = `
<!-- aired comments -->
<style>
  #__aired-bar {
    position: fixed;
    bottom: 14px;
    right: 14px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px 5px 8px;
    background: rgba(10, 10, 11, 0.72);
    backdrop-filter: saturate(160%) blur(14px);
    -webkit-backdrop-filter: saturate(160%) blur(14px);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 999px;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.01em;
    color: rgba(237,237,239,0.55);
    z-index: 2147483647;
    white-space: nowrap;
    pointer-events: auto;
    line-height: 1;
    box-shadow: 0 1px 2px rgba(0,0,0,0.25), 0 4px 16px rgba(0,0,0,0.18);
    transition: color 180ms ease, background 180ms ease,
                border-color 180ms ease, box-shadow 220ms ease,
                transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  #__aired-bar:hover,
  #__aired-bar:focus-within,
  #__aired-bar.is-open {
    color: rgba(237,237,239,0.92);
    background: rgba(10, 10, 11, 0.88);
    border-color: rgba(124, 106, 239, 0.28);
    box-shadow: 0 1px 2px rgba(0,0,0,0.3),
                0 6px 24px rgba(0,0,0,0.22),
                0 0 0 3px rgba(124, 106, 239, 0.08);
    transform: translateY(-1px);
  }
  #__aired-bar .__aired-comment-button {
    appearance: none;
    border: 0;
    background: transparent;
    color: inherit;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0;
    margin: 0;
    font: inherit;
    line-height: 1;
    cursor: crosshair;
  }
  #__aired-bar .__aired-comment-button:focus-visible {
    outline: 1px solid rgba(124, 106, 239, 0.6);
    outline-offset: 2px;
    border-radius: 999px;
  }
  #__aired-bar .__aired-mark {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    color: #7c6aef;
    transition: transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  #__aired-bar:hover .__aired-mark,
  #__aired-bar:focus-within .__aired-mark,
  #__aired-bar.is-open .__aired-mark {
    transform: rotate(-8deg) scale(1.05);
  }
  #__aired-bar .__aired-wordmark {
    color: rgba(237,237,239,0.85);
    font-weight: 600;
  }
  #__aired-bar .__aired-comment-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 14px;
    height: 14px;
    padding: 0 4px;
    border-radius: 999px;
    background: rgba(124, 106, 239, 0.2);
    color: rgba(237,237,239,0.78);
    font-size: 9px;
    font-variant-numeric: tabular-nums;
  }
  @media (prefers-reduced-motion: reduce) {
    #__aired-bar,
    #__aired-bar .__aired-mark {
      transition: none;
    }
  }
</style>
<div id="__aired-bar" role="complementary" aria-label="Leave a comment" data-aired-page-id="${escapedId}" data-aired-origin="${escapedOrigin}">
  <button type="button" id="__aired-comment-button" class="__aired-comment-button" aria-pressed="false" title="Leave a comment">
    <svg class="__aired-mark" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M8 9.5C8 7.6 9.6 6 11.5 6h9C22.4 6 24 7.6 24 9.5v6.2c0 1.9-1.6 3.5-3.5 3.5h-4.2l-4.9 4.2v-4.2c-1.9 0-3.4-1.6-3.4-3.5V9.5Z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/>
      <path d="M12.8 11.8h6.4M12.8 15h4.5" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>
    </svg>
    <span class="__aired-wordmark">comment</span>
    <span id="__aired-comment-count" class="__aired-comment-count" hidden></span>
  </button>
</div>
<script src="${escapedOrigin}/comments.js" defer></script>`;

  // Inject bar before </body>
  const barOut = out.replace(/<\/body>/i, `${bar}\n</body>`);
  // If no </body>, append at end
  return barOut === out ? out + bar : barOut;
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}


function renderPinPage(id: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PIN Required — aired.sh</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0a0a0a;
      color: #e5e5e5;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      text-align: center;
      padding: 2rem;
      max-width: 360px;
      width: 100%;
    }
    h1 {
      font-size: 1.25rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
    }
    p {
      color: #888;
      font-size: 0.875rem;
      margin-bottom: 1.5rem;
    }
    input {
      width: 100%;
      padding: 0.75rem 1rem;
      font-size: 1rem;
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 6px;
      color: #e5e5e5;
      text-align: center;
      letter-spacing: 0.25em;
      outline: none;
      margin-bottom: 1rem;
    }
    input:focus { border-color: #555; }
    button {
      width: 100%;
      padding: 0.75rem;
      font-size: 0.9rem;
      font-weight: 500;
      background: #e5e5e5;
      color: #0a0a0a;
      border: none;
      border-radius: 6px;
      cursor: pointer;
    }
    button:hover { background: #fff; }
    .error {
      color: #f87171;
      font-size: 0.8rem;
      margin-top: 0.5rem;
      display: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>PIN Required</h1>
    <p>This page is protected. Enter the PIN to view it.</p>
    <form id="pin-form">
      <input
        type="password"
        id="pin-input"
        name="pin"
        inputmode="numeric"
        placeholder="Enter PIN"
        autocomplete="off"
        maxlength="20"
        autofocus
      />
      <button type="submit">Unlock</button>
      <p class="error" id="error-msg">Incorrect PIN. Try again.</p>
    </form>
  </div>
  <script>
    const form = document.getElementById('pin-form');
    const input = document.getElementById('pin-input');
    const errorMsg = document.getElementById('error-msg');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorMsg.style.display = 'none';
      const pin = input.value.trim();
      if (!pin) return;

      const res = await fetch('/p/${id}/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
        credentials: 'same-origin',
      });

      if (res.ok) {
        window.location.reload();
      } else {
        errorMsg.style.display = 'block';
        input.value = '';
        input.focus();
      }
    });
  </script>
</body>
</html>`;
}

export { viewer };
