# Development Guide

Detailed reference for developing openclaude-observe locally. For quick start, see [CLAUDE.md](../CLAUDE.md).

## Architecture

```
OpenClaude forwardHookToObserve()  ->  POST /api/events  ->  API Server (SQLite)  ->  React Dashboard
OpenClaude ClaudeObserveExporter   ->  POST /api/events  ->  (parse + store)       ->  (WebSocket live)
```

- **Hook forwarding** — OpenClaude's `forwardHookToObserve()` intercepts all 27 hook events and POSTs them directly to the observe server. No shell scripts or hook commands needed.
- **OTel tracing** — `ClaudeObserveExporter` converts OTel spans to observe events for LLMGeneration (token metrics) and multi-instance events (Daemon, Pipes, Coordinator, Bridge).
- **Server** (`app/server/`) Hono + SQLite + WebSocket
- **Client** (`app/client/`) React 19 + shadcn dashboard

In dev mode, client and server run as separate processes on separate ports. In production/Docker, the client is bundled and served by the server on port 4981.

## Commands

| Command | Description |
|---------|-------------|
| `just install` | Install all dependencies |
| `just dev` | Start server + client in dev mode (hot reload) |
| `just start` | Start the server |
| `just stop` | Stop the server |
| `just restart` | Restart the server |
| `just build` | Build the Docker image locally |
| `just test` | Run all tests |
| `just test-event` | Send a test event |
| `just health` | Check server health |
| `just check` | **Run before every commit** — tests + format |
| `just fmt` | Format all source files |
| `just db-reset` | Delete the SQLite database (stops/restarts server) |
| `just logs` | Follow Docker container logs |
| `just open` | Open dashboard in browser |

## Project Structure

```
app/server/        # Hono server, SQLite, WebSocket
app/client/        # React 19 + shadcn dashboard
scripts/           # Release and test harness scripts
test/              # Integration tests
docs/              # Plans, specs, and this file
Dockerfile         # Production container image
docker-compose.yml # Reference compose file
justfile           # Task runner commands
start.mjs          # Local server entrypoint (non-Docker)
```

## Environment Variables

Server config is centralized in `app/server/src/config.ts`.

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENTS_OBSERVE_SERVER_PORT` | `4981` | Server port (dev + Docker) |
| `AGENTS_OBSERVE_DEV_CLIENT_PORT` | `5174` | Vite dev client port |
| `AGENTS_OBSERVE_RUNTIME` | `docker` | Runtime mode: `docker` or `local` |
| `AGENTS_OBSERVE_SHUTDOWN_DELAY_MS` | `30000` | Auto-shutdown delay after last consumer disconnects. `0` disables |
| `AGENTS_OBSERVE_LOG_LEVEL` | `warn` | Log level: `warn`, `debug`, or `trace` |
| `AGENTS_OBSERVE_DB_PATH` | `data/observe.db` | SQLite database path |
| `AGENTS_OBSERVE_ALLOW_DB_RESET` | `backup` | DB reset policy: `allow`, `backup`, `deny` |
| `AGENTS_OBSERVE_CLIENT_DIST_PATH` | (auto) | Custom client dist directory |

## Worktrees

When using git worktrees for parallel development, each worktree needs its own ports to avoid conflicts.

Create a `.env` in the worktree root:

```bash
AGENTS_OBSERVE_SERVER_PORT=4982
AGENTS_OBSERVE_DEV_CLIENT_PORT=5179
```
