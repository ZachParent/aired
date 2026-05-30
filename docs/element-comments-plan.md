# Element Comments Plan

## Goal

Add page comments that can attach to specific elements inside published HTML pages without requiring publishers to rebuild their pages around an Aired SDK.

The current architecture already has the right insertion point: `apps/worker/src/routes/viewer.ts` wraps every served page with Aired-owned HTML, CSS, and JavaScript. The comments UI should extend that wrapper rather than mutate the publisher's stored HTML.

## Product Shape

- Comments are opt-in per page or per instance. Published pages should not suddenly become commentable unless Zach enables it.
- The viewer gets a small Aired control for comment mode next to the existing Aired bar.
- In comment mode, hovering elements highlights the target under the cursor.
- Clicking an element opens a composer pinned to that element.
- Existing comments render as tiny anchored pins that stay out of the way until hover/focus. Hovering a pin reveals the comment preview; clicking opens the thread panel.
- Page owners can resolve, hide, or delete comments.
- Anyone can leave comments. Anonymous viewers get a session-scoped generated name and icon. GitHub login upgrades attribution to the user's GitHub identity and profile image.
- MCP clients can retrieve comments for a published document, including anchor metadata, status, author display data, and thread structure.

## Identity

Comments should support two identity modes:

- Anonymous session: when a viewer first comments, issue an HttpOnly session cookie and create an anonymous identity record. The display name should come from a random-name generator service or local wordlist, for example `Quiet Lantern`, `Blue Comet`, or `Pixel Harbor`. The avatar can be a deterministic generated icon keyed by the anonymous session id.
- GitHub user: when signed in, comments store the GitHub user id/login/name/avatar URL. If a previously anonymous commenter logs in during the same session, future comments use GitHub attribution; earlier anonymous comments can either remain anonymous or be claimed if we want that UX later.

Session names and icons should be stable per browser session, not per comment, so a conversation is readable without exposing private identity.

## Storage

Use D1 for comments, not KV.

KV is fine for page metadata and owner indexes, but comments are relational and will need filtering, pagination, moderation, and thread/reply queries. D1 gives us a clear schema and avoids writing ad hoc JSON blobs that become hard to migrate.

Initial tables:

```sql
create table page_comments (
  id text primary key,
  page_id text not null,
  parent_id text,
  author_type text not null,
  author_user_id integer,
  author_login text,
  author_name text,
  author_avatar_url text,
  anonymous_session_id text,
  anonymous_display_name text,
  anonymous_icon text,
  body text not null,
  anchor_json text not null,
  status text not null default 'open',
  created_at text not null,
  updated_at text not null
);

create index page_comments_page_created_idx
  on page_comments (page_id, created_at);

create index page_comments_parent_idx
  on page_comments (parent_id);

create index page_comments_anonymous_session_idx
  on page_comments (anonymous_session_id);
```

`anchor_json` should be parsed and validated at the API boundary. Keeping it as JSON keeps the schema flexible while we learn which anchor signals are most durable.

Anonymous session records can live in a second table if we need regeneration, moderation history, or rate-limit state:

```sql
create table anonymous_comment_sessions (
  id text primary key,
  display_name text not null,
  icon text not null,
  created_at text not null,
  last_seen_at text not null
);
```

## Anchor Model

A comment anchor should store several signals because arbitrary HTML changes over time:

```ts
type CommentAnchor = {
  selector: string;
  selectorVersion: 1;
  textQuote: string | null;
  elementPath: string[];
  elementHash: string | null;
  rect: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number };
};
```

Selector generation priority:

1. Publisher-provided stable attributes: `data-aired-comment-id`, `id`, `data-testid`, `aria-label`.
2. Semantic path with tag names and stable classes.
3. Fallback `nth-of-type` path.

Resolution priority:

1. Resolve `selector`.
2. If selector fails, search for `textQuote` near similar element paths.
3. If still unresolved, show the comment in the sidebar with an unanchored marker.

## API

Add a new route module, probably `apps/worker/src/routes/comments.ts`.

Endpoints:

