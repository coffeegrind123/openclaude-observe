# Development Guide

Detailed reference for developing openclaude-observe locally. For the quick start, see [../CLAUDE.md](../CLAUDE.md).

## Architecture

```
OpenClaude forwardHookToObserve()  ->  POST /api/events  ->  API Server (SQLite)  ->  React Dashboard
OpenClaude ClaudeObserveExporter   ->  POST /api/events  ->  (parse + store)       ->  (WebSocket live)
```

- **Hook forwarding** — OpenClaude's `forwardHookToObserve()` intercepts hook events and POSTs them directly to the observe server. No shell scripts, no MCP server, no Claude Code plugin.
- **OTel tracing** — `ClaudeObserveExporter` converts OTel spans to observe events for LLMGeneration (token metrics) and multi-instance activity (Daemon, Pipes, Coordinator, Bridge).
- **Server** (`app/server/`) Hono + better-sqlite3 + native `ws`
- **Client** (`app/client/`) React 19 + shadcn dashboard

In dev mode, client and server run as separate processes on separate ports. In production/Docker, the client is bundled and served by the server on port 4981.

## Commands

| Command | Description |
|---------|-------------|
| `just install` | Install all dependencies |
| `just dev` | Start server + client in dev mode (hot reload) |
| `just start-local` | Run the server locally without Docker |
| `just start` | Start the server via `docker compose up -d` |
| `just stop` | Stop the docker compose stack |
| `just restart` | Restart the docker compose stack |
| `just logs` | Follow Docker container logs |
| `just build` | Build the Docker image locally |
| `just test` | Run all tests (server + client) |
| `just check` | **Run before every commit** — tests + format + client build |
| `just fmt` | Format all source files |
| `just db-reset` | Delete the SQLite database file |
| `just health` | Hit `/api/health` on the running server |
| `just open` | Open the dashboard in your browser |
| `just release` | Tag and push a release (date-based version) |

## Project Structure

```
app/server/        # Hono server, SQLite, WebSocket, parser for 22+ event types
app/client/        # React 19 + shadcn dashboard
scripts/           # Release tooling and changelog generator
docs/              # This file, plans, and demo assets
Dockerfile         # Production container image
docker-compose.yml # Primary run path — `docker compose up openclaude-observe`
justfile           # Task runner commands
start.mjs          # Local server entrypoint (non-Docker) — used by `just dev` / `just start-local`
```

## Environment Variables

Server config is centralized in `app/server/src/config.ts`. Every var below
(except `AGENTS_OBSERVE_DATA_DIR`, which is only read by `docker-compose.yml`)
is consumed there.

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENTS_OBSERVE_SERVER_PORT` | `4981` | Server port (dev + Docker) |
| `AGENTS_OBSERVE_DEV_CLIENT_PORT` | `5174` | Vite dev client port |
| `AGENTS_OBSERVE_RUNTIME` | `docker` | Runtime mode: `docker`, `local`, or `dev` |
| `AGENTS_OBSERVE_SHUTDOWN_DELAY_MS` | `30000` | Auto-shutdown after last consumer disconnects; `0` disables |
| `AGENTS_OBSERVE_LOG_LEVEL` | `warn` | `warn`, `debug`, or `trace` |
| `AGENTS_OBSERVE_DB_PATH` | `data/observe.db` | SQLite database path |
| `AGENTS_OBSERVE_ALLOW_DB_RESET` | `backup` | DB reset policy: `allow`, `backup`, or `deny` |
| `AGENTS_OBSERVE_CLIENT_DIST_PATH` | (auto) | Override the client dist directory |
| `AGENTS_OBSERVE_STORAGE_ADAPTER` | `sqlite` | Storage backend |
| `AGENTS_OBSERVE_DATA_DIR` | `./data` | Host directory bind-mounted into the container (compose only) |

## Worktrees

When using git worktrees for parallel development, each worktree needs its own ports to avoid conflicts.

Create a `.env` in the worktree root:

```bash
AGENTS_OBSERVE_SERVER_PORT=4982
AGENTS_OBSERVE_DEV_CLIENT_PORT=5179
```
