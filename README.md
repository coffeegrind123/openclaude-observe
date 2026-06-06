# OpenClaude Observe

**Real-time observability for [OpenClaude](https://github.com/coffeegrind123/openclaude).** Every hook event and OTel span the agent emits — tool calls, LLM generations, subagent lifecycles, multi-instance coordination — captured in-process and rendered as a live, time-spined **Stream**.

Zero plugins. Zero hook scripts. Zero MCP servers. One environment variable.

<p align="center">
  <img src="docs/assets/dashboard.png" alt="OpenClaude Observe — the Stream dashboard" />
</p>

<p align="center">
  <em>The Stream: tool calls, LLM generations, and subagent activity flowing across per-agent lanes in real time.</em>
</p>

---

## Why

OpenClaude is autonomous. It spawns subagents, runs tools, calls the model, and coordinates across multiple processes — and your terminal shows you almost none of it. Observe attaches to OpenClaude's native telemetry and reconstructs the whole picture: what ran, in what order, under which agent, at what token cost, across every instance.

## Quick start

```bash
git clone https://github.com/coffeegrind123/openclaude-observe.git
cd openclaude-observe
docker compose up -d openclaude-observe
```

Open **<http://localhost:4981>**, then point OpenClaude at the server:

```bash
export CLAUDE_OBSERVE_URL=http://localhost:4981
```

Restart your OpenClaude session — events stream in automatically.

> **Prerequisites:** [Docker](https://www.docker.com/). [Node.js](https://nodejs.org/) and [just](https://github.com/casey/just) are only needed for local development.

## What you see

- **The Stream** — every event as a live river: colored, iconed, and stamped with its agent, time, and a one-line summary. 28 event types across sessions, tools, subagents, the LLM, and multi-instance IPC.
- **Stream ↔ Talk** — flip the same session between the raw event river and **Talk**: the underlying conversation rendered as full markdown, with code, diffs, thinking blocks, and per-tool viewers (Bash, Edit, Read, Grep, Write, diffs, Mermaid).
- **Activity timeline** — per-agent lanes (Main + each subagent) on a shared time-spine, with Live tailing and `1m / 5m / 10m / 60m / 3h / 24h` zoom. Click any dot to jump, or scrub the session frame-by-frame.
- **Agent hierarchy** — subagent ↔ parent links carried as threaded color cues across the lanes, the stream, and the sidebar.
- **Multi-instance topology** — daemon, pipe, coordinator, and bridge events badged by `instance_id`, with live heartbeat tracking.
- **Token & cost accounting** — input / output / cache / creation tokens and LLM-call counts per session and per agent, plus an opt-in **transcript stats** panel that parses `~/.claude/projects` JSONL for per-prompt / per-model token *and dollar-cost* breakdowns (live [models.dev](https://models.dev) pricing).
- **Filters & facets** — DB-backed, RE2-regex filter rules with live preview, per-filter color, and pill-name templating, plus full-text search and one-click agent / prompt / session / tool facets. Copy the raw payload of any field in one click.
- **Keyboard-first** — region-jump shortcuts (`s` search, `a` agents, `f` filters, `b` sidebar, `e` stream) with arrow-key row navigation.
- **Bookmarks & labels** — pin sessions, tag them with labels, and fork-resume in one click. Optional newest-on-top feed.

## Architecture

```
OpenClaude forwardHookToObserve()  ─┐
                                    ├─▶  POST /api/events  ─▶  SQLite + WebSocket  ─▶  React dashboard
OpenClaude ClaudeObserveExporter   ─┘
```

Both transports run **in-process** inside OpenClaude. The server parses each event, persists it, and broadcasts to every subscribed dashboard. The client derives all agent state from the event stream — virtualized, deferred, and dedup'd so multi-thousand-event sessions stay smooth.

| Layer | Stack |
|-------|-------|
| Server | Hono · better-sqlite3 · native `ws` |
| Client | React 19 · shadcn/ui · TanStack Query / Virtual · Zustand |
| Wire | JSON over HTTP for ingest, JSON over WebSocket for live updates |
| Storage | SQLite at `data/observe.db` (single file, bind-mounted in Docker) |

## Event coverage

| Category | Events |
|----------|--------|
| **Session** | SessionStart · Stop · UserPromptSubmit · Notification |
| **Tools** | PreToolUse · PostToolUse · PostToolUseFailure · ToolBatch |
| **Subagents** | SubagentStart · SubagentStop |
| **LLM** | LLMGeneration *(model, in/out/cache tokens, TTFT, duration)* |
| **Daemon** | DaemonStart · DaemonStop · DaemonHeartbeat |
| **Pipes (IPC)** | PipeRoleAssigned · PipeAttach · PipeDetach · PipePromptRouted · PipePermissionForward · PipeLanPeerDiscovered |
| **Coordinator** | CoordinatorDispatch · CoordinatorResult |
| **Bridge** | BridgeConnected · BridgeDisconnected · BridgeWorkReceived |
| **System** | SuperModeToggle · CompactionRun · CostUpdate |

Any event can carry an `instance_id`, so multi-process deployments surface with per-instance badges.

## Configuration

All server config is centralized in [`app/server/src/config.ts`](app/server/src/config.ts). Copy `.env.example` to `.env` to override — the full list lives there.

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCLAUDE_OBSERVE_SERVER_PORT` | `4981` | API + UI port |
| `OPENCLAUDE_OBSERVE_LOG_LEVEL` | `warn` | `warn`, `debug`, or `trace` |
| `OPENCLAUDE_OBSERVE_SHUTDOWN_DELAY_MS` | `30000` | Idle auto-shutdown after the last consumer disconnects (`0` disables) |
| `OPENCLAUDE_OBSERVE_DB_PATH` | `data/observe.db` | SQLite database path |
| `OPENCLAUDE_OBSERVE_ALLOW_DB_RESET` | `backup` | DB reset policy: `allow`, `backup`, or `deny` |
| `OPENCLAUDE_OBSERVE_TRANSCRIPT_STATS` | `1` | On-demand transcript token/cost stats (`0` disables) |
| `OPENCLAUDE_OBSERVE_DEV_CLIENT_PORT` | `5174` | Vite dev client port |

On the OpenClaude side, set `CLAUDE_OBSERVE_URL=http://localhost:4981`.

## API

REST + WebSocket, served from the same origin as the dashboard.

| Endpoint | Description |
|----------|-------------|
| `POST /api/events` | Event ingestion (OpenClaude POSTs here) |
| `GET  /api/sessions/recent` | Recent sessions with token rollups |
| `GET  /api/sessions/:id` | Session detail + token totals |
| `GET  /api/sessions/:id/usage` | Tokens + per-agent breakdown |
| `GET  /api/sessions/:id/instances` | Per-session instances (role, pid, heartbeat) |
| `GET  /api/projects/:id/sessions` | Sessions scoped to a project |
| `GET  /api/health` | Liveness, version, runtime |
| `WS   /ws` | Live event stream + `instance_update` messages |

## Local development

```bash
just install   # install server + client deps
just dev       # hot-reload dev mode (API :4981, Vite client :5174)
just check     # tests + format + client build — run before every commit
```

Run `just --list` for all recipes. See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the full guide — worktrees, environment variables, testing, and code style.

## Project structure

```text
app/
  server/              Hono routes, event parser, SQLite, WebSocket
  client/              React 19 + shadcn dashboard
docs/                  Development guide + demo assets
scripts/               Release + changelog tooling
Dockerfile             Production container image
docker-compose.yml     Primary run path
justfile               Task runner
start.mjs              Local entrypoint (non-Docker)
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Server not reachable | `just start` (Docker) or `just dev` for hot-reload |
| Port 4981 in use | Set `OPENCLAUDE_OBSERVE_SERVER_PORT=<port>` in `.env` |
| Events not appearing | Verify `CLAUDE_OBSERVE_URL` in OpenClaude's env. Check `curl http://localhost:4981/api/health` |
| WebSocket disconnected | The client auto-reconnects every 3s and refetches missed events |
| Database corruption | Stop the server, then `just db-reset` (writes a `.bak` when `OPENCLAUDE_OBSERVE_ALLOW_DB_RESET=backup`) |

## Versioning

Date-based: `DD.MM.YYYY` plus a short git hash baked into the Docker image. Releases before `14.04.2026` used semver — see [CHANGELOG.md](CHANGELOG.md).

## Contributing

[Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `style:`, `refactor:`, `test:`, `chore:`, `release:`); breaking changes get a `!`. The release script reads `git log` to generate the changelog, so consistent prefixes matter. Details in [CONTRIBUTING.md](CONTRIBUTING.md).

## Acknowledgements

Forked from [simple10/agents-observe](https://github.com/simple10/agents-observe) — itself inspired by [disler/claude-code-hooks-multi-agent-observability](https://github.com/disler/claude-code-hooks-multi-agent-observability) — and rebuilt around OpenClaude's native OTel + hook-forwarding integration. The split event/chat layout drew inspiration from [agent-chat](https://github.com/DheerG/agent-chat).

## License

[MIT](LICENSE)
