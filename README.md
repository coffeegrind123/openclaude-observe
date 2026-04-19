# OpenClaude Observe

Real-time observability dashboard for [OpenClaude](https://github.com/coffeegrind123/openclaude). Captures every hook event and OTel span the agent emits — in-process, zero config beyond a single env var.

<p align="center">
  <img src="https://raw.githubusercontent.com/coffeegrind123/openclaude-observe/main/docs/assets/dashboard2.png" alt="OpenClaude Observe Dashboard" />
</p>

## Quick Start

```bash
git clone https://github.com/coffeegrind123/openclaude-observe.git
cd openclaude-observe
docker compose up -d openclaude-observe
```

Open **<http://localhost:4981>** and point OpenClaude at the server:

```bash
export CLAUDE_OBSERVE_URL=http://localhost:4981
```

Restart your OpenClaude session. Events stream in automatically — no plugin, no hook scripts, no MCP server.

**Prerequisites:** [Docker](https://www.docker.com/). [Node.js](https://nodejs.org/) and [just](https://github.com/casey/just) only for local dev.

## What you see

OpenClaude is an autonomous agent — it spawns subagents, runs tools, calls the LLM, coordinates across multiple instances. The terminal shows you only the surface. Observe shows you everything underneath:

- **Live event stream** — tool calls, LLM generations, subagent lifecycles, compactions, permission prompts. 27 event types, all colored and iconed
- **Split chat / event view** — conversation on the right with full markdown; raw stream on the left. Resizable, collapsible, sticky-to-newest
- **Full agent hierarchy** — subagent ↔ parent links with threaded color cues throughout the UI
- **Multi-instance topology** — daemon, pipes, coordinator, bridge events badged by `instance_id`, with heartbeat tracking
- **Token accounting** — input / output / cache / creation tokens + LLM call counts tallied per session and per agent. Compact badges in the sidebar; full breakdown via `GET /api/sessions/:id/usage`
- **Filter, search, expand** — by agent, event type, tool, instance, or free-text. Every event expands to its raw payload with one-click copy on every field
- **Timeline rewind** — scrub a session frame-by-frame, click any dot to jump
- **Newest-on-top mode** — optional reverse-chronological feed (Settings → Display)
- **Session bookmarks** — pin sessions, attach labels, fork-resume in one click

## Architecture

```
OpenClaude forwardHookToObserve()  ─┐
                                    ├─▶  POST /api/events  ─▶  SQLite + WebSocket  ─▶  React Dashboard
OpenClaude ClaudeObserveExporter   ─┘
```

Both transports are in-process inside OpenClaude. The server (Hono + better-sqlite3 + native `ws`) parses each event, persists it, and broadcasts to subscribed dashboard clients. The client (React 19 + shadcn) derives all agent state from the event stream — virtualized, deferred, and dedup'd so multi-thousand-event sessions stay smooth.

| Layer | Stack |
|-------|-------|
| Server | Hono · better-sqlite3 · native `ws` |
| Client | React 19 · shadcn/ui · TanStack Query / Virtual · Zustand |
| Wire | JSON over HTTP for ingest, JSON over WS for live updates |
| Storage | SQLite at `data/observe.db` (single file, bind-mounted in Docker) |

## Event coverage

| Category | Events |
|----------|--------|
| **Session** | SessionStart, Stop, UserPromptSubmit, Notification |
| **Tools** | PreToolUse, PostToolUse, PostToolUseFailure, ToolBatch |
| **Subagents** | SubagentStart, SubagentStop |
| **LLM** | LLMGeneration (model, in/out/cache tokens, TTFT, duration) |
| **Daemon** | DaemonStart, DaemonStop, DaemonHeartbeat |
| **Pipes (IPC)** | PipeRoleAssigned, PipeAttach, PipeDetach, PipePromptRouted, PipePermissionForward, PipeLanPeerDiscovered |
| **Coordinator** | CoordinatorDispatch, CoordinatorResult |
| **Bridge** | BridgeConnected, BridgeDisconnected, BridgeWorkReceived |
| **System** | SuperModeToggle, CompactionRun, CostUpdate |

Every event can carry `instance_id` so multi-process deployments show up with instance badges.

## Configuration

All server env vars are centralized in `app/server/src/config.ts`. Copy `.env.example` to `.env` to override.

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENTS_OBSERVE_SERVER_PORT` | `4981` | API + UI port |
| `AGENTS_OBSERVE_DEV_CLIENT_PORT` | `5174` | Vite dev client port |
| `AGENTS_OBSERVE_RUNTIME` | `docker` | `docker`, `local`, or `dev` |
| `AGENTS_OBSERVE_SHUTDOWN_DELAY_MS` | `30000` | Auto-shutdown after last consumer disconnects (`0` disables) |
| `AGENTS_OBSERVE_LOG_LEVEL` | `warn` | `warn`, `debug`, or `trace` |
| `AGENTS_OBSERVE_DB_PATH` | `data/observe.db` | SQLite database path |
| `AGENTS_OBSERVE_ALLOW_DB_RESET` | `backup` | DB reset policy: `allow`, `backup`, `deny` |
| `AGENTS_OBSERVE_CLIENT_DIST_PATH` | (auto) | Override the client dist directory |

On the OpenClaude side, set `CLAUDE_OBSERVE_URL=http://localhost:4981`.

## API

REST + WebSocket served from the same origin as the dashboard.

| Endpoint | Description |
|----------|-------------|
| `POST /api/events` | Event ingestion (OpenClaude POSTs here) |
| `GET  /api/sessions/recent` | Recent sessions with token rollups |
| `GET  /api/sessions/:id` | Session detail + token totals |
| `GET  /api/sessions/:id/usage` | Tokens + per-agent breakdown |
| `GET  /api/sessions/:id/instances` | Per-session instance list (role, pid, heartbeat) |
| `GET  /api/projects/:id/sessions` | Sessions scoped to a project |
| `WS   /ws` | Live event stream + `instance_update` messages |

## Local development

Requires [Node.js](https://nodejs.org/) and [just](https://github.com/casey/just).

```bash
just install   # install server + client deps
just dev       # hot-reload dev mode (API on :4981, Vite client on :5174)
just check     # tests + format + client build — run before every commit
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the full guide (worktrees, env vars, testing, code style). Run `just --list` for all recipes.

## Project structure

```text
app/
  server/              Hono routes, parser, SQLite, WebSocket
  client/              React 19 + shadcn dashboard
scripts/               Release tooling, changelog generator
docs/                  Development guide, design plans, demo assets
Dockerfile             Production container image
docker-compose.yml     Primary run path
justfile               Task runner
start.mjs              Local entrypoint (non-Docker)
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Server not reachable | `just start` (docker compose) or `just dev` for hot-reload |
| Port 4981 in use | `AGENTS_OBSERVE_SERVER_PORT=<port>` in `.env` |
| Events not appearing | Verify `CLAUDE_OBSERVE_URL` in OpenClaude's env. Health: `curl http://localhost:4981/api/health` |
| WebSocket disconnected | Client auto-reconnects every 3s; missed events refetch on reconnect |
| Database corruption | Stop server, `just db-reset` (writes `.bak` if `AGENTS_OBSERVE_ALLOW_DB_RESET=backup`) |

## Versioning

Date-based: `DD.MM.YYYY` plus a short git hash baked into the Docker image. Earlier releases (pre-`14.04.2026`) used semver — see [CHANGELOG.md](CHANGELOG.md).

## Commit convention

[Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `style:`, `refactor:`, `test:`, `chore:`, `release:`. Breaking changes get `!` (e.g., `feat!: rename config namespace`). The release script reads `git log` to auto-generate `CHANGELOG.md` entries — consistent prefixes keep the changelog tidy.

## Acknowledgements

Forked from [simple10/agents-observe](https://github.com/simple10/agents-observe) — itself inspired by [disler/claude-code-hooks-multi-agent-observability](https://github.com/disler/claude-code-hooks-multi-agent-observability) — and rewritten around OpenClaude's native OTel + hook-forwarding integration. The split event/chat layout was inspired by [agent-chat](https://github.com/DheerG/agent-chat).

## License

MIT
