# Element Comments Plan

## Goal

Add page comments that can attach to specific elements inside published HTML pages without requiring publishers to rebuild their pages around an Aired SDK.

The current architecture already has the right insertion point: `apps/worker/src/routes/viewer.ts` wraps every served page with Aired-owned HTML, CSS, and JavaScript. The comments UI should extend that wrapper rather than mutate the publisher's stored HTML.

## Product Shape

- Comments are opt-in per page or per instance. Published pages should not suddenly become commentable unless Zach enables it.
- The viewer gets a small Aired control for comment mode next to the existing Aired bar.
- In comment mode, hovering elements highlights the target under the cursor.
- Clicking an element opens a composer pinned to that element.
- Existing comments render as small pins anchored to elements. If an anchor cannot be resolved after the page changes, show it in an "unanchored" state instead of dropping it.
- Page owners can resolve, hide, or delete comments. Signed-in users can create comments. Anonymous comments should stay out of the first version unless there is a strong reason to support them.

## Storage

Use D1 for comments, not KV.

KV is fine for page metadata and owner indexes, but comments are relational and will need filtering, pagination, moderation, and thread/reply queries. D1 gives us a clear schema and avoids writing ad hoc JSON blobs that become hard to migrate.

Initial tables:

```sql
create table page_comments (
  id text primary key,
  page_id text not null,
  parent_id text,
  author_id integer,
  author_login text,
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
```

`anchor_json` should be parsed and validated at the API boundary. Keeping it as JSON keeps the schema flexible while we learn which anchor signals are most durable.

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
- Creating comments should require an authenticated GitHub session for MVP.
- Page owners can moderate all comments on their pages.
- Comment authors can edit/delete their own comments until moderation rules say otherwise.

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
} | null;
```

Default `comments` to `null` during parse so old pages remain valid. New publish/update APIs can accept a `comments` option once the UI exists.

## MVP Sequence

1. Add D1 binding and migration for `page_comments`.
2. Add metadata parsing for optional comments settings.
3. Add authenticated comment API routes with tests around permissions.
4. Add a minimal overlay that can select an element, post a comment, and render pins on reload.
5. Add owner moderation actions in the dashboard.
6. Add a publish/update flag to enable comments for a page.
7. Smoke test with simple static HTML, deeply nested layouts, pages with transforms, and pages that re-render DOM after load.

## Open Decisions

- Whether comments should be enabled per page, per owner account, or globally for the self-hosted instance.
- Whether anonymous viewers should be allowed to comment after the authenticated MVP.
- Whether comment notifications belong in-app only or should later send email/webhook events.
- Whether published pages should expose a stable author-provided annotation API such as `data-aired-comment-id`.
