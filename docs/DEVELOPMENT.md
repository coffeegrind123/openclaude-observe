# Development Guide

Detailed reference for developing instantcoffee-observe locally. For the quick start, see [../CLAUDE.md](../CLAUDE.md).

## Architecture

```
pi (instantcoffee)                          instantcoffee-observe
  .pi/extensions/observe ── POST /api/events ──► parser → SQLite ──► WebSocket ──► React dashboard
                                                                        ▲
  llama-server :8080  ◄── GET /metrics  ─────── stack poller ────────────┘  (stack_metrics)
  forge        :8081  ◄── GET /forge/usage ─┘
```

- **pi extension** — lives in instantcoffee (`.pi/extensions/observe/`), loaded by `scripts/pi-local.sh` in the top-level session and, through `SUBAGENT_EXTRA_EXTENSIONS`, in every subagent. It maps pi's extension events to the envelope in [pi-protocol.md](pi-protocol.md) and resolves subagent → spawning-call linkage itself, since pi exposes none.
- **Server** (`app/server/`) — Hono + better-sqlite3 + native `ws`. `parser.ts` maps envelopes to events; `routes/events.ts` upserts sessions and the agent tree from the explicit agent fields.
- **Stack poller** (`services/stack-metrics.ts`) — diffs llama's cumulative Prometheus counters into per-interval decode/prefill speed, draft acceptance and cache reuse, plus forge's context fill; one hour of history, live over the WebSocket.
- **Client** (`app/client/`) — React 19 + shadcn "Stream" dashboard.

`app/server/src/routes/__fixtures__/pi-envelopes.jsonl` is the exact output of the extension replaying a real captured pi session; `events.pi.test.ts` runs it through the real parser, route and store. Regenerate it from the extension's replay fixture whenever the protocol changes.

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
app/server/        # Hono server, SQLite, WebSocket, pi event parser, stack poller
app/client/        # React 19 + shadcn dashboard
scripts/           # Release tooling and changelog generator
docs/              # This file and demo assets
Dockerfile         # Production container image
docker-compose.yml # Primary run path — `docker compose up instantcoffee-observe`
justfile           # Task runner commands
start.mjs          # Local server entrypoint (non-Docker) — used by `just dev` / `just start-local`
```

## Environment Variables

Server config is centralized in `app/server/src/config.ts`. Every var below is
consumed there, except those marked _(compose only)_, which `docker-compose.yml`
reads.

| Variable | Default | Description |
|----------|---------|-------------|
| `INSTANTCOFFEE_OBSERVE_SERVER_PORT` | `4981` | Server port (dev + Docker) |
| `INSTANTCOFFEE_OBSERVE_SERVER_HOST` | `127.0.0.1` | Interface the server listens on. An IPv4 literal on purpose: `localhost` can bind IPv6-only and refuse Node clients |
| `INSTANTCOFFEE_OBSERVE_BIND` | `127.0.0.1` | _(compose only)_ host interface the port is published on |
| `INSTANTCOFFEE_OBSERVE_CORS_ORIGINS` | (loopback) | Browser origin allowlist for HTTP and WebSocket; `*` allows any |
| `INSTANTCOFFEE_OBSERVE_DEV_CLIENT_PORT` | `5174` | Vite dev client port |
| `INSTANTCOFFEE_OBSERVE_RUNTIME` | `docker` | Runtime mode: `docker`, `local`, or `dev` |
| `INSTANTCOFFEE_OBSERVE_LOG_LEVEL` | `warn` | `warn`, `debug`, or `trace` |
| `INSTANTCOFFEE_OBSERVE_DB_PATH` | `data/observe.db` | SQLite database path |
| `INSTANTCOFFEE_OBSERVE_DATA_DIR` | `./data` | _(compose only)_ host dir bind-mounted to `/data`. The server never reads it; the models.dev pricing cache sits next to the DB |
| `INSTANTCOFFEE_OBSERVE_ALLOW_DB_RESET` | `backup` | DB reset policy: `allow`, `backup`, or `deny` |
| `INSTANTCOFFEE_OBSERVE_CLIENT_DIST_PATH` | (auto) | Override the client dist directory |
| `INSTANTCOFFEE_OBSERVE_STORAGE_ADAPTER` | `sqlite` | Storage backend |
| `INSTANTCOFFEE_OBSERVE_NOTIFICATION_ON_EVENTS` | `Notification` | Comma-separated event names that raise a sidebar/desktop notification (e.g. `Notification,Stop,SubagentStop`). The bell stays lit until the agent that raised it produces another event; a `SubagentStart`/`SubagentStop` hands that to the parent |
| `INSTANTCOFFEE_OBSERVE_PI_HOMES` | `$HOME` | Comma-separated pi homes. Their `.pi/agent/sessions` are the only transcripts the server will read; their `.pi/agent` holds the context files and subagent definitions the Instructions editor edits |
| `INSTANTCOFFEE_OBSERVE_TRANSCRIPT_STATS` | `1` | Session stats parsed from pi transcripts; `0` disables |
| `INSTANTCOFFEE_OBSERVE_INSTRUCTIONS` | `1` | Instructions browser/editor; `0` disables |
| `INSTANTCOFFEE_OBSERVE_LLAMA_URL` | `http://127.0.0.1:8080` (`host.docker.internal` in docker) | llama-server for `/metrics` |
| `INSTANTCOFFEE_OBSERVE_FORGE_URL` | `http://127.0.0.1:8081` (`host.docker.internal` in docker) | forge for `/forge/usage` |
| `INSTANTCOFFEE_OBSERVE_STACK_POLL_MS` | `5000` | Stack poll interval; `0` disables |
| `INSTANTCOFFEE_OBSERVE_PI_HOME` / `_PI_HOME_HOST` | `$HOME` | _(compose only)_ the host pi's home: path as pi reports it / mount source |
| `INSTANTCOFFEE_OBSERVE_PI_CONTAINER_HOME` / `_PI_CONTAINER_HOME_HOST` | `/home/piuser` / placeholder | _(compose only)_ the containerised pi's home (instantcoffee `pi-container.sh`) |
| `INSTANTCOFFEE_OBSERVE_HOST_DB_PATH` | `$INSTANTCOFFEE_OBSERVE_DATA_DIR/observe.db` | _(compose sets it)_ DB path the dashboard shows; passed through verbatim (may be a Windows path) |
| `INSTANTCOFFEE_OBSERVE_DATA_MOUNT_OPTS` / `_PI_HOME_MOUNT_OPTS` | `rw` | _(compose only)_ bind-mount options for `/data` / the pi homes. `rw,z` on SELinux hosts; `z` on a pi home relabels that whole home |
| `INSTANTCOFFEE_OBSERVE_MAX_IMAGE_DATA_CHARS` | `1024` | Base64 image runs (data URIs, image blocks) longer than this are redacted at ingestion; `0` disables |

