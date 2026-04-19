# OpenClaude Observe

Real-time observability dashboard for OpenClaude. Receives OTel trace events via native in-process integration — LLM calls, tool executions, agent hierarchy, and multi-instance topology (daemon, pipes, coordinator, bridge).

## Quick Start

```bash
docker compose up openclaude-observe
# Dashboard at http://localhost:4981
# Set CLAUDE_OBSERVE_URL=http://localhost:4981 in OpenClaude
```

Restart your OpenClaude session. Events stream in automatically — no plugin, no hook scripts, no MCP server.

### Just recipes

| Command | Description |
|---------|-------------|
| `just start` | Start the server via docker compose |
| `just stop` | Stop the server |
| `just restart` | Restart the server |
| `just logs` | Tail container logs |
| `just health` | Hit `/api/health` |
| `just dev` | Hot-reload dev mode |

Run `just --list` for the full set.

## Clone & Run

Requires [just](https://github.com/casey/just), [Node.js](https://nodejs.org/), and [Docker](https://www.docker.com/).

```bash
git clone https://github.com/coffeegrind123/openclaude-observe.git
cd openclaude-observe
just install   # install dependencies
just start     # start server via Docker
```

Dashboard: http://localhost:4981

For dev mode with hot reload: `just dev` (client at http://localhost:5174, API at http://localhost:4981).

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Server not running | `just start` |
| Docker not running | Start Docker Desktop, then `just start` |
| Port conflict | Set `AGENTS_OBSERVE_SERVER_PORT=<port>` in `.env` |
| Need diagnostics | `just logs` and `just health` |
| Database issues | `just db-reset` |

## Development

**Before developing features or modifying code, read [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).** It covers architecture, project structure, commands (`just dev`, `just test`, etc.), environment variables, worktree setup, code style, and testing.

Key points:
- Use `just dev` for hot-reload development
- **Run `just check` before every commit** — runs all tests + formatting
- Use `just` commands for all dev tasks (not `npm` directly) — see `just --list`
- Worktrees need a `.env` with unique ports (see DEVELOPMENT.md § Worktrees)
- All server env vars are centralized in `app/server/src/config.ts` — never read `process.env` elsewhere
- TypeScript throughout, kebab-case file names

## Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org/) for all commit messages. The release script uses `git log` to generate CHANGELOG.md entries via Claude, and consistent prefixes help it categorize changes accurately.

**Format:** `<type>: <description>`

| Prefix | Use for |
|--------|---------|
| `feat:` | New features or capabilities |
| `fix:` | Bug fixes |
| `docs:` | Documentation changes |
| `style:` | CSS, formatting, visual changes (no logic change) |
| `refactor:` | Code restructuring (no behavior change) |
| `test:` | Adding or updating tests |
| `chore:` | Build scripts, tooling, dependencies, config |
| `release:` | Version bumps (used by `scripts/release.sh`) |

**Examples:**
```
feat: add X button to clear search query
fix: timeline dots animating at different speeds
style: add cursor-pointer to clickable sidebar elements
refactor: replace per-dot transitions with container animation
chore: update release script with changelog generation
docs: document fresh install test harness usage
```

Breaking changes: add `!` after the type (e.g., `feat!: rename config namespace`).
