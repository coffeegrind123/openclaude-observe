# OpenClaude Observe

Real-time observability dashboard for [OpenClaude](https://github.com/coffeegrind123/openclaude).

Receives OTel trace events via native in-process integration — LLM calls, tool executions, agent hierarchy, and multi-instance topology (daemon, pipes, coordinator, bridge). Powerful filtering, searching, split event/chat view, and live visualization of multi-agent sessions.

<p align="center">
  <img src="https://raw.githubusercontent.com/coffeegrind123/openclaude-observe/main/docs/assets/dashboard2.png" alt="OpenClaude Observe Dashboard" />
</p>

## Quick Start

```bash
git clone https://github.com/coffeegrind123/openclaude-observe.git
cd openclaude-observe
docker compose up openclaude-observe
```

Dashboard: **<http://localhost:4981>**

Point OpenClaude at the server by setting `CLAUDE_OBSERVE_URL` in its environment:

```bash
export CLAUDE_OBSERVE_URL=http://localhost:4981
```

Restart your OpenClaude session. Events stream in automatically — no plugin, no hook scripts, no MCP server.

### Prerequisites

- [Docker](https://www.docker.com/) — the server runs as a container
- [just](https://github.com/casey/just) and [Node.js](https://nodejs.org/) — only for local dev

## Why observability matters

When OpenClaude runs autonomously — spawning subagents, invoking tools, calling the LLM, coordinating across multiple instances — the terminal only surfaces a fraction of what's happening. Subagents are invisible. Daemon/pipe/coordinator/bridge traffic is opaque. And when something goes wrong three agents deep in parallel execution, you're left reading logs after the fact.

OpenClaude Observe captures every OTel span and hook event as it happens and streams them to a live dashboard. You see exactly what each agent and instance is doing, which tools it's calling, what files it's touching, how subagents relate to their parents, and how tokens are flowing — in real time.

- **Multi-agent work is opaque.** A coordinator spawns a reviewer, a test runner, and a docs agent in parallel. Without observability, you only see the final result. Here you watch each one work and catch problems as they happen.
- **Multi-instance topology is invisible.** OpenClaude runs as a daemon with worker pipes, a coordinator, and a bridge. Observe shows each instance with a badge, tracks heartbeats, and correlates cross-instance events.
- **Tool calls are the ground truth.** The assistant's text output is a summary. The tool calls — Bash commands, file reads, edits, grep patterns — are what it actually did.
- **LLM usage is measurable.** Every LLMGeneration span is captured with input/output/cache tokens, TTFT, duration, and model. Session-level token rollups surface in the sidebar and via REST.
- **Sessions are ephemeral, but patterns aren't.** Historical events let you see how agents behave over time, which tools they favor, and where they get stuck.

## What you can do

- **Watch events stream live** — tool calls, LLM generations, subagent lifecycles, compactions, permission prompts, stops, and 20+ OpenClaude-specific event types
- **Split event/chat view** — event stream on the left, conversation-style feed on the right with full markdown rendering (headings, lists, code, tables, links). Panel is resizable (280–800px), collapsible, and sticky-to-newest
- **See the full agent hierarchy** — which subagent was spawned by which parent, with timeline colors threaded throughout the UI
- **See multi-instance topology** — daemon, pipes, coordinator, bridge events badged by `instance_id`, with filters and per-instance detail handlers
- **Track tokens server-side** — input/output/cache/creation tokens + LLM call counts are tallied per session, shown as compact badges in the sidebar and on the Recent Sessions page, and exposed via `GET /sessions/:id/usage` with per-agent breakdowns
- **Filter and search** — by agent, event type, tool, instance, or free text across all events
- **Expand any event** — see the full payload, LLM token breakdown bars (in/out/cache + hit ratio), command, and result. Every field has a copy-to-clipboard button
- **Timeline controls** — click dots to jump to events, rewind through a session frame by frame
- **Session stats tab** — per-agent token usage and results at a glance
- **Fork a session** — one-click `claude --fork-session --resume` command in the session modal
- **Newest-on-top feed** — optional reverse-chronological mode (Settings → Display) where new events spawn at the top and existing events fall downward; auto-follow icon flips to indicate direction
- **Browse historical sessions** — with human-readable slugs (e.g., "twinkly-hugging-dragon")

## Architecture

```
OpenClaude forwardHookToObserve()  ─┐
                                    ├─▶  POST /api/events  ─▶  API Server (SQLite)  ─▶  React Dashboard
OpenClaude ClaudeObserveExporter   ─┘                         (parse + store)          (WebSocket live)
```

- **Hook forwarding** — OpenClaude's `forwardHookToObserve()` intercepts all 27 hook events (SessionStart/End, PreToolUse/PostToolUse, UserPromptSubmit, SubagentStop, etc.) and POSTs them directly. No shell scripts, no MCP server, no hook commands in `settings.json`.
- **OTel tracing** — `ClaudeObserveExporter` converts OTel spans into observe events for LLMGeneration (model, tokens, TTFT, cache metrics) and for multi-instance activity (Daemon, Pipes, Coordinator, Bridge, SuperMode, Compaction, Cost).
- **Server** (`app/server/`) — Hono + better-sqlite3 + native `ws`. Parser extracts structural fields from 22+ event types, stores agent and instance metadata, broadcasts to subscribed WebSocket clients. Instance heartbeats tracked for daemon workers.
- **Client** (`app/client/`) — React 19 + shadcn. All agent state (status, counts, timing) is derived client-side from the event stream. Tool events are deduped (PreToolUse + PostToolUse merged). Icon mapping and summary generation are editable config files.

## Event types

OpenClaude Observe recognizes 22+ event types in five categories:

| Category | Events |
|----------|--------|
| **Hooks** (Claude Code–compatible) | SessionStart, SessionEnd, UserPromptSubmit, Stop, PreToolUse, PostToolUse, SubagentStop, Notification, PreCompact, PermissionDenied, … |
| **LLM** | LLMGeneration (model, input/output/cache tokens, TTFT, duration) |
| **Daemon** | DaemonStart, DaemonStop, worker lifecycle, heartbeats |
| **Pipes / IPC** | PipeConnect, PipeDisconnect, PipeMessage |
| **Coordinator / Bridge** | CoordinatorEvent, BridgeEvent, SuperMode transitions |
| **System** | Compaction, Cost tracking |

Each event can carry an `instance_id` so multi-process deployments (daemon + pipes + coordinator + bridge) show up with instance badges in the UI.

## Local development

Requires [Node.js](https://nodejs.org/) and [just](https://github.com/casey/just).

```bash
git clone https://github.com/coffeegrind123/openclaude-observe.git
cd openclaude-observe
just install    # install server + client deps
just dev        # hot-reload dev mode
```

Dev mode runs the API on **<http://localhost:4981>** and the Vite client on **<http://localhost:5174>**.

For production-style local run (no Docker): `npm run start`.

### Commands

```bash
just install            # Install all dependencies
just dev                # Start server + client in dev mode (hot reload)
just test               # Run all tests (server + client)
just check              # Tests + format + client build — run before every commit
just fmt                # Format all source files
just build              # Build the Docker image locally
just release <version>  # Tag and push a release
```

See `just --list` for the full set. The `docker compose up` path in Quick Start is the recommended way to run the server day-to-day.

### Configuration

All server env vars are centralized in `app/server/src/config.ts`. The client reads only `AGENTS_OBSERVE_DEV_CLIENT_PORT`.

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENTS_OBSERVE_SERVER_PORT` | `4981` | Server port (dev + Docker) |
| `AGENTS_OBSERVE_DEV_CLIENT_PORT` | `5174` | Vite dev client port |
| `AGENTS_OBSERVE_RUNTIME` | `docker` | `docker`, `local`, or `dev` |
| `AGENTS_OBSERVE_SHUTDOWN_DELAY_MS` | `30000` | Auto-shutdown after last consumer disconnects (`0` disables) |
| `AGENTS_OBSERVE_LOG_LEVEL` | `warn` | `warn`, `debug`, or `trace` |
| `AGENTS_OBSERVE_DB_PATH` | `data/observe.db` | SQLite database path |
| `AGENTS_OBSERVE_ALLOW_DB_RESET` | `backup` | DB reset policy: `allow`, `backup`, `deny` |
| `AGENTS_OBSERVE_CLIENT_DIST_PATH` | (auto) | Custom client dist directory |

On the OpenClaude side, point the exporter at this server with `CLAUDE_OBSERVE_URL=http://localhost:4981`.

### Worktrees

Each git worktree needs its own ports. Create a `.env` in the worktree root:

```bash
AGENTS_OBSERVE_SERVER_PORT=4982
AGENTS_OBSERVE_DEV_CLIENT_PORT=5179
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the full development guide.

## Project structure

```text
app/
  server/              Hono routes, SQLite, WebSocket, parser for 22+ event types
  client/              React 19 + shadcn dashboard (event stream, chat feed, timeline, sidebar)
scripts/               Release tooling, changelog generator, fresh-install test harness
test/
  fresh-install/       End-to-end test harness that verifies a clean Docker install
docs/                  Development guide, plans, and demo assets
Dockerfile             Production container image
docker-compose.yml     Primary run path — `docker compose up openclaude-observe`
justfile               Task runner commands
start.mjs              Local server entrypoint (non-Docker)
vitest.config.ts       Test configuration
package.json           Version metadata and workspace scripts
```

## API

REST and WebSocket endpoints are served from the same origin as the dashboard.

| Endpoint | Description |
|----------|-------------|
| `POST /api/events` | Event ingestion (OpenClaude posts here) |
| `GET  /api/sessions/recent` | Recent sessions with token rollups |
| `GET  /api/sessions/:id` | Session detail + token fields |
| `GET  /api/sessions/:id/usage` | Token totals + per-agent breakdown via `json_extract` |
| `GET  /api/sessions/:id/instances` | Per-session instance list (role, pid, heartbeat) |
| `GET  /api/projects/:id/sessions` | Sessions scoped to a project |
| `WS   /ws` | Live event stream + `instance_update` messages |

Dev mode and production/Docker mode share the same SQLite database at `./data/observe.db` by default. The database is created on first run.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Server not running | `docker compose up openclaude-observe` |
| Docker not running | Start Docker Desktop, then retry |
| Port 4981 in use | Set `AGENTS_OBSERVE_SERVER_PORT=<port>` in `.env` (server auto-selects a free port if the requested one is taken) |
| Events not appearing | Check `CLAUDE_OBSERVE_URL` is set in OpenClaude's env and the server is reachable. Health check: `curl http://localhost:4981/api/health` |
| WebSocket disconnected | Client reconnects every 3s. "Disconnected" shows in the sidebar footer; missed events are refetched on reconnect |
| Database issues | Stop the server, delete `./data/observe.db`, restart. Backups are written automatically when `AGENTS_OBSERVE_ALLOW_DB_RESET=backup` |

## Versioning

Since 14.04.2026, this project uses **date-based versioning** (`DD.MM.YYYY`) plus a short git hash baked into the Docker image at build time. Earlier releases used semver (`v0.x.y`) — see [CHANGELOG.md](CHANGELOG.md).

## Commit convention

[Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `style:`, `refactor:`, `test:`, `chore:`, `release:`. The release script uses `git log` to auto-generate `CHANGELOG.md` entries. Breaking changes get a `!` (e.g., `feat!: rename config namespace`).

## Roadmap

- [ ] Codex support
- [ ] OpenClaw support
- [ ] pi-code agent support

## Related projects

- [OpenClaude](https://github.com/coffeegrind123/openclaude) — the upstream agent this dashboard observes
- [agents-observe](https://github.com/simple10/agents-observe) — the original Claude Code hooks-based observability project this fork grew out of
- [Agent Super Spy](https://github.com/simple10/agent-super-spy) — full observability stack for agents, local or remote
- [Multi-Agent Observability System](https://github.com/disler/claude-code-hooks-multi-agent-observability) — inspired the original project
- [agent-chat](https://github.com/DheerG/agent-chat) — inspired the split event/chat view

## License

MIT