pi homes are mounted at the **same absolute path** pi uses, so `transcript_path`
and `cwd` values in events resolve inside the container unchanged — there is no
host/container path translation. On Docker Desktop under WSL the mount sources
must be Windows-side paths (`//c/...`); a WSL path mounts an empty view.

## Instructions browser

The **Instructions** sidebar tab browses and edits what pi puts in every
request: context files (`AGENTS.md`, `CLAUDE.md`, `AGENTS.override.md`),
`SYSTEM.md` / `APPEND_SYSTEM.md`, and pi-subagents-lite agent definitions
(`agents/*.md`) — per pi home (`home:<i>`, `home-agents:<i>`) and per project
(`project:<id>`, from the project's cwd). See `services/instructions-*.ts` and
`components/instructions/`.

- It follows pi's loader: one context file per directory (the first of
  `AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, `CLAUDE.MD`),
  collected from every directory down to cwd; a project's `.pi/SYSTEM.md`
  replaces the home's, and only when pi trusts the project.
- Every file shows an estimated token cost (chars/4) and the per-home effective
  context total, because that cost is paid on every request.
- Writes are confined to an allowlist of instruction-file paths per store and
  go through temp-file-then-rename.

## Inference stack page

The **Stack** page (sidebar footer strip, or `#/stack`) shows the last hour of
llama-server and forge metrics: decode and prefill speed (busy-time rates, not
wall averages), draft acceptance and acceptance by draft position, prompt-cache
reuse, and context fill. State `stalled` means llama accepted the connection but
`/metrics` did not answer in time — its task queue is busy or wedged.

## Worktrees

When using git worktrees for parallel development, each worktree needs its own ports to avoid conflicts.

Create a `.env` in the worktree root:

```bash
INSTANTCOFFEE_OBSERVE_SERVER_PORT=4982
INSTANTCOFFEE_OBSERVE_DEV_CLIENT_PORT=5179
```

Pick any unused ports — don't collide with the main checkout (4981/5174) or other worktrees. The `.env` is gitignored. The justfile loads it automatically.

### Merging worktrees

Always merge main into the worktree first, test there, then merge back:

```bash
# From the worktree
git merge main           # bring in latest main changes
just test                # verify everything works together

# Then merge back
git checkout main
git merge --squash <branch>    # default: squash into one commit
git commit -m "feat: description of the feature"
```

Main should never be the first place where two branches meet — surface conflicts in the worktree where you can test them.

**Before merging, analyze the branch and recommend squash vs regular merge.** Run `git log --oneline main..<branch>` and assess:

1. **How many commits?** And are they independently meaningful, or development iteration (feat → fix typo → refactor → fix tests)?
2. **Would anyone ever revert a single commit independently?** If not, they should be squashed together.
3. **Is there a logical multi-step progression?** (e.g., "add config" → "add CLI" → "add UI" → "add tests" where each is a complete unit)
4. **How many files changed?** A squash of 5 files is easy to review; a squash of 30 files across unrelated areas might benefit from keeping commits.

Present the analysis with a clear recommendation and let the user decide.

**Default to squash merge.** Most branches are single-purpose feature work where the individual development commits (WIP, fix typo, try again) aren't meaningful history. One clean commit on main is easier to bisect, revert, and read in `git log`.

**Use a regular merge (`git merge <branch>`) when:**
- The branch has multiple logical steps that are each independently meaningful and potentially revertable
- The branch is a large refactor touching many files — keeping commits lets reviewers see the progression
- The branch commits have already been reviewed individually (e.g., PR with per-commit feedback)

## Timeline rendering perf

The activity timeline (`app/client/src/components/timeline/`) is the most performance-sensitive part of the client. On large sessions (5k+ historical events) it's trivially easy to regress live-mode CPU from ~10% to 100%+ with a small, innocent-looking change. **Profile CPU (DevTools Performance → record ~5s in live mode) on a busy session before committing any change to `activity-timeline.tsx`, `agent-lane.tsx`, `agent-label.tsx`, or anything they import.**

The two files have big banner comments at the top listing the specific gotchas; this section gives the why.

### Why it's fragile

`DotContainer` uses the Web Animations API to translate hundreds of event dots continuously. When everything is set up correctly the animation runs entirely on the compositor thread (GPU) and costs near-zero CPU. When something trips up layer promotion, the browser silently falls back to repainting the layer on the main thread every frame — that's the 100%+ CPU regression.

### Common traps

- **Opacity anywhere near the animating container.** Any `opacity < 1` (or `filter`, `backdrop-filter`, etc.) on a sibling or ancestor of `DotContainer` can cause the browser to merge their compositor layers. The AgentLane row uses absolute-positioned siblings (not a flex row) specifically so the name button's opacity stays isolated from the dots wrapper. Don't put both in the same flex cell.

- **Siblings inside the dots wrapper.** Tick marks live in their own absolute-positioned wrapper so `DotContainer` is the only child of its parent. Adding anything else to the dots wrapper forces the compositor to synchronize multiple layers per frame.

- **`visibility: hidden` instead of `display: none` on animated elements.** `visibility: hidden` keeps the CSS animation timeline running and any `will-change` layer allocated. Use `display: none` for anything that should truly go dormant between uses (see the Live/Rewind transition spinner).

- **Memoizing a slice that depends on `Date.now()`.** The `visibleEvents` computation in AgentLane is intentionally NOT memoized because its cutoff depends on wall-clock time. Memoizing it on `[events, rangeMs]` creates a classic stale-state bug: events age out of view but the slice stays non-empty, so `DotContainer` stays mounted and its Web Animation loops forever with nothing visible on screen.

- **Per-dot Radix Tooltips.** One shared Tooltip per lane with a moving anchor span is cheaper than N Tooltip context providers. The dot hover state is tracked in plain React state.

- **Missing React.memo on dot/agent rendering.** `useEffectiveEvents` returns a new array every WS flush and `useAgents` rebuilds Agent objects every flush, even when nothing in a lane has changed. `DotContainer` (length + trailing event id) and `AgentLabel` (agent field comparison) both need content-aware `React.memo` to skip unnecessary re-renders.

### When profiling

Look at the Performance flame graph:

- **"Composite Layers" dominant** → GPU path is working. CPU should be single digits.
- **"Paint" or "Layout" repeating every frame** → the compositor fell back to CPU rasterization. Something broke layer promotion.
- **`setAnchorTime` firing more than once per `rangeMs`** → the animation re-start loop is running too hot.
- **Live mode CPU similar with and without dots visible** → good sign; the animation alone shouldn't cost much.

## Code Style

- TypeScript throughout, avoid `any`
- Run `just check` before committing (runs all tests + Prettier)
- Hook scripts are dependency-free (Node.js built-ins only)
- Use kebab-case for file names
- Use [Conventional Commits](https://www.conventionalcommits.org/) — see [CLAUDE.md](../CLAUDE.md) for prefixes

## Releasing

```bash
scripts/release.sh <version>        # full release
scripts/release.sh --dry-run <version>  # test without committing
```

The release script generates a CHANGELOG.md entry via Claude, opens it in your editor for review, runs tests, builds the Docker image, runs the fresh install test harness, then commits, tags, and pushes. GitHub Actions builds the multi-arch image and creates the release.

## Testing

**Before committing, always run `just check` from the project root.** This runs all tests and formats code. Do not skip this step or guess at which test commands to run in which directories.

```bash
just check                          # tests + format — run before every commit
just test                           # all tests only
just fmt                            # format only
```

Fresh install test harness (requires Docker + OAuth token in `.env`):

```bash
scripts/test-fresh-install.sh
```

See [test/fresh-install/README.md](../test/fresh-install/README.md) for details.