- `GET /api/pages/:id/comments` - list visible comments for the page.
- `POST /api/pages/:id/comments` - create a top-level comment or reply.
- `PATCH /api/pages/:id/comments/:commentId` - update status or body when authorized.
- `DELETE /api/pages/:id/comments/:commentId` - hide/delete when authorized.
- `GET /api/pages/:id/comments/session` - return or create the viewer's anonymous comment identity.

Request body for create:

```ts
{
  body: string;
  anchor: CommentAnchor;
  parentId?: string;
}
```

Authorization:

- Reading comments can be public when comments are enabled for a public page.
- Creating comments can use either a GitHub session or an anonymous comment session cookie.
- Page owners can moderate all comments on their pages.
- Comment authors can edit/delete their own comments until moderation rules say otherwise.

MCP surface:

- Add a `list_comments` MCP tool that accepts a page id or URL and returns comments grouped by anchor/thread.
- Later add `create_comment` for MCP clients that have a user-approved identity/session path.
- Include enough anchor data for an agent to connect feedback to the relevant element: selector, quote, element path, status, and comment body.

## Picker And Comment UI

The UI should be quiet by default:

- Idle state: show only the existing Aired bar plus a small comment icon/button.
- Comment mode: the cursor becomes a picker. Elements under the cursor get a thin outline and a very small floating affordance, not a heavy overlay.
- Composer: a compact popover near the selected element with the generated anonymous name or GitHub avatar, a textarea, and submit/cancel. Keep the popover narrow and avoid covering the selected element when possible.
- Pins: render as 14-18 px dots or speech bubbles at the element edge. Use a low-contrast neutral fill until hover, then show the author's icon/name and first line of the comment.
- Thread panel: clicking a pin opens a small side panel or anchored popover with the full thread. The page remains usable underneath.
- Density: if several comments attach to nearby elements, cluster them into a small count badge and expand on hover/click.
- Accessibility: pins are buttons with labels, keyboard focus reveals the same preview as hover, Escape exits comment mode or closes the panel.

## Viewer Injection

Extend `injectAiredBar` in `apps/worker/src/routes/viewer.ts` or split the injected UI into helper modules before it grows further.

Implementation details:

- Use a Shadow DOM root for the Aired comment UI so publisher CSS does not break it.
- Keep all generated classes prefixed with `__aired-comments`.
- Put comment pins in a fixed overlay layer with `pointer-events: none`; interactive pins and panels opt back into pointer events.
- Recompute pin positions on scroll, resize, font load, and DOM mutations with debounced observers.
- Do not intercept clicks unless comment mode is active.
- Respect PIN-protected pages after unlock; no comments should load before the page itself is viewable.

The current CSP allows inline scripts and styles for published pages, so an injected overlay can work without a build step. Longer term, move the overlay script to a static asset and inject a versioned `<script src="/comments-overlay.js">` for easier caching and testing.

## Metadata

Add comment settings to `PageMetadata`:

```ts
comments: {
  enabled: boolean;
  visibility: "public" | "owner";
  anonymous: boolean;
} | null;
```

Default `comments` to `null` during parse so old pages remain valid. New publish/update APIs can accept a `comments` option once the UI exists.

## MVP Sequence

1. Add D1 binding and migrations for `page_comments` and anonymous sessions.
2. Add metadata parsing for optional comments settings.
3. Add anonymous session creation plus GitHub identity attribution in the comments API.
4. Add comment API routes with tests around public reads, anonymous writes, GitHub writes, ownership, moderation, and rate limits.
5. Add a minimal overlay that can select an element, post a comment, and render pins on reload.
6. Add MCP `list_comments` support so agents can retrieve comments left on a document.
7. Add owner moderation actions in the dashboard.
8. Add a publish/update flag to enable comments for a page.
9. Smoke test with simple static HTML, deeply nested layouts, pages with transforms, and pages that re-render DOM after load.

## Open Decisions

- Whether comments should be enabled per page, per owner account, or globally for the self-hosted instance.
- Whether comment notifications belong in-app only or should later send email/webhook events.
- Whether published pages should expose a stable author-provided annotation API such as `data-aired-comment-id`.
- Which random-name/icon service to use versus an in-repo deterministic generator.
- Whether anonymous comments can later be claimed after GitHub login.
