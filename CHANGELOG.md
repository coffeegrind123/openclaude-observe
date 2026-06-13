# Changelog

## 13.06.2026 — Memory knowledge graph

A new **Graph** view in the Memory browser renders any store as an interactive, force-directed knowledge map — one glowing node per memory file, edges drawn from resolved `[[wikilinks]]`, laid out with live physics. Toggle between the file **List** and the **Graph** from the browser header; clicking a node opens that file in the docked editor. Inspired by the [brain-map](https://github.com/vladignatyev/brain-map-skill) skill, but reads our own memory model directly — no export step, no new endpoints.

### The graph

- **Force-directed layout** ([react-force-graph-2d](https://github.com/vasturiano/react-force-graph) + `d3-force`) with a collision force so nodes never overlap, smooth canvas pan/zoom, and node dragging.
- **Visual encoding**: colour = memory type (user / feedback / project / reference / structured-claim), node size scales with link degree, each node carries a soft glow. Archived (superseded / outdated) memories render dashed and dimmed.
- **Curved links** coloured by source; hovering a node lights its neighbourhood, dims everything else, and sends **directional particles flowing along its connections**.
- **Readable labels at any zoom**: a level-of-detail pass shows only the top hubs when zoomed out and fades the rest in as you zoom, hover, select, or search — and a collision pass draws labels in priority order, skipping any that would overlap, so they never blend into each other even on dense, panned-out stores.
- **Type-filter chips** with a colour legend, a **highlight search** that rings matching nodes, a white ring on the selected file, and re-centre-on-select when you navigate in from the editor.

## 06.06.2026 — Interactive memory browser

A new **Memory** tab turns the dashboard into a full browser and editor for OpenClaude's file-based memory — the per-fact markdown files under `~/.claude/projects/<project>/memory/`, the global `~/.claude/CLAUDE.md`, and per-agent memory. Files are read and **written straight to disk**; OpenClaude picks the edits up on its next turn. Because editing needs write access, the feature adds its own read-write bind mount of `~/.claude` (separate from the read-only transcript mount); set `OPENCLAUDE_OBSERVE_MEMORY=0` to disable it and drop the mount. In local `just dev` the server reads `~/.claude` directly.

### Browsing & editing

- **Memory sidebar tab** lists every store grouped as Projects / Global / Agents, correlated to observe projects by slug. A full-page browser drills from store → file list → editor, with hash routing (`#/memory/<store>/<file>`).
- **Structured + raw editor**: a typed frontmatter form (type / status / provenance dropdowns, evidence / triggers / supersedes list editors, inline custom-field add) with a raw-markdown toggle and a live preview that renders clickable `[[wikilinks]]`. The reader is schema-adaptive — it handles both the flat top-level schema and the `metadata:`-wrapper schema OpenClaude writes; new files are created in the canonical flat shape.
- **Safe writes**: atomic temp-file + rename, guarded by an advisory `.locks/` lock compatible with OpenClaude's own locking, with path-traversal protection on every operation.

### Navigation & discovery

- **⌘K command palette** with fuzzy cross-store file search, store jumping, and quick actions, backed by a new `/api/memory/search` endpoint.
- **Keyboard navigation** (`j`/`k`/arrows/enter) through the file list.
- **`[[ ]]` autocomplete** in the body and raw editors.
- Outgoing-links, backlinks, and a **supersedes chain** (forward + computed "superseded by") panel, each navigable.

### Lifecycle & health

- Filter and sort by **status** (seedling → current → superseded → outdated); superseded/outdated are hidden by default behind a toggle and de-emphasized, with a banner on the file itself.
- **Stale** (90-day) badges, status icons, and type icons.
- A **MEMORY.md lint** panel flags orphaned index entries, unindexed files, broken wikilinks, and the 200-line / 25 KB load-cap.
- **Session cross-link**: a memory's originating session id links straight to that session in the dashboard — the one thing only an observability-embedded editor can do.

### Server lifecycle

- Removed the idle auto-shutdown entirely. The server no longer self-exits when the last consumer disconnects; it runs until explicitly stopped. The `OPENCLAUDE_OBSERVE_SHUTDOWN_DELAY_MS` variable and the startup grace period are gone.

## 06.06.2026

De-branded the fork into a tool built purely for OpenClaude: renamed the entire environment-variable namespace, removed the last of the inherited multi-agent (codex) support, and swept the repo of stale artifacts. **This release is breaking** — update any `.env`, `docker-compose` override, or shell export that sets an `AGENTS_OBSERVE_*` variable.

### Breaking: environment namespace

- Every `AGENTS_OBSERVE_*` variable is now `OPENCLAUDE_OBSERVE_*` (33 in all), still centralized in `app/server/src/config.ts`. The producer-side `CLAUDE_OBSERVE_URL` that OpenClaude reads is unchanged.
- The browser localStorage keys moved from `agents-observe-*` to `openclaude-observe-*`; pinned sessions and labels reset once on first load after upgrading.

### Codex removal

- Dropped the `~/.codex` date-based (`YYYY/MM/DD`) slug collapsing in `utils/slug.ts`.
- Collapsed the multi-base transcript-path resolver to a single Claude base — `transcriptStats.bases[]` → `transcriptStats.base`, and `resolveTranscriptPath(path, base | null)`.
- Removed the openai-canonical branch from models.dev pricing (anthropic-first; other providers still resolve generically), and deleted every codex fixture and comment from the source and tests.

### Repo cleanup

- Deleted superseded redesign mockups (`design/`), the upstream port-plan docs (`context/upstream-port-plan/`), the archived plugin / namespace-refactor / fresh-install-test-harness plans, all `docs/plans/` implementation specs, the shipped pulse design doc (`docs/superpowers/`), and the pre-redesign screenshots.
- Rewrote `README.md` around the Stream UI with a fresh dashboard screenshot, and aligned `package.json`'s version with the `VERSION` file.

## 04.06.2026

Complete visual redesign of the dashboard — the **"Stream" UI**. A session now reads as a single flowing river of agent activity instead of a boxy two-pane feed: a continuous time-spine with a bead per event, a two-voice type system (monospace telemetry / sans-serif prose), and a restrained palette built on the OpenClaude blue-starburst brand. Both light and dark themes are first-class. Also fixes a Docker port-binding bug that left the published server unreachable.

### Design system

- New token system in `app/client/src/index.css`: a cool console-grey light theme and a slate dark theme, with the OpenClaude blue brand mapped onto the shadcn `--primary` token (the shadcn `--accent` stays the neutral hover surface, so existing components inherit the new look without per-component edits). Adds stream tokens — an ink scale, muted agent-identity colors, run/fail/warm status colors, and a shadow set — and a tighter corner radius.
- Typography is a deliberate two-voice system: **Inter Tight** for prose, **JetBrains Mono** for telemetry / numerics / code, loaded in `index.html`.
- Brand: the OpenClaude blue starburst replaces the `O` placeholder. New `components/shared/starburst.tsx`, starburst `favicon.svg` + `favicon-alert.svg`, `favicon.ico`, and `openclaude-logo.png`; the sidebar shows the mark beside a mono `openclaude observe` wordmark.

### The river (event stream)

- `event-stream.tsx` draws one continuous spine down the virtualized list, and `event-row.tsx` is rebuilt onto it: a left timestamp gutter, a bead riding the spine (diamond = LLM, hollow ring = tool, filled = event, pulsing = running) colored by agent identity (main = blue; subagents = clay / sage / slate / plum), and two-voice content — a monospace telemetry header plus inline sans-serif prose for prompts and assistant / subagent / task messages. Subagent rows sit behind an agent-colored rail. Virtualization, inline expand, selection, flash, and keyboard navigation are all preserved. New agent-identity color helpers (`getAgentStreamColor*`) in `lib/agent-utils.ts`.

### Lean chrome

- The breadcrumb, scope bar, and filter bar are grouped under one soft shadow instead of stacked divider lines (`shadow-float`), with a monospace breadcrumb, a mono `filter` label, a mono events readout, and lightened inactive filter pills. The performance-critical animated activity timeline (with rewind) is unchanged.

### Inspector + view lens

- The standalone chat panel is replaced by a right-hand **inspector** (`components/event-stream/inspector.tsx`) that pops in when an event is selected and reuses the existing `EventDetail` renderer for all rich viewers (token usage, diffs, thread, tool output). Row interaction: plain click selects (opens the inspector); ⌘/Ctrl/middle-click expands inline (kept for power users, expand-all, and keyboard nav).
- A **stream ↔ talk** view lens (in the scope bar) toggles the river between the full telemetry stream and a conversation-only view — `talkMode` in `ui-store`; the stream filters to chat-classified events via `classifyChatEvent`.
- Removed the now-orphaned chat-feed panel components and the unused `chatPanel*` store state. `chat-feed/chat-markdown.tsx` is kept — it's still used by the event-stream viewers (compaction boundary, thinking block, read-tool viewer).

### Docker reachability + idle shutdown

- The server defaulted to binding `localhost` inside the container, so Docker's published port returned `ERR_EMPTY_RESPONSE`. `docker-compose.yml` now sets `AGENTS_OBSERVE_SERVER_HOST=0.0.0.0` (override-able) so the published port reaches the server.
- Added an `AGENTS_OBSERVE_SHUTDOWN_DELAY_MS` passthrough (default 30s; set to `0` to disable the idle auto-shutdown while iterating on the dashboard).

## 25.05.2026

Ported eight feature groups from upstream (`simple10/agents-observe`, through `v0.9.8`) that stand on their own without the agent-class registry refactor the fork deliberately skips. Headline additions: transcript-based per-prompt token/cost stats, a DB-backed user-defined regex filter system (RE2), event deduplication at ingestion, and session-view keyboard navigation. The recurring adaptation throughout was translating upstream's three-layer event shape (`event.hookName` + opaque `payload`) onto the fork's native-OTel model (`event.subtype` / `event.toolName` / `event.toolUseId`). Also fixed a latent client build break the branch had been carrying.

### Transcript token stats

On-demand per-prompt, per-model token + cost breakdowns parsed from `~/.claude/projects` JSONL transcripts, surfaced in the session Stats tab. From upstream's transcript-token-stats + subagent-dir-scan work.

- New `app/server/src/transcript-parser/` — JSONL parser deduping by `message.id`, walking `parentUuid` chains for per-prompt attribution, with subagent discovery via filesystem scan and session-wide tool stats. **Codex transcript support was intentionally dropped** (removed the codex parser, its dispatch branch, and the codex bind-mount base) per project scope.
- Pricing comes from models.dev (`models-pricing.ts`), cached on disk under a new `config.dataDir` (defaults to the DB directory) with a 24h TTL and stale-cache fallback, so a fresh server start serves pricing without a network round-trip.
- New `GET /api/sessions/:id/transcript-stats` route with disabled / no-transcript / not-found / too-large / unreadable / parse-error branches; `storage.getSessionTranscriptPath`; and `services/transcript-path.ts` that translates the host-side `transcript_path` stored in the DB to the in-container path.
- Stats tab restructured into collapsible Overview / Tools / Token Usage sections (`settings/sections/*`: collapsible-section, model-badge, sortable-table, token-usage-section). Falls back to event-derived stats when transcripts are unavailable.
- Docker: `~/.claude/projects` is bind-mounted read-only into the container (`docker-compose.yml`), wired via `AGENTS_OBSERVE_TRANSCRIPT_CLAUDE_{HOST,CONTAINER}_BASE`. Enabled by default; `AGENTS_OBSERVE_TRANSCRIPT_STATS=0` disables. The transcript-stats route lazy-imports the parser so the server (and test harness) doesn't load the models.dev graph until the endpoint is hit.

### Unified filters

Replaced the static `config/filters.ts` filter set with DB-backed, user-defined regex filters (the largest single port — ~75 upstream commits).

- Filters are stored server-side (`filters` table), seeded with defaults (including a `default-all` exclusion filter), served over REST (`/api/filters` CRUD + duplicate + defaults/reset) and pushed live over WS (`filter:created|updated|deleted|bulk-changed`). Regexes are backed by RE2 (`re2js`) for linear-time, ReDoS-safe matching; the server validates patterns on create.
- New client `lib/filters/` (pure: `compile`, `matcher`, `all-filter`, `types`), `filter-store` + `filter-draft-store`, and a full **Filters tab** in Settings with a live-preview editor, per-filter color, primary/secondary display, negate / case-insensitive flags, and pill-name templating.
- **Architecture note:** upstream computes per-event filter matches inside its agent-class `processEvent`. The fork has no such registry, so `event.filters` (`{ primary, secondary }`) and `event.displayEventStream` are computed in `use-deduped-events.ts` instead — each deduped row is matched against the compiled filter set, mapping the native event onto the matcher's `{ hookName: subtype, payload }` shape. The event-filter-bar derives its pills from those tagged events; the event stream filters by the All-filter gate plus the active-pill union.
- `ui-store` filter selections renamed `activeStaticFilters`/`activeToolFilters` → `activePrimaryFilters`/`activeSecondaryFilters`.

### Event deduplication

Native OTel can re-deliver the same span (exporter retries, duplicate exporters); duplicates are now collapsed at ingestion.

- New `utils/event-signature.ts` hashes a canonical (sorted-key) view of the event's identifying fields (`session_id`, `subtype`, `tool_name`, `tool_use_id`, `instance_id`, `cwd`, raw payload) plus a 5-second timestamp bucket. Identical events within the bucket collapse; >5s apart they're treated as distinct.
- `events` gains a `signature_hash` column with a UNIQUE index (existing rows stay NULL — SQLite treats NULLs as distinct). `POST /events` does a pre-check and skips the whole pipeline on a re-delivery, with a race handler that catches the UNIQUE-constraint violation on concurrent inserts and returns the winner's id.

### Session-view keyboard navigation

Region-jump shortcuts with no architectural coupling (DOM-attribute driven): `s` / `/` focus search, `a` opens the agents picker, `f` jumps to the filter pills, `b` focuses the sidebar, `e` focuses the event stream. Arrow keys navigate siblings within sidebar rows and filter pills; window scroll shortcuts route to the event-stream pane. New `lib/keyboard-nav.ts` + `hooks/use-region-shortcuts.ts`, focus-visible rings on keyboard-reachable controls, and a **Keyboard** tab in Settings listing the bindings.

### Other ports

- **Worktree project detection** — a session whose cwd is a `.?worktrees?` checkout now joins its parent repo's project (match-only) instead of spawning a sibling project. `findExistingWorktreeProjectSlug` in the project resolver.
- **Raw-log modal search** — incremental search across the raw event logs using the CSS Custom Highlight API, with match navigation and a jump-from-log-row-to-the-event-in-the-stream link.
- **AskUserQuestion rendering** — the event detail pane renders AskUserQuestion tool calls with the question, option cards (selected option outlined in green), and the answer (custom/"Other" answers visually distinguished). Answers are read from the paired PostToolUse event via the thread.
- **Configurable notification events** — `AGENTS_OBSERVE_NOTIFICATION_ON_EVENTS` (comma-separated subtypes, default `Notification`) extends which event subtypes raise a sidebar/desktop notification, e.g. `Notification,Stop,SubagentStop`.

### Fixes

- Fixed a latent client build break the branch had been shipping: `session-list.tsx` used `Badge` without importing it (the import had been wrongly dropped as "unused"), and `agent-label.tsx` compared a non-existent `agentClass` field. Both surfaced only under `tsc -b` (the real build), not `tsc --noEmit`.

### Skipped / deferred

- **Icon registry** (upstream `8cbca69`/`9191e24`/`6b73a69`) — skipped. The fork already has the equivalent (`lib/dynamic-icon.tsx` for any-lucide-icon resolution, `hooks/use-icon-customizations.ts` with localStorage migration + color presets, customization-first resolution in `config/event-icons.ts`). Upstream's version only adds per-agent-class layer isolation, moot for the single-class fork.
- **Paired-event runtime pill** — deferred; depends on upstream's `turnId` / agent-class registry the fork doesn't have.
- The **three-layer contract refactor**, hook-library rewrites, and Codex support remain intentionally out of scope.

## 29.04.2026

Two fixes that block the dashboard's session-management workflow.

### Fixes

- **Bulk session delete crashed with `FOREIGN KEY constraint failed`** — `deleteSessions()` (the path used by the Sessions-tab "delete selected" button) wiped events → agents → sessions but skipped `instances`. Single-session `deleteSession()` cleaned instances first; the bulk version didn't. Any session whose openclaude REPL had ever heartbeated (i.e. any active session) had an `instances` row pointing at it, and `instances.session_id REFERENCES sessions.id` is enforced — so `DELETE FROM sessions` violated the FK and the whole transaction rolled back. Surfaced as 500 Internal Server Error in the dashboard. Fix: mirror `deleteSession()`'s order — `instances → events → agents → sessions`.
- **Client `tsc -b` build broken — three TypeScript errors** —
  - `session-list.tsx` used `<Badge>` at lines 131,133 without importing it. Added `import { Badge } from '@/components/ui/badge'`.
  - `agent-label.tsx:75` referenced `agent.agentClass` but the `Agent` interface in `types/index.ts` only declares `agentType`. Removed the extra comparison line — `agentType` already covers display-relevant identity.
  - `api-client.test.ts:568` cast a partial mock as `Response`, which TS rejected (missing 14 properties, casts must overlap). Switched to the standard `as unknown as Response` escape used for test-only mocks.

  `tsc -b && vite build` now passes; `docker compose build observe` succeeds end-to-end.

## 28.04.2026

Security hardening — adversarial bug-hunter pass across the full codebase. 20 fixes covering SQLite migration safety, transaction atomicity, DoS prevention, input validation, and error handling.

### Test expansion — 17 new test files, all server routes covered

Full audit of all 26 existing test files for freshness (no stale tests found; 12 files flagged with significant coverage gaps). Added 408 tests across 17 files bringing the suite from 26→43 files and ~553→961 passing tests.

**Server (8 new files, 162 tests):** All 10 route files now tested — sessions (9 endpoints including events status correction, context computation, metadata patching), projects (CRUD with slug validation), events (POST ingestion with session lifecycle, GET thread), health, instances, changelog. Plus unit tests for `apiError` helper and `rateLimit` middleware (window expiry, per-IP counters).

**Client (9 new files, 246 tests):** Core lib coverage — `api-client` (every method with fetch mocking, error parsing, URL encoding), `format-utils` (`formatTokens`), `format-bytes`, `server-health` (memoization), `scroll-sync` (lock coordination), `utils` (`cn()` class merging, `isNewerVersion()` date-based/semver dual mode). Config coverage — `event-icons` (registry integrity, 47 required IDs, color presets, custom overrides, MCP collapsing), `time-ranges` (all 6 ranges with ms/ticks), `activity` (pulse config).

**Fixes:** Server vitest binary (broken `.bin/vitest` symlink), client test setup (added `offsetWidth` mock for `@tanstack/react-virtual` in jsdom), `app.test.ts` flaky timeout 5s→10s. 7 pre-existing event-stream virtualizer failures remain (known jsdom limitation, component works correctly in real browsers).

### Critical

- **Sessions table migration crash** — the `INSERT INTO sessions_new SELECT * FROM sessions` at `sqlite-adapter.ts:138` referenced 20 columns in the new table but the original `CREATE TABLE sessions` only has 14 (token columns are added later via `ALTER TABLE`). Any database created before the nullable `project_id` change would crash on startup with "20 columns but 14 values were supplied." Fixed by explicitly listing the 14 source columns in both `CREATE TABLE sessions_new` and the `INSERT ... SELECT`, with a post-migration row-count safety check

### High

- **Atomic transactions**: `deleteProject`, `deleteSession`, `insertEvent` counter updates, `repairOrphans`, and `clearSessionEvents` now use `this.db.transaction()` wrappers — prevents mid-operation crashes from leaving orphaned rows or desynchronized session counters
- **Unbounded slug suffix loop** (DoS): `pickAvailableSlug` now caps suffix at 1000, falling back to a timestamp-based unique slug. Attacker could previously pre-create 50k projects to force 50k DB queries per event
- **CORS hardened** to localhost origins only — previously `cors()` with no config allowed cross-origin DELETE from any website
- **Rate limiting** via new `middleware/rate-limit.ts`: 1000 requests per minute per IP, applied to `POST /api/events`. Stale entries swept every 5 minutes
- **Request body size limit**: 10 MB cap, returns 413 before parsing. Prevents memory exhaustion from multi-GB JSON payloads
- **WebSocket connection limit**: 100 max concurrent clients. Prevents `broadcastToAll` O(n) degradation from connection floods
- **Instance data validation**: `instanceId` capped at 256 chars, `instanceRole` checked against expected values

### Medium

- **Graceful shutdown**: added `SqliteAdapter.close()` and `SIGINT`/`SIGTERM` handlers that close the database before exit — prevents WAL data loss on unclean shutdown
- **VACUUM safety**: `admin.ts` bulk-delete wraps `store.vacuum()` in try/catch with `SQLITE_BUSY` retry
- **State-changing GET**: `GET /api/sessions/:id/events` lazy status correction documented — intentional design, no longer a silent mutation
- **NaN in SQL queries**: 6 `parseInt` sites on user-supplied params/routes now guard with `isNaN()` and return 400
- **Context computation limit**: `GET /api/sessions/:id/context` caps events at 10,000 — prevents memory exhaustion on large sessions
- **Subagent naming queue**: async interleaving fixed by capturing pending metadata synchronously before the `await store.upsertAgent()` call
- **NaN timestamp passthrough**: parser now rejects NaN timestamps, defaults to `Date.now()`. Previously stored NaN in the DB, causing client-side garbage display

### Low

- Client timestamp display: `formatFullDate`, `formatRuntime`, `formatTime` all guard against NaN/Infinity with `'—'` fallback
- LIKE wildcard escaping: `%` and `_` in search terms now escaped with `\` via `ESCAPE '\'` clause
- WebSocket error logging: replaced empty `catch {}` with conditional `console.warn` when verbose
- Slug length validation: 100 char max on `POST /projects`, 256 char truncation in parser
- Consumer ID validation: type check (`typeof === 'string'`) and length cap (256 chars)
- Content-Type validation: all POST/PATCH routes check for `application/json`, return 415 on mismatch
- URI decode safety: `decodeURIComponent` wrapped in try/catch on all route params

## 27.04.2026

Completed selective cherry-pick from upstream (`simple10/agents-observe`, HEAD `38bdce6`) — 30 standalone improvements across bug fixes, performance, UX, and server enhancements, plus 4 full feature groups. Deferred the upstream three-layer contract refactor (Phases 1–8) 6–12 months until its agent-class extension model stabilizes and OpenClaude Observe has concrete agent classes to register.

### Database Prune UI — Sessions · Projects · Labels tabs

- Settings modal widened to 720px with tab persistence to localStorage. Five tabs: Display, Icons, Projects, Labels, Sessions. DB-size footer showing runtime (Docker/Local), dbPath, and formatted byte count via `GET /api/db/stats`
- **Sessions tab**: sortable table (project, cwd, events, age, status), filterable by minimum event count and maximum age, bulk-delete with VACUUM, bulk label assignment dialog, inline label pills, per-session project-modal, select-all with indeterminate state
- **Projects tab**: sortable table (name, sessions, events, created, activity), per-project create dialog with slug derivation, per-project delete confirmation, nuclear delete-all
- **Labels tab**: cross-tab label management integrated as a Settings tab alongside Display/Icons
- New server endpoints: `GET /api/db/stats`, `POST /api/sessions/bulk-delete`, `POST /api/projects`, `DELETE /api/data`
- Sidebar: Projects | Labels tab strip reuses existing label data — no model changes

### Keyboard shortcuts — region-based navigation

- Region-jump keys: `e` = event stream, `/` = search, `a` = agent filter, `b` = sidebar
- Arrow-key navigation between sidebar session items, project buttons, pinned sessions
- Arrow-key navigation between filter pills (static + dynamic rows)
- Window-level scroll shortcuts when event stream is active (ArrowUp/Down, PageUp/Down, Home/End)
- Keyboard shortcut reference tab in Settings
- New files: `lib/keyboard-nav.ts`, `hooks/use-region-shortcuts.ts`, `components/settings/keyboard-settings.tsx` with tests

### Event icon registry

- Centralized `EVENT_ICON_REGISTRY` with 19 color presets, per-event icons, and default colors — covers all 22 OpenClaude OTel event types, all known tool types, and per-phase tool coloring (PreToolUse/PostToolUse/PostToolUseFailure can have distinct colors)
- `resolveEventIcon`/`resolveEventColor` with 3-tier fallback chain: exact match → MCP collapsed → generic phase match → default
- Adapts `config/event-icons.ts` to delegate to the registry while preserving the existing `getEventIcon`/`getEventColor` API — all 7 call sites unchanged
- Pass 2 localStorage migration: remaps old icon-customization keys to registry IDs, purges obsolete transcript-format keys. Idempotent — won't double-migrate
- Skipped the agent-class layer-isolation parts (`6b73a69`) — our ParsedEvent model stays intact

### Configurable notification events

- New env var `AGENTS_OBSERVE_NOTIFICATION_ON_EVENTS` — comma-separated list of subtypes that trigger notification bells. Default: `'Notification'` (backwards compatible). Supports extending to `'Notification,Stop,SubagentStop'` to get notified when agents finish. Empty string disables all triggers
- Replaces hardcoded `subtype === 'Notification'` checks in notification tracking (`last_notification_ts`) and WS broadcast with config-driven Set membership

### Performance — fetch deduping & rendering

- Single `/api/health` fetch shared across all consumers (was N per page)
- Deduplicated notifications fetch + suppressed HomePage flash on stale-while-revalidate
- Deduplicated `/api/sessions/:id` fetches into one cache key
- Dropped `refetchInterval` polling on session/project queries — WS invalidation already covers this
- Fixed API call regressions: lazy-fetch storm + cache thrash on session switch
- `React.memo` DotContainer with content-aware equality
- Split agent lane into absolute siblings + shared tooltip per lane
- `useAgents` side-effect fetch moved out of `useMemo` (React-correctness fix)

### Server enhancements

- `GET /api/sessions/unassigned` — returns sessions where `project_id IS NULL`. Allows `project_id` to be nullable with migration. New `useUnassignedSessions` hook. Sidebar UI bucket deferred
- `GET /sessions/:id/events?fields=` allow-list — opt-in bandwidth saver
- `createdAt` dropped from WS broadcast, marked optional (partial port of `ac24a1a`)
- Events response typed inline, `??` for `createdAt` fallback

### UX features

- Event runtime display: Stop/SubagentStop events show elapsed time (paired with preceding LLMGeneration/SubagentStart). Runtime pill on row summary, Runtime detail row in detail pane. New `lib/runtime.ts`
- Shared timestamp tooltip: single Radix Tooltip instance across all event rows with stable callbacks for React.memo compatibility. Uses `timeago.js` for relative time. New `components/event-stream/timestamp-tooltip.tsx`
- Tab spacing/text size restored to defaults (`h-9`/`text-sm`), with sidebar tabs keeping compact override
- Transition spinner on rewind-mode range changes
- Broadcast activity pings for sidebar pulse animation via WS
- Inline image render for MCP `tool_response` (base64 redaction on oversized images)
- Keep last-expanded row in view on filter/search change
- Nested-button warning fixed in sidebar project row

### Bug fixes

- Guard timeline-rewind and parser against poisoned timestamps
- Tooltips re-opening on tab reactivation
- Errors + Config static filters (category mapping fix)
- Session Stats memory leak (events array retained after exit)

### Deliberately skipped

- **Three-layer contract refactor** (Phases 1–8, ~70 commits): fundamentally conflicts with our native OTel integration — `validateEnvelope()` rejects the shape `ClaudeObserveExporter` POSTs, the agent-class registry deletes `chat-feed/` and `compaction-boundary.tsx`, and the `instances` table has no upstream schema migration. Deferred 6–12 months
- `89fd45a`/`8fa2749` backfill `start_cwd` — no `start_cwd` column in our schema (project resolution uses `projects.cwd`)
- `133b465` PreCompact/PostCompact pairing — already implemented via `compaction-boundary.tsx`
- `35f4fb7` UserPromptExpansion rendering — OpenClaude doesn't emit this event
- `8efa058` shared EventStore context — agent-class registry dependency
- All `hooks/scripts/lib/` commits — this fork has no hook scripts

## 20.04.2026

Deep-cleaned the fork of upstream remnants and post-plugin dead code, then systematically merged 19 commits from upstream (`simple10/agents-observe`) that worked without the agent-class registry refactor we chose to skip.

### Repo cleanup

- Deleted the `test/fresh-install/` harness (and `scripts/test-fresh-install.sh`) — tested the Claude Code plugin / MCP-spawn → `startServer()` → event-capture flow that was removed when the fork switched to native OpenClaude OTel ingest in commit `8792a8f` (14.04.2026). The entire harness dockerd-in-dind + `claude --plugin-dir /plugin --mcp-config /plugin/.mcp.json` path tested infrastructure that no longer exists
- Rewrote `start.mjs` as a self-contained launcher (77 lines vs. 106). The old version imported `getConfig`, `getServerEnv`, `getClientEnv`, `initLocalDataDirs` from `./hooks/scripts/lib/config.mjs` and `saveServerPortFile`, `removeServerPortFile` from `./hooks/scripts/lib/fs.mjs` — both paths deleted in `492a000`, so `npm run start` and `just dev` were both broken. New launcher reads env directly, spawns `npm run dev` for server + client in dev mode or `npx tsx src/index.ts` in local mode, with clean SIGINT/SIGTERM propagation
- Rewrote `justfile` — 9 recipes were routing through `node {{ project_root }}/hooks/scripts/observe_cli.mjs` (deleted): `start`, `stop`, `restart`, `logs`, `db-reset`, `health`, `cli`, `test-event`. Replaced with `docker compose up -d` / `down` / `restart openclaude-observe` for the container lifecycle, `curl http://localhost:{{ port }}/api/health` for `health`, `rm -f data/observe.db` for `db-reset`. Dropped `cli` and `test-event` entirely. Image tag fixed from `agents-observe:local` to `openclaude-observe:local` so it matches the release script
- Rewrote `.env.example` against the env-var contract in `app/server/src/config.ts` — dropped 8 variables the server no longer reads (`AGENTS_OBSERVE_LOCAL_DATA_ROOT`, `_LOGS_DIR`, `_API_BASE_URL`, `_DOCKER_CONTAINER_NAME`, `_DOCKER_IMAGE`, `_PROJECT_SLUG`, `_PROJECT_NAME`, implicit `CLAUDE_PLUGIN_DATA` fallback). File is now the actual env surface (9 vars: 4 server, 1 dev-only, 1 DB, 2 compose-only, 1 optional storage adapter)
- Fixed `AGENTS.md` (CLAUDE.md symlink) — clone URL was `simple10/agents-observe.git`, now `coffeegrind123/openclaude-observe.git`; central-env-var claim pointed at the deleted `hooks/scripts/lib/config.mjs`, now correctly at `app/server/src/config.ts`
- Regenerated `docs/DEVELOPMENT.md` command table against the new justfile and added `AGENTS_OBSERVE_STORAGE_ADAPTER` / `AGENTS_OBSERVE_DATA_DIR` to the env-var reference. Dropped the advertised-but-broken `just start/stop/restart`
- Trimmed README "Related projects" to what's actually related going forward (OpenClaude + agent-chat for split-view inspiration). Moved upstream lineage to a compact "Acknowledgements" paragraph since the fork has diverged enough that listing upstream as peer is misleading
- Removed `TASKS.md` (vestigial completed-tasks list), dropped the `"claude plugin"` comment from `docker-compose.yml`, renamed `agents-observe` → `openclaude-observe` in the Claude prompt inside `scripts/generate-changelog.sh`, updated `.claude/settings.json` `AGENTS_OBSERVE_PROJECT_SLUG` from `agents-observe` to `openclaude-observe`

### Upstream ports

Merged from `simple10/agents-observe` (19 commits, integration branch `merge-upstream-2026-04-19` fast-forwarded into `main`). Upstream's agent-class registry refactor (22+ commits, ~1574 lines of new `app/client/src/agents/**` scaffolding with an 886-line `event-detail.tsx` rewrite) was audited and deliberately skipped — it lacks our specialized tool viewers, compaction viz, mermaid, extended thinking, context attribution, and recovery-reason labeling. Re-integrating those into upstream's `claude-code` agent module is a multi-hour job deferred to a dedicated session. These are the parts that stood on their own:

- Added theme picker with system-preference option — the existing dark/light toggle is joined by a three-button picker (Light / Dark / System) in Settings → Display. System mode tracks `prefers-color-scheme` via `matchMedia` and flips on OS-level changes without reload. Persists to localStorage under `app-theme`. Backwards-compat `useTheme()` export keeps the sidebar moon/sun toggle working. Adapted from upstream `fcb93d4` (our display-tab, not their general-settings)
- Added browser back/forward navigation for session switches — `updateHash` now uses `pushState` instead of `replaceState`, so every project/session change goes on the history stack. During hashchange handling (back/forward), `pushState` is suppressed via a module-level `suppressHashPush` flag so navigating backwards doesn't wipe the forward stack. Direct URL loads (e.g. `#/project/session`) seed history by replacing to `#/project` then pushing `#/project/session`, giving Back somewhere to go. From upstream `1976b6d` + `44d98b7` + `ae04fd2`
- Added click-to-copy session name in the breadcrumb — replaces the separate transcript-copy icon that hovered at the right end. Clicking the session name copies the transcript path with a Copied! flash; the cwd tail uses the same `CopyButton` component. From `eec6da0`
- Added double-click session name to inline-rename in the sidebar — bypasses `onEdit` modal override so the input appears right in place. `stopPropagation` keeps double-click from re-firing session select on the parent row. From `5ea9ba3`
- Timeline perf + memory-leak fix for rewind mode:
  - Swapped Live/Rewind button colors so Live is green and Rewind is amber (was the reverse). From `9f8d2d4`
  - Rewind mode now reads from `frozenEvents` exclusively instead of the live event stream — stops a memory leak where new events piled into the rewind view indefinitely. From `b5a3ba9`
  - Memoized `TimelineRewind` and froze the `agents` snapshot on rewind entry (new `frozenAgentsRef`) so the rewind UI doesn't re-render on every live agent update. From `cf5e220`, adapted for our divergent imports
  - GPU-animated transition spinner on Live/Rewind button via direct DOM manipulation (ref-based `style.visibility` toggle + `setTimeout` to let the browser paint the spinner before the main thread locks mounting `TimelineRewind`). Bypasses React scheduling so the spinner actually shows during the expensive mount. From `6fdcfbd`
- Re-scroll to bottom when the tab becomes visible again if autoFollow is on — browsers throttle `requestAnimationFrame` in backgrounded tabs, so the virtualizer can end up scrolled short of the end when events arrive during the pause. `visibilitychange` listener re-issues `virtualizer.scrollToIndex(last, { align: 'end' })` when the tab comes back. From `cf19cbc`
- Remount `EventStream` on session switch via `<EventStream key={selectedSessionId} />` — the single load-bearing fix from upstream's 11-commit scroll-reliability series. Remounting drops the virtualizer state + scroll position cleanly every time the session changes, so the initial-scroll effect fires against a fresh DOM and none of the timing hacks (double rAF, `setTimeout(0)`, session-match guards) they churned through are needed. Our reverseFeed-aware initial-scroll logic stays. From `4ef6d4f`, simplified
- Added `overflow-hidden` to the timeline container so dots near the time boundary don't visually bleed into the event stream below. From `2eaa9f2`
- Server: resolve projects by cwd with a fallback to transcript path — `project-resolver.ts` now prefers `getProjectByCwd(cwd)` over `getProjectByTranscriptPath(dir)`. Lets a reopened project reuse its existing record regardless of how the agent stores transcripts (Claude Code encodes cwd in the transcript dir name; Codex organizes by date). On `SessionStart`, lazily re-resolves any session whose project was previously derived without a cwd — promotes Codex sessions off the date-slug project once the real cwd is learned. Slug matches also opportunistically backfill `cwd` on pre-existing projects. For sessions that never supply cwd, the transcript-path fallback now detects trailing `/YYYY/MM/DD` and emits `YYYY-MM-DD` instead of the bare day-of-month `17`, so Codex's worst-case slug is at least useful. Adds `projects.cwd TEXT` column + index via migration. From `1508e0d`
- Added sidebar notification indicator with auto-clear, auto-dismiss, and animated favicon — surfaces sessions that have emitted a `Notification` hook event and are waiting on user input:
  - Session: status-dot / pin slot swaps to a pulsing amber bell; click dismisses locally
  - Project (expanded): folder icon swaps to a bell only when at least one flagged session isn't already visible in the sidebar (respects Pinned list and "show more" collapsed groups). `SessionItem` announces/unannounces its bell into the store via a `useEffect` so the project indicator stays accurate live
  - Project (collapsed sidebar): small pulsing amber dot on the square icon; click dismisses every flagged session in the project
  - Tab favicon: swaps to an animated bell (animated SVG via SMIL, fallback static bell on Safari) whenever any session is flagged
  - Server: `sessions.last_notification_ts` column with migration + backfill. Paired with existing `last_activity`, a session is "pending" iff `last_activity = last_notification_ts`. New `GET /api/notifications?since=<ts>` returns pending sessions; ingest fans out WS `notification` / `notification_clear` via `broadcastToAll` so the sidebar lights up regardless of which session the user is on
  - Client: Zustand notification store with pending Map + dismissed Set + `lastSeen` cursor + visible-bell Set. `useNotificationsController` (mounted in `App.tsx`) fetches on mount and on feature toggle, wires up auto-dismiss + favicon swap. Active-session auto-dismiss: navigating to a flagged session dismisses immediately; new notifications arriving while viewing auto-dismiss after 5s, gated on `document.visibilityState` so backgrounded tabs don't miss the alert. Dismissed GC'd on every fetch + every `notification_clear` WS message so the set stays bounded
  - Settings → Display → "Show notification alerts" toggle, persisted to localStorage, default on. When off all hooks short-circuit
  - Adapted from `9d0d431` — dropped the `AgentClassIcon` tooltip import in `session-item.tsx` (lives in the registry we didn't port) and put the toggle in our `display-tab.tsx` instead of upstream's `general-settings.tsx`
- Extended the notification indicator to the main-panel session list (Home / Project recent-sessions views) — status dot swaps to a clickable `NotificationIndicator` that dismisses locally. Row rendering extracted into a `SessionRow` subcomponent so `useSessionHasNotification` can be called at row scope. From `d5ccf09`
- Added session labels for cross-project bookmarking — user-defined labels (localStorage-only) act like bookmarks across projects. A session can belong to many labels; a label can hold many sessions. Interaction is modal-only in this first pass:
  - Session modal: new Labels tab with toggleable pills + add-label input. Each pill has a jump icon that opens the Labels modal scrolled to that label
  - Labels modal: opened via a Labels pill beside the sidebar's Projects header. Supports grouping by label or by cwd, searching across label names, session names, cwd, and transcript path, and renaming/deleting labels inline. Session rows expose a Details pill that opens the session modal to the Details tab
  - Session modal: moved Move / Clear / Delete actions into the Details tab only (previously shared across all tabs)
  - Server: include `transcriptPath` on `/api/sessions/recent` so search can match it
  - Persisted in localStorage under `agents-observe-labels` and `agents-observe-label-memberships`. From `778e22b`
- Bash tool summary now prefixes the detected binary — e.g. `[npm] npm test`, `[docker] docker compose up`. Skips env-var assignments, `cd` prefixes, subshells (`$(...)`, backticks), shell keywords (`for`, `do`, `done`, `if`, `then`, `else`, `fi`, `while`, `case`, `esac`), and validates the extracted token against a binary-name regex (`^[a-zA-Z0-9][a-zA-Z0-9._-]*$`) to reject shell garbage. Makes scanning Bash rows faster — you see the *what* (npm, docker, gh) before the *how* (the full command). Ported `extractBashBinary()` from upstream `2906893` + `d7c7e51` directly into `lib/event-summary.ts` since the registry's version lives in `app/client/src/agents/claude-code/helpers.ts`
- MCP tool calls get a distinct Plug icon and cyan color — anything named `mcp__*` resolves to a shared `_MCP` icon/color key that's customizable from Settings → Icons like any other event type. Individual MCP tool names can still override. Event row shows an `MCP` label in cyan with the full `mcp__*` tool name rendered in muted text next to it, so the protocol is obvious at a glance without losing which MCP tool it was. From `d108bdd` + `f49bcd3` + `a7eb163`
- Status icon (check / x / loader) now renders on any event carrying a `pending` / `running` / `completed` / `failed` status, not only tool events. Matches what the dedupe pipeline already labels non-tool events with. From `6323f4d`
- Close icon/color pickers before applying the customization — the `iconCustomizationVersion` bump triggers a re-render storm that was blocking the popover's close animation and making the picker feel frozen. Now clicks capture the selection, close the popover, and defer `onSelect()` to the next `requestAnimationFrame` so the browser paints the closed state first. From `27896e3`

### Deliberately skipped (from the 79 upstream commits since `185d7bc`)

- **Agent-class registry** (22+ commits): `1a04ff0`, `c83c359`, `e839811`, `2ab65cd`, `0ab4828`, `fbb88ce`, `f4ad298`, `1a5df65`, `2ded19b`, `c48d60a`, `8efa058`, `1f88d01`, `684f398`, `6743fad` and follow-ups — the big architectural refactor. Event rendering becomes a registry of agent-class modules (`claude-code`, `codex`, `default`) with per-class `processEvent`, `RowSummary`, `EventDetail`, `DotTooltip`, and icon maps. Good design, matches our Codex/OpenClaude/pi-code roadmap. But upstream's `claude-code/event-detail.tsx` lacks all our fork-specific detail work and reintegrating those (specialized tool viewers, compaction viz with PTL recovery labeling, mermaid, extended thinking, per-turn context attribution, expandable compaction custom-instructions / recovery-reason) is a dedicated work session
- **Dedup settings refactor** (8 commits): `b7e3952`, `f655aac`, `8a46d3e`, `8378764`, `03e7aaa`, `d547cba`, `03ab46b` — toggles raw-vs-deduped event rendering via the registry's `processEvent`. Depends on `event-processing-context.tsx` which lives in the registry
- **Hooks-layer commits**: `570fd45` (feat!: agent-scoped `getSessionInfo` callback, **breaking**), `20d7136` (mirror agentClass + cwd through `getSessionInfo`), `e4df4d8` (reorder auto slug to `<branch>:<uuidPrefix>:<agentShortName>`), `0b89a59` (`AGENTS_OBSERVE_AGENT_CLASS` env in cli), `3aa3789` + `86b27c5` (`scripts/check-hooks.ts` improvements) — all touch `hooks/scripts/lib/agents/*` or `hooks/scripts/lib/callbacks.mjs` which this fork deleted when it switched to OpenClaude's native OTel integration
- **Codex hook configs** (`8bdfe17`): `.codex/config.toml` + `.codex/hooks.json` — useless until the Codex agent module exists in the registry, and the registry isn't ported
- **Read/Edit detail improvements** (`653ee86`): already covered by our specialized tool viewers + `pairedPayloads` plumbing (viewers read `tool_response` from the paired `PostToolUse` payload directly, which is what upstream added)
- **`3de9039` Update TASKS.md**: we deleted TASKS.md in the cleanup. Nothing to merge

### UI polish (post-release)

- Render the empty state on Home and Project pages — `home-page.tsx` and `project-page.tsx` were gating `<SessionList>` on `sorted.length > 0`, so a brand-new install with no sessions yet showed a blank panel instead of `SessionList`'s existing "No sessions yet · Sessions will appear here as agents connect" empty state. Dropped the gate so the empty state actually renders
- Distinguish collapsed pinned sessions in the sidebar — every pin used to render as the same Pin glyph, so 5 pinned sessions looked like 5 identical buttons. Replaced with the slug's first 1–2 letters (uppercased, leading non-alphanum stripped so UUIDs still read), with an active-status green ring. Tooltip with the full slug stays
- Replaced cryptic event labels with words — `Daemon↑/↓`, `Pipe↔/✕`, `Bridge↑/↓` are unfamiliar and screen readers announce the arrows literally. Replaced with `Start`/`Stop`/`Attach`/`Detach`/`Connect`/`Disconn`. The category icon (Server/Link/Globe) and color (orange/teal/cyan) already convey daemon-vs-pipe-vs-bridge, so the label can speak plainly. Also tightened `BridgeWork` → `BrgWork`, `Heartbeat` → `Beat` to fit the column
- Surfaced the hidden middle/ctrl-click selection on event rows — `event-row.tsx` quietly supported "click to expand · ctrl/cmd+click or middle-click to select" but with zero visual hint. Added a `title` attribute making it discoverable, and an `onAuxClick` handler so middle-click works in browsers that don't fire `click` for button 1
- Made resize handles discoverable — sidebar (`w-1` → `w-1.5`) and timeline (`h-1` → `h-1.5`) handles bumped from 4px to 6px, with a faint baseline color (`bg-border/40`) and `title="Drag to resize"`. Previously hover-only and 4px wide, almost no one would discover them
- Replaced `title=` with `Tooltip` components in ScopeBar — the auto-follow / expand-collapse / stats / edit icon row was using native browser tooltips while the rest of the app uses Radix tooltips. Now matches; also added `aria-label` on every icon button
- Separated the pin click target from the status indicator in `SessionItem` — the 12px status-dot slot was *also* the pin click target, with the pin overlaying the dot on hover via a clever opacity swap. Discoverable by accident at best. Status dot is now `pointer-events-none` (visual only); pin moved to its own dedicated button beside the pencil edit icon, always visible when pinned and hover-revealed otherwise
- Surfaced version warnings on the collapsed sidebar — when collapsed, the version chip in the footer (`vX.Y.Z (hash)`) disappears entirely, hiding any "outdated" or "server/client mismatch" warnings. Settings icon now shows a colored corner dot (red for mismatch, orange for outdated) so the warning is visible regardless of sidebar state
- Reduced `AgentCombobox` row density — dropped the always-visible start time from the right-side cluster (`runtime · count · copy` is enough). Start time available via row title tooltip
- Made the "/ N raw" filter delta clickable — when filters hide events, `EventStream` shows `Events: 12 / 487 raw` to indicate the gap. Now a button: clicking clears all four filter sources (static filters, tool filters, search query, agent selection) so the user can recover with one click

### Server cleanup (post-release)

- Removed the `parseRawEvent — transcript JSONL format` describe block from `parser.test.ts` (11 tests, 7 failing). The block exercised an upstream `simple10/agents-observe` data path — reading raw Claude Code transcript JSONL files with `type: 'assistant' | 'progress' | 'user'` envelopes carrying nested `message.content`, `data.hookEvent`, `data.agentId`, and `toolUseResult.agentId` payloads. That ingestion path was severed when commit `8792a8f` (14.04.2026) rebuilt the parser around OpenClaude's hook-event envelope. The 7 tests had been failing on every commit since. No production code touched — the parser only handles `hook_event_name` (current) and bare `type/subtype` (the four passing tests in the deleted block, which covered `type: 'system'` with `subtype: 'stop_hook_summary'` etc., are already exercised by the `hook format` describe block). Net: 27 hook-format tests still pass; -11 obsolete tests removed; +0 tests failing

### Docs and repo cleanup (post-release)

- Re-designed `README.md` (217 → 155 lines) — leads with the OpenClaude/OTel value prop in two sentences instead of the previous three-paragraph "why observability matters" preamble. New "What you see" section condenses the 12-bullet feature dump into 9 punchy lines. Architecture is a stack table + diagram instead of three prose paragraphs. Event coverage table now matches the actual 27 cases in `parser.ts` (`Pipes (IPC)` lists all six pipe events, `Coordinator` and `Bridge` get their own rows, etc.) instead of the lossy 6-row "Hooks / LLM / Daemon / Pipes / Coordinator / System" summary. Dropped the stale `test/fresh-install/` reference in project structure (the harness was deleted in the morning's release entry but the README still listed it) and the speculative roadmap (Codex / OpenClaw / pi-code support); kept acknowledgements (simple10/agents-observe, disler heritage, agent-chat split-view inspiration). Quick-start uses `docker compose up -d` so it backgrounds correctly
- Deleted the broken `.claude/skills` symlink — pointed at `../skills/` which was removed in the OTel refactor (`8792a8f` removed `skills/` along with `hooks/` and `.claude-plugin/`). The symlink had been dangling for a week
- Replaced `AGENTS.md`'s `/observe` slash command table with real `just` recipes — Skills section advertised seven `/observe start|stop|restart|logs|debug|status|` commands but those skills don't exist anymore (skills/ deleted). Troubleshooting suggested `/observe start` and `/observe debug` for "server not running" and "need diagnostics" — both broken. Now points at `just start` / `just logs` / `just health` / `just db-reset`
- Fixed `CONTRIBUTING.md` — Development section advertised `just dev-server` and `just dev-client` recipes that don't exist (only `just dev`). Now reflects the actual recipe and links to `docs/DEVELOPMENT.md` for detail
- Trimmed `.dockerignore` — opening header comment "Fresh install test harness — keep build context small and reproducible" referenced the deleted harness, plus 4 lines of `server-image.tar` / `*.tar` excludes for harness tarballs that no longer exist. Dropped the comment and excludes
- Moved `docs/plans/implemented/{plan,spec}-fresh-install-test-harness.md` to `docs/plans/archived/` — they describe a Claude Code plugin / `hooks/scripts/lib/{config,docker}.mjs` / `claude --plugin-dir /plugin` test harness whose entire substrate (`hooks/`, plugin manifest, MCP spawn paths) was deleted in the OTel refactor. The 20.04.2026 release entry already documented deleting the harness itself; the plan/spec docs that motivated it belonged in `archived/` from the same day, not `implemented/`

### Chat panel fix (post-release)

- Fixed missing intermediate LLM responses in the chat panel — the chat feed only emitted assistant bubbles from `Stop` / `stop_hook_summary` / `StopFailure` / `SubagentStop` events, reading `last_assistant_message`. Every mid-turn `LLMGeneration` carried its own `response_preview` (the text content of that LLM call) but `buildChatEntries` ignored it entirely, only stitching in `thinking_preview`. Result: during a long agent loop, the chat panel stayed silent until the final `Stop` fired — a single turn with 35 LLM calls rendered as zero assistant bubbles even though every call had substantive text like "Let me read X first…". `LLMGeneration` is now a chat subtype; each one with non-empty `response_preview` or `thinking_preview` becomes its own assistant bubble. When a `Stop` / `stop_hook_summary` / `StopFailure` fires on an agent that just emitted an `LLMGeneration`, the two merge: `last_assistant_message` (full, untruncated) upgrades the bubble's text (which was capped at 1000 chars by the sender), and `StopFailure` propagates `failed=true`. Falls back to a standalone Stop bubble when no preceding `LLMGeneration` exists on that agent. `UserPromptSubmit` resets the per-agent merge pointer so a new turn's Stop can't consume stale LLM bubbles from the prior turn. `SubagentStop` is intentionally unchanged — subagent LLM calls are attributed to the parent agentId upstream, so same-agent merging won't find a match, and keeping the standalone subagent-stop bubble preserves its distinct styling regardless of attribution
- Filtered the auto-compaction summarizer out of the chat panel — the previous fix exposed a second bleed: the compaction LLM call (which produces the `<analysis>…</analysis><summary>…</summary>` XML dump Claude Code uses to condense conversation history) is just another `LLMGeneration` event, so it rendered as a regular assistant bubble once LLMGenerations became chat-visible. `buildChatEntries` now tracks a per-agent `PreCompact` → `PostCompact` depth counter and drops any `LLMGeneration` emitted while depth > 0. The event panel still shows the full compaction cluster (grey Minimize icons for PreCompact/PostCompact, adjacent LLMGeneration with the analysis payload); only the chat panel hides it. `UserPromptSubmit` resets the counter defensively so a dropped `PostCompact` (crash, abort) doesn't leave the next turn's replies hidden forever

## 19.04.2026

- Added PTL-recovery labeling on the compaction boundary — paired with [openclaude@de65938](https://github.com/coffeegrind123/openclaude/commit/de65938) which fixes a sender-side labeling bug: OpenClaude's new reactive PTL recovery (peel oldest + partial-compact) and forced auto-compact (PTL fallback) both fired `executePreCompactHooks({ trigger: 'manual' })`, making both show up on the dashboard as "manual" compactions even though they're automatic context-window rescues. OpenClaude now threads a `recoveryReason` param through `partialCompactConversation` / `compactConversation` that populates the PreCompact hook's `custom_instructions` field *without* contaminating the summarizer LLM's prompt. Observe side detects these reason strings (prefix match on "Reactive PTL recovery", "Forced auto-compact", "Media-size recovery") and labels the expandable section "Recovery reason" instead of "Custom instructions" so the distinction is obvious at a glance. Reactive reason includes the peel pivot, total messages, token gap, and safety margin; forced reason notes the PTL fallback + threshold bypass
- Made compaction boundary reasoning viewable — the amber "Context compacted" card in the event stream previously showed `compact_summary` as a 2-line `line-clamp` preview with no way to see the full text, and `custom_instructions` (from `PreCompact`) weren't surfaced at all. Both now render as expandable sections: click the chevron to reveal a scrollable markdown-rendered pane (500px max-height) with char/line counts and a copy button. Closed state shows a single-line italic preview with `~Nt · Nl` metadata pills so you can see what's there at a glance
- Added extended-thinking display — Claude 4.x emits `type: 'thinking'` content blocks alongside regular `type: 'text'` responses (chain-of-thought reasoning). OpenClaude's observe export previously dropped these entirely from `responsePreview` and only exposed them via the heavyweight `OTEL_LOG_RAW_API_BODIES` opt-in. Paired with [openclaude@0620796](https://github.com/coffeegrind123/openclaude/commit/0620796) which now extracts thinking text into a dedicated `thinking_preview` OTel attribute (capped at 4kb). Dashboard renders:
  - In the expanded LLMGeneration row: a collapsible purple-bordered card with the 🧠 Brain icon, token estimate, pass count (multiple thinking blocks per turn are split by `---` and rendered as separate sections), and a copy button. Preview line shown when collapsed
  - In the chat feed: a small `🧠 thinking · ~420t` pill above each assistant/subagent-stop bubble. Clicking it reveals the thinking as a muted indented block inline so users can peek at reasoning without the feed becoming a wall of text. Correlated per-agent (subagent thinking doesn't leak into main-agent bubbles) by walking LLMGeneration events between each assistant boundary
- Fixed Context badge popover not opening on click — the `N.Nk ctx ▾` pill on LLMGeneration rows was a real `<button>` nested inside the event row's `<button>`, which is invalid HTML (browsers collapse nested interactive content and never fire the inner click). Rewrote the trigger as `<span role="button">` with keyboard handling, and portalled the popover body to `document.body` via `createPortal` so the expandable CategoryRow buttons inside it don't hit the same nested-button problem. Added Escape-to-dismiss and a trigger-aware outside-click handler
- Fixed chat pane still showing `<tick>` / `<system-reminder>` / `<local-command-stdout>` background prompts — the `32a1f6d` filter only covered the inline conversation thread inside expanded events (`dedupeThread` in `event-detail.tsx`), not the right-side chat feed (`buildChatEntries` in `chat-events.ts`). Chat feed now drops any event with `payload.kind === 'background'` (canonical tag from OpenClaude's `forwardHookToObserve`) and also detects the synthetic prefixes directly as a fallback for senders without the tagging logic

## 18.04.2026

- Clicking a chat message now scrolls the event panel to the matching row (and pulses it). Previously clicking a chat bubble only toggled `selectedEventId`, so you had to manually find the corresponding event in the panel — useless when the event was off-screen. The scroll infrastructure was already wired in `event-stream.tsx` (resolves the row through the merged ID map, scrolls the virtualizer, pulses `flashingEventId`); the chat side just wasn't calling `setScrollToEventId`. Skips the scroll on a deselect click so toggling off doesn't yank the event panel
- Show the upstream-reported model name in the event detail card, the LLMGeneration row label, and the event summary text — when OpenClaude tags a payload with `actual_model` (set when a proxy re-routes the request: z.ai `claude-sonnet-4-6` → `glm-4.6`, OpenRouter substitution, LiteLLM aliasing, etc.) the dashboard now displays what actually ran instead of the request name. Falls back to the request `model` when the proxy returned the same name. Sender-side commit: [openclaude@ead1061](https://github.com/coffeegrind123/openclaude/commit/ead1061)
- Filtered background-tagged hooks from the chat thread — `dedupeThread()` now skips events whose `payload.kind === 'background'`, paired with sender-side tagging in [openclaude@05b1621](https://github.com/coffeegrind123/openclaude/commit/05b1621) that marks `<tick>` / `<system-reminder>` / `<local-command-stdout>` synthetic prompts. Result: chat thread mirrors the REPL transcript instead of leaking proactive ticks, super-mode priming reminders, Esc-interrupt hints, and local-command stdout. Pure chat-view filter — telemetry views (event feed, latency, token counts) still receive every hook regardless of kind. Sub-agent `SubagentStart` / `SubagentStop` events stay visible (chat-thread analog of the REPL's running-agents tree)
- Added specialized tool viewers in expanded event detail — `Read` now shows syntax-highlighted file content with real file line numbers (honors Read's `offset`/`limit` and the `file.startLine` field from OpenClaude's response) and offers a Code/Preview toggle for `.md` files; `Edit` renders a theme-native LCS-based inline diff with per-line numbers and `+N −N` stats (replaces the generic `react-diff-viewer` card); `Write` shows the new-file content syntax-highlighted with a NEW FILE / OVERWRITE badge; `Bash` splits `stdout`/`stderr` into separate panels with exit-code coloring, shell-highlighted command line, duration, and cwd; `Grep` parses `path:line:content` output into clickable hit rows with match highlighting, `output_mode` badge, and a collapse-to-20 toggle. 30 languages bundled via `highlight.js` core (~50kb gz). Inspired by `matt1398/claude-devtools`
- Added Mermaid diagram rendering inside the Read tool viewer — any ` ```mermaid ` fence in a markdown file now renders as an SVG diagram when Preview mode is selected. `mermaid` is lazy-loaded on first use so the main bundle stays small (each diagram kind is its own chunk, ~10–150 kB gz)
- Added per-turn context attribution (7 categories) — every `LLMGeneration` row in the event stream now shows an inline `N.Nk ctx ▾` pill next to the model string. Clicking it opens a popover that breaks the input token budget into **claude-md** (from `InstructionsLoaded` events), **mentioned-file** (`@path` refs in the prompt, parsed with code-fence awareness), **tool-output** (`PostToolUse` result content), **thinking-text** (prior assistant output tokens), **team-coordination** (`SendMessage`/`TaskCreate`/`TaskUpdate`/`TaskList`/`TaskGet`/`TeamCreate`/`TeamDelete` calls), **user-message**, and **skills**. Each category has a colored bar, absolute token count, % of turn, and expandable source list. New endpoint `GET /api/sessions/:id/context` returns the full breakdown keyed by `llmEventId`; client caches the response in React Query so all badges on a session share one fetch. Token counts are estimates (chars/4 heuristic) alongside the authoritative `input_tokens` from the LLM call
- Added compaction boundary visualization — `PreCompact` and `PostCompact` events no longer render as regular event rows but as a distinct amber-bordered card that pairs the two and shows `before → after · −drop (N%)` by reading the flanking `LLMGeneration` `input_tokens` (OpenClaude's `PreCompact` payload carries trigger/instructions but no tokens, so the drop is derived from the surrounding LLM calls). Card also shows trigger icon (manual/auto), `compact_summary` when available, and a before/after proportion bar. Closes the amber stripe visually with a thin "Compaction complete" rule on the `PostCompact` row
- Added split event/chat view — the session pane now shows the existing event stream on the left and a new chat feed on the right, rendering the same OTel events as conversation bubbles (user prompts, assistant responses, subagent spawns/returns, task cards, teammate idle). Panel is resizable (280–800px), collapsible to a thin rail, and persists width/collapsed state to localStorage; shares the React Query cache so no extra network is used. Inspired by [DheerG/agent-chat](https://github.com/DheerG/agent-chat)
- Added markdown rendering in chat bubbles — user, assistant, and subagent-return messages now render headings, lists, bold/italic, inline and fenced code, blockquotes, tables, and links via `react-markdown`
- Added sticky-to-newest auto-follow — both the event stream and chat panels now engage auto-follow automatically when scrolled to the edge where newest events land (top in reverse-feed mode, bottom in chronological), and disengage as soon as you scroll away. You no longer have to keep scrolling up to keep up with live events, but breaking off to inspect history still parks the view where you left it
- Fixed fresh-DB startup crash — token-column backfill referenced the `events` table before it was created, so containers with an empty `/data` volume refused to start. Backfill now runs after all tables are in place
- Rewrote `README.md` for the native OTel integration — removed the Claude Code plugin quick-start, documented `docker compose up openclaude-observe` + `CLAUDE_OBSERVE_URL`, added a 22+ event types reference table, documented the new `/api/sessions/:id/context`, `/api/sessions/:id/usage`, and `/api/sessions/:id/instances` endpoints, updated the architecture diagram and project structure to drop `hooks/` / `.mcp.json` / `.claude-plugin/`
- Bumped version to 18.04.2026 to resync `package.json` (client) and `VERSION` (server) after the 17.04.2026 release left them mismatched

## 17.04.2026

- `c686fd1` Merged upstream `simple10/agents-observe` (commit `185d7bc`) so the fork no longer shows behind on GitHub
- `ebb284a` Fixed `claude --fork` command in session modal — uses `--fork-session --resume` (matches upstream `185d7bc`)
- `e4e7b78` Added "Newest events on top" setting (Settings → Display, default on) — reverses the event feed so new events spawn at the top and existing events fall downwards; auto-follow icon flips to indicate direction; persisted to localStorage

## 14.04.2026

- `8792a8f` Refactored for native OpenClaude OTel integration — stripped hooks-based plugin, added 22 event types, instances table, LLM metrics
- `df3d385` Renamed to OpenClaude Observe — updated all user-facing branding
- `17bae47` Updated repo URLs to coffeegrind123/openclaude-observe
- `ca3ddc0` Added fork command to session modal details tab
- `f1ff5ec` Fixed new event dots not appearing in timeline mid-animation cycle
- `b7d5f8a` Added multi-instance event detail handlers, filters, and instance badges
- `4320404` Added all OpenClaude event types to settings menu, summaries, and detail views — LLM, Daemon, Pipes, Coordinator, Bridge categories; PermissionDenied support; event summaries for 20+ new types
- `b5ce48b` Fixed copy-all button in raw event logs (clipboard API fallback for non-HTTPS)
- `b5ce48b` Changed versioning from semver to date-based (DD.MM.YYYY + git hash)
- `0b301c3` Added server-side token tracking — 6 new columns on sessions table, auto-increment on LLMGeneration, backfill migration, `/sessions/:id/usage` API endpoint, WebSocket broadcast, sidebar token badge
- `492a000` Removed obsolete hook/plugin files — deleted test/hooks/, check-hooks.ts, .mcp.json, vitest; updated docs for native OTel
- `a372eeb` Reverted session lifecycle change — only SessionEnd marks stopped (Stop per-turn would cause flicker)
- `47a8da9` Fixed FK constraint error on project/session delete — delete instances before sessions
- `d2cebb9` Fixed test mock Session objects missing token fields (TS build error)
- `42de22f` Fixed git hash in Docker image — baked via GIT_HASH file instead of build arg
- `7ced6a3` Fixed vite reading GIT_HASH from file for client bundle injection
- `27c90e7` Simplified GIT_HASH to COPY from build context, removed ARG
- `9cdb359` Added token badge to Recent Sessions page cards (blue "22.0k tok" badge)
- `37fa3ed` Fixed token fields missing from `GET /projects/:id/sessions` response — sidebar was getting sessions without token data

---

*Previous releases used semver versioning (v0.x.y)*

## v0.8.6 — Session stats and UI polish

This release introduces a new session stats tab showing sub-agent token usage and session metrics at a glance. It also adds convenient copy buttons for event details and improves overall UI responsiveness with smoother scrolling and better click interactions.

### Features

- New session stats tab displaying token usage breakdowns and agent results with color-coded names and click-to-scroll navigation
- Copy button on expanded event detail fields for quick clipboard access

### Fixes

- Sidebar clicks now always navigate to the selected session
- Docker image includes python3 and build tools required for better-sqlite3 native compilation

### Other

- Improved scroll performance for expanded rows in the virtualizer
- Refined UI interactions: cursor-pointer on session rows, fixed tooltip placement for timeline agents and dots

## v0.8.5 — Performance fixes and API overhaul

Removed WorktreeCreate hook from the plugin to prevent plugin from blocking worktree creation. Major performance improvements eliminate CPU spikes on large sessions. The REST API has been restructured with standardized error responses. New features include permission mode detection and a resume command in the session modal.

### Breaking Changes

- API error responses now use a standardized format — 3rd party clients parsing error bodies will need to update to the new shape
- Project and agent endpoints have been restructured with new paths

### Features

- Permission mode detection with automatic client-side backfill for older sessions
- Resume command and copy-to-clipboard in the session modal
- `AGENTS_OBSERVE_ALLOW_DB_RESET` env var to guard the DELETE /data endpoint

### Fixes

- Removed WorktreeCreate hook and added safety checks to hook validation
- Fixed WebSocket invalidation cascade causing 100%+ CPU on large sessions
- Fixed timeline CPU usage and spinner freeze on large sessions
- Timeline dots no longer disappear after returning from an inactive browser tab
- Slug and name PATCH endpoints now validate non-empty strings

### Other

- Standardized API types, query param naming, and decoupled callbacks from REST session endpoints
- Cleaned up legacy server API support

## v0.8.2 — Timeline rewind, performance overhaul, and session editing

This release introduces timeline rewind mode for replaying agent sessions, a session edit modal for inline renaming, and toast-based API error surfacing. Major performance work virtualizes the event stream, reduces memory retention, and eliminates expand lag — making the dashboard significantly snappier with large sessions.

### Features

- Timeline rewind mode for stepping through agent sessions frame by frame
- Session edit modal for renaming sessions and projects inline
- API errors now surface as toast notifications
- Orphan repair and foreign-key auto-recovery for database integrity
- Virtualized event stream for large sessions using `@tanstack/react-virtual`
- Reduced memory retention for sessions with many events

### Fixes

- Pinned sessions, breadcrumbs, and project names now auto-update on rename
- Fixed timeline CPU usage from unnecessary re-renders

## v0.8.1 — Session management and richer event details

This release adds the ability to move sessions between projects, edit session names inline, and copy transcript paths — all from a new session action column. Event details now render markdown and diffs, and Bash/Read tool expansions show more context. The client bundle was also cut nearly in half.

### Features

- Move sessions between projects via a new action column with drag-and-drop support
- Copy JSONL transcript path button in session actions
- Open project modal directly from the sidebar edit button
- Session breadcrumb showing project, session name, and working directory
- Markdown and diff rendering in expanded event details
- Improved rendering for Bash, Read StopFailure, PostToolUseFailure, and PermissionRequest events
- Configurable shutdown delay via `AGENTS_OBSERVE_SHUTDOWN_DELAY_MS`
- Reduced client bundle from 1.27 MB to 749 KB with dynamic icon imports

### Fixes

- SubagentStop events now included in the Stop filter
- Database migration dropping unused `events.summary` and `events.status` columns

### Other

- Sidebar polish: projects sorted alphabetically, improved session row UX, footer icons stack vertically when collapsed; sticky select-all bar and better changelog modal headings in the project modal
- Cached event count, agent count, and last activity on the sessions table for faster queries

## v0.8.0 — Session pinning, sorting, and CLI tooling

This release adds several dashboard UI enhancements like session pinning and sort controls, making it easier to organize and find sessions. The CLI gains new commands like hook-sync and hook-autostart, and the `/observe` skill was enhanced with more subcommands and debugging tools. The plugin now checks server health during SessionStart events, sends a status message visible in claude, and auto repairs stopped servers.

### Features

- Pin sessions to the sidebar for quick access, with green indicators for active sessions
- Sort sessions by recent activity or creation date in the sidebar, home page, and project page
- Auto-collapse sidebar session groups when they exceed 10 items
- In-app changelog modal with version checking
- `observe logs` and `observe debug` CLI commands for troubleshooting
- `hook-sync` and `hook-autostart` commands with fast container restart
- Unified `/observe` skill with argument hints (merged observe and observe-status)
- `db-reset` CLI command for clearing the database

### Fixes

- Resolve project slug from URL hash on page refresh
- Prevent premature server exit with a 30-second shutdown delay
- Reduce memory usage from event data retention
- Suppress Radix DialogContent aria-describedby warning on all modals
- Upgrade Vite to address security vulnerability

### Other

- Centralized configuration and extracted shared libraries (hooks, fs, docker env)
- Reorganized tests and added CLI and MCP server test coverage
- Updated documentation, release scripts, and developer tooling

## v0.7.5 — Search polish, timeline fixes, and release tooling

No breaking changes. This version is just cosmetic improvements.

### Features

- Improved search UI with input debouncing, highlighted active border, clear button, and whitespace-only filtering
- Added cursor pointer to clickable elements in the sidebar and stream list
- Display plugin version in the sidebar and redesigned the Settings > Projects view

### Fixes

- Fixed timeline dot positioning to align correctly with trace events
- Fixed timeline animation so dots animate smoothly as a group instead of individually

### Other

- Added fresh install test harness with integration into the release workflow
- Improved release script with dry-run flag, skip-build option, and Claude-generated changelogs
- Updated contributor documentation and formatting configuration
