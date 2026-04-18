# Changelog

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
