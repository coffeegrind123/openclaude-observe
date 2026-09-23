# instantcoffee-observe

Real-time observability for [instantcoffee](https://github.com/coffeegrind123/instantcoffee) — the [pi](https://pi.dev) coding agent on Qwen3.8-27B behind llama.cpp and the forge proxy. Watch what a pi session actually does — every prompt, tool call, LLM generation and subagent — in a live dashboard, alongside what the inference stack underneath is doing: decode speed, speculative-decoding acceptance, prompt-cache reuse and context fill.

<p align="center">
  <img src="docs/assets/dashboard.png" alt="instantcoffee-observe dashboard" />
</p>

## What it is

A small [Hono](https://hono.dev) server that ingests pi's session events over HTTP, stores them in SQLite, and streams them to a React dashboard over a WebSocket — plus a poller on llama-server and forge. Three surfaces:

- **Observe** — a live feed of a session's events, a per-agent activity timeline, the subagent tree (including subagents spawned by subagents), per-turn context attribution, and token accounting.
- **Stack** — the last hour of llama-server and forge metrics. pi itself never sees these: forge drops llama's per-request timings, so this is the only place decode speed and draft acceptance are visible.
- **Instructions** — a browser and editor for what pi puts in every request: `AGENTS.md` / `CLAUDE.md` context files, `SYSTEM.md` / `APPEND_SYSTEM.md`, and pi-subagents-lite agent definitions — each with its token cost, because on a 96K local window that cost is paid on every call.

## Quick start

```bash
git clone https://github.com/coffeegrind123/instantcoffee-observe.git
cd instantcoffee-observe
cp .env.example .env    # set the pi home mounts — see "Host mounts" below
docker compose up -d instantcoffee-observe   # or: just start
```

Open <http://localhost:4981>. On the instantcoffee side there is nothing to install: `scripts/pi-local.sh` loads the observe extension by default (`OBSERVE_ENABLED=1` in instantcoffee's `.env`). Start a session and it streams in; the launch banner says `observe` when the dashboard was reachable.

> **Prerequisites:** [Docker](https://www.docker.com/). [Node.js](https://nodejs.org/) and [just](https://github.com/casey/just) only for local development.

## How pi connects

instantcoffee's `.pi/extensions/observe/` is a pi extension that listens to pi's session events and POSTs each one to `POST /api/events`. It is loaded into the top-level session and, through `SUBAGENT_EXTRA_EXTENSIONS`, into every subagent. It registers no tools, so it costs the model's window nothing, and it never blocks a turn: delivery is ordered, bounded, and backs off for ten seconds when the dashboard is down. `/observe` inside pi shows what was sent and dropped.

pi-subagents-lite runs subagents in pi's own process on in-memory sessions, and nothing it emits links a child to the call that spawned it. The extension resolves that itself and sends it explicitly (`agent_id`, `parent_tool_use_id`, `parent_agent_id`), so the dashboard's agent tree is exact rather than guessed.

The contract is [docs/pi-protocol.md](docs/pi-protocol.md). Both repos test against the same real captured pi session: the extension replays it, and the envelopes it produces are this server's ingestion fixture.

## The Observe dashboard

- **Event feed** — a virtualized, live list of a session's events; each row expands into a typed viewer for pi's tools (`read`, `edit` with a diff, `write`, `bash`, `grep`, `find`, `ls`, `mcp`, `browser_*`) and for LLM generations (tokens, time to first token, duration, stop reason, thinking).
- **Stream ↔ Talk** — the raw event stream, or just the conversation rendered as markdown.
- **Activity timeline** — per-agent lanes on a shared time-spine, live tailing, zoom from `1m` to `24h`, and rewind.
- **Subagents** — each child hangs under the `Agent` (or nested `SubAgent`) call that spawned it, across the lanes, the feed and the sidebar.
- **Context attribution** — for every LLM call, an estimate of what fills that agent's window: the system prompt (a standing cost), the compaction summary, user messages, tool output, subagent results, injected messages and prior assistant output — next to the real input token count.
- **Session stats** — per-prompt and per-model tokens and cost parsed from pi's own session JSONL. Cost is what pi recorded (0 for the local model, real for remote subagent models), with [models.dev](https://models.dev) pricing as the fallback.
- **Filters, search, labels, pins, keyboard navigation** — DB-backed RE2 filter rules with pi-aware defaults, full-text search, cross-project labels, and region shortcuts with a ⌘K palette.

## The Stack page

From the sidebar strip (live decode speed, draft acceptance and context fill) or `#/stack`:

- **Decode and prefill speed** — busy-time rates from llama's cumulative counters (`Δtokens / Δbusy-seconds`), not wall-clock averages.
- **Draft acceptance** — accepted / drafted tokens, tokens accepted per draft, and acceptance by draft position: how deep drafts survive, which is what caps the speculative-decoding speed-up.
- **Prompt cache reuse** — cached / (cached + prefilled) prompt tokens.
- **Context fill** — forge's view of the live session, graded against pi's compaction threshold.

A llama-server restart re-baselines instead of producing a negative rate. `stalled` means llama accepted the connection but `/metrics` did not answer — its task queue is busy or wedged.

## The Instructions browser

- Stores per pi home (`~/.pi/agent`: context files and `agents/*.md`) and per project (its `AGENTS.md`, `.pi/SYSTEM.md`, `.pi/agents/`, `.agents/agents/`).
- Follows pi's loader: one context file per directory (`AGENTS.override.md` › `AGENTS.md` › `CLAUDE.md`), collected from every directory down to cwd; shadowed files are marked and left out of the cost.
- A structured editor for agent definitions (`name`, `description`, `tools`, `model`, `thinking`, …) with a raw toggle, `[[wikilink]]` and markdown-link navigation, and a force-directed graph across all stores.
- Writes are atomic (temp file, then rename) and confined to an allowlist of instruction-file paths.

## Architecture

```
pi (instantcoffee)                              instantcoffee-observe
  .pi/extensions/observe ── POST /api/events ──► parse · dedup · persist ─► SQLite
                                                                 │
  llama-server :8080 ◄── /metrics ──── stack poller ─────────────┤
  forge        :8081 ◄── /forge/usage ─┘                         ▼
                                                  WebSocket /api/events/stream
                                                                 ▼
                                                         React dashboard
```

| Layer | Stack |
|-------|-------|
| Server | Hono · better-sqlite3 (WAL) · native `ws` · `tsx` runtime |
| Client | React 19 · Tailwind 4 · TanStack Query / Virtual · Zustand · react-force-graph-2d |
| Wire | JSON over HTTP for ingest, JSON over WebSocket for live updates |
| Storage | SQLite at `data/observe.db` |

## Security

The dashboard, API and WebSocket are unauthenticated, so by default everything is local-only:

- The server binds `127.0.0.1`, and Docker publishes the port on host loopback (`INSTANTCOFFEE_OBSERVE_BIND=0.0.0.0` opts into LAN access).
- CORS and the WebSocket handshake accept loopback origins only (`INSTANTCOFFEE_OBSERVE_CORS_ORIGINS` to widen).
- `transcript_path` values arrive from event senders, so the server reads only `.jsonl` files under a configured pi home's `.pi/agent/sessions/`, after resolving `..` and symlinks.
- The Instructions editor writes only allowlisted instruction-file paths.

## Configuration

Every server setting lives in [`app/server/src/config.ts`](app/server/src/config.ts), read from `INSTANTCOFFEE_OBSERVE_*` variables; [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#environment-variables) has the full table. The ones you are most likely to set:

| Variable | Default | Purpose |
|----------|---------|---------|
| `INSTANTCOFFEE_OBSERVE_SERVER_PORT` | `4981` | API + UI port |
| `INSTANTCOFFEE_OBSERVE_PI_HOMES` | `$HOME` | pi homes (comma-separated) — transcripts, context files, agent definitions |
| `INSTANTCOFFEE_OBSERVE_LLAMA_URL` / `_FORGE_URL` | `:8080` / `:8081` on the host | Inference-stack endpoints |
| `INSTANTCOFFEE_OBSERVE_STACK_POLL_MS` | `5000` | Stack poll interval (`0` disables) |
| `INSTANTCOFFEE_OBSERVE_TRANSCRIPT_STATS` | `1` | Session stats (`0` disables) |
| `INSTANTCOFFEE_OBSERVE_INSTRUCTIONS` | `1` | Instructions browser/editor (`0` disables) |

### Host mounts (Docker)

pi reports absolute paths (`transcript_path`, `cwd`), so each pi home is mounted at the **same absolute path** it has for pi — no host/container translation:

- `INSTANTCOFFEE_OBSERVE_PI_HOME_HOST` → `INSTANTCOFFEE_OBSERVE_PI_HOME` — the host pi's home (read-write, for the Instructions editor; writes are allowlisted).
- `INSTANTCOFFEE_OBSERVE_PI_CONTAINER_HOME_HOST` → `/home/piuser` — the home of instantcoffee's containerised pi (`scripts/pi-container.sh`); point it at the same directory as instantcoffee's `PI_CONTAINER_HOME_HOST`.
- `INSTANTCOFFEE_OBSERVE_DATA_DIR` → `/data` — the database and the models.dev pricing cache.

On Docker Desktop under WSL, mount sources must be Windows-side paths (`//c/...`); a WSL path silently mounts an empty directory.

## API

| Endpoint | Description |
|----------|-------------|
| `POST /api/events` | Event ingestion (the pi extension posts here) |
| `GET  /api/sessions/recent` | Recent sessions with token rollups |
| `GET  /api/sessions/:id` · `/agents` · `/events` | Session detail, agent tree, events |
| `GET  /api/sessions/:id/context[?agent=]` | Per-turn context attribution for one agent's window |
| `GET  /api/sessions/:id/transcript-stats` | Per-prompt / per-model tokens and cost from pi's transcript |
| `GET  /api/stack` | Inference-stack status, totals and the last hour of samples |
| `GET  /api/instructions/stores` · `/stores/:id/files` · `/stores/:id/file` · `/graph` · `/search` | Instructions browser (PUT/POST/DELETE on `/file` to edit) |
| `GET  /api/health` | Liveness, version, runtime |
| `WS   /api/events/stream` | Live events, session updates, notifications, stack samples |

## Local development

```bash
just install   # install server + client deps
just dev       # hot reload — API on :4981, Vite client on :5174
just check     # tests + server typecheck + format + client build (before every commit)
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the architecture, the protocol fixtures, worktrees and code style.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Events not appearing | `/observe` in pi shows the last delivery error. Check `OBSERVE_URL` in instantcoffee's `.env` and `curl http://127.0.0.1:4981/api/health` |
| Launch banner says `observe (not reachable …)` | The dashboard was down at launch; start it — the extension keeps retrying every ten seconds |
| Session stats say `outside_pi_sessions` | The transcript's pi home isn't in `INSTANTCOFFEE_OBSERVE_PI_HOMES` / mounted |
| Stack page `unreachable` | llama-server isn't at `INSTANTCOFFEE_OBSERVE_LLAMA_URL`, or was started without `--metrics` |
| Stack page `stalled` | llama's task queue is busy or wedged; `/props` still answers when this happens |
| Instructions show no files | The pi home isn't mounted at the path pi uses (see Host mounts) |
| Database issues | Stop the server, then `just db-reset` (writes a `.bak` when `ALLOW_DB_RESET=backup`) |

## Versioning

Date-based `DD.MM.YYYY` plus a short git hash baked into the image; `/api/health` reports both. See [CHANGELOG.md](CHANGELOG.md).

## Contributing

[Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `style:`, `refactor:`, `test:`, `chore:`, `release:`); breaking changes get a `!`. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Acknowledgements

Forked from [simple10/agents-observe](https://github.com/simple10/agents-observe) — itself inspired by [disler/claude-code-hooks-multi-agent-observability](https://github.com/disler/claude-code-hooks-multi-agent-observability) — by way of an OpenClaude-specific fork, and rebuilt around pi and the instantcoffee stack. The Instructions graph view takes after the [brain-map](https://github.com/vladignatyev/brain-map-skill) skill and Obsidian's graph view.

## License

[MIT](LICENSE)
