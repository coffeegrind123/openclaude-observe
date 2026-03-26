# Claude Observe Plugin Plan

## Goal

Convert the current `app/` (hooks, server, client) into a distributable Claude Code plugin that auto-installs hooks and runs the dashboard as a persistent background daemon.

## Current State

```
app/
  hooks/send_event.mjs       # Hook script (dumb pipe + two-way commands)
  server/                     # Bun server (SQLite, REST API, WebSocket)
  client/                     # React 19 + shadcn dashboard
```

Currently requires manual setup:
- Copy hook config into `.claude/settings.json`
- Set env vars (`CLAUDE_OBSERVE_PROJECT_NAME`, `CLAUDE_OBSERVE_PORT`)
- Manually start server + client

## Target State

```
claude-observe-plugin/
  .claude-plugin/
    plugin.json               # Manifest with name, version, env vars
  hooks/
    hooks.json                # Auto-installed hooks
  scripts/
    send_event.mjs            # Hook script (moved from app/hooks/)
    ensure-daemon.sh          # Ensures server+client are running
    stop-daemon.sh            # Stops the daemon
    status.sh                 # Check if daemon is running
  app/
    server/                   # Bun server (unchanged)
    client/                   # React client (pre-built for prod)
  README.md
```

Install: `claude plugin install claude-observe` (or local dev: `claude --plugin-dir ./claude-observe-plugin`)
Result: hooks auto-active, dashboard auto-starts, zero config.

---

## Architecture Decisions

### Daemon Model

The server + client run as a **persistent background daemon** that:
- Starts on first SessionStart hook (if not already running)
- Survives across sessions (doesn't stop when a session ends)
- Stores data in `${CLAUDE_PLUGIN_DATA}/observe.db` (persistent across plugin updates)
- Can be manually stopped via `scripts/stop-daemon.sh`

### Build Strategy

Two options for the client:

**Option A: Pre-built static assets (recommended)**
- Run `vite build` at plugin build/publish time
- Server serves the static `dist/` directory
- Single port (server serves both API and client)
- No need for Node/npm at runtime — just Bun

**Option B: Dev server at runtime**
- Run Vite dev server alongside Bun server
- Two ports (4001 + 5174)
- Requires npm/node at runtime
- Hot reload for development

**Recommendation: Option A for the plugin, Option B stays available for development.**

Merging to a single port means the server serves the built client at `/` and the API at `/api/*`. This simplifies everything — one process, one port, no proxy config.

### Port Selection

- Default: `4001`
- Configurable via env var `CLAUDE_OBSERVE_PORT`
- The daemon script should detect port conflicts and log errors

### Project Name

- Default: derived from the project directory name (e.g., `my-project`)
- Override via env var `CLAUDE_OBSERVE_PROJECT_NAME`
- The hook script reads this at runtime, so different projects get different names automatically

---

## Implementation Tasks

### Task 1: Plugin Manifest + Hooks Config

**Files to create:**
- `claude-observe-plugin/.claude-plugin/plugin.json`
- `claude-observe-plugin/hooks/hooks.json`

**plugin.json:**
```json
{
  "name": "claude-observe",
  "description": "Multi-agent observability dashboard. Auto-captures hook events and streams them to a live dashboard.",
  "version": "1.0.0",
  "author": {
    "name": "Opik"
  },
  "env": {
    "CLAUDE_OBSERVE_PORT": "4001"
  }
}
```

Note: `CLAUDE_OBSERVE_PROJECT_NAME` is NOT set in plugin.json — it should default to the project directory name at runtime (derived in `send_event.mjs`).

**hooks.json:**
```json
{
  "hooks": {
    "PreToolUse": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/scripts/send_event.mjs" }] }],
    "PostToolUse": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/scripts/send_event.mjs" }] }],
    "Stop": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/scripts/send_event.mjs" }] }],
    "UserPromptSubmit": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/scripts/send_event.mjs" }] }],
    "SessionStart": [
      { "matcher": "", "hooks": [
        { "type": "command", "command": "bash ${CLAUDE_PLUGIN_ROOT}/scripts/ensure-daemon.sh" },
        { "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/scripts/send_event.mjs" }
      ]}
    ],
    "SubagentStop": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/scripts/send_event.mjs" }] }]
  }
}
```

SessionStart has two hooks: first ensures the daemon is running, then sends the event.

---

### Task 2: Daemon Management Scripts

**`scripts/ensure-daemon.sh`:**
- Check if server is already running (curl health check or PID file)
- If not running:
  - Start `bun app/server/src/index.ts` in background
  - Save PID to `${CLAUDE_PLUGIN_DATA}/daemon.pid`
  - Wait for server to be ready (poll health endpoint)
  - Log startup to `${CLAUDE_PLUGIN_DATA}/daemon.log`
- If already running: exit silently (fast path — don't slow down hooks)
- Must complete quickly (<2s) to not block the agent

**`scripts/stop-daemon.sh`:**
- Read PID from `${CLAUDE_PLUGIN_DATA}/daemon.pid`
- Kill the process
- Clean up PID file

**`scripts/status.sh`:**
- Check if daemon is running
- Print status + URL

---

### Task 3: Modify Server to Serve Static Client

**Files to modify:**
- `app/server/src/index.ts`

Add static file serving for the built client:
```typescript
// Serve static files from client/dist/ for non-API routes
if (!url.pathname.startsWith('/api/')) {
  const filePath = `${__dirname}/../../client/dist${url.pathname === '/' ? '/index.html' : url.pathname}`
  const file = Bun.file(filePath)
  if (await file.exists()) {
    return new Response(file)
  }
  // SPA fallback — serve index.html for client-side routes
  return new Response(Bun.file(`${__dirname}/../../client/dist/index.html`))
}
```

Update the DB path to use `${CLAUDE_PLUGIN_DATA}` when available:
```typescript
const dbPath = process.env.CLAUDE_PLUGIN_DATA
  ? `${process.env.CLAUDE_PLUGIN_DATA}/observe.db`
  : process.env.DB_PATH || 'observe.db'
```

---

### Task 4: Modify Hook Script for Plugin Context

**`scripts/send_event.mjs`** (moved from `app/hooks/send_event.mjs`):

Changes:
- Default `CLAUDE_OBSERVE_PROJECT_NAME` to the basename of `cwd` from the hook payload (no env var needed)
- Read port from `CLAUDE_OBSERVE_PORT` env (set by plugin.json)
- Use `${CLAUDE_PLUGIN_ROOT}` awareness — the script runs from the plugin dir

```javascript
// If no explicit project name, derive from cwd in the payload
if (!projectName && payload.cwd) {
  projectName = payload.cwd.split('/').pop() || 'unknown'
}
```

---

### Task 5: Build Step for Client

**Add to client package.json:**
```json
{
  "scripts": {
    "build": "vite build"
  }
}
```

**Update vite.config.ts:**
- Remove the dev proxy (not needed when server serves client)
- Set `base: '/'` for clean paths

**Build output:** `app/client/dist/` — committed to the plugin repo (or built during plugin install via a postinstall script).

**Decision: pre-build and commit `dist/`?**
- Pro: No build step at install time, works immediately
- Con: Binary files in git, larger repo
- Alternative: `postinstall` script in plugin.json runs `cd app/client && npm install && npm run build`

Recommendation: Use a postinstall build script. Keeps the repo clean.

---

### Task 6: Update Client Config for Single-Port

**`app/client/src/config/api.ts`:**
```typescript
// In plugin mode, API and client are on the same port
export const API_BASE = '/api'
export const WS_URL = `ws://${window.location.host}/api/events/stream`
```

No more special dev vs prod logic — both use relative paths.

---

### Task 7: Plugin README

Create a README with:
- What it does (auto-captures Claude Code events, live dashboard)
- Installation (`claude plugin install claude-observe`)
- Configuration (optional env var overrides)
- Dashboard URL (`http://localhost:4001`)
- How to stop the daemon
- Screenshots

---

### Task 8: Development Workflow

Keep the current dev setup working alongside the plugin:
- `just dev` — runs server + client in dev mode (hot reload, two ports)
- Plugin mode — pre-built client, single port, daemon

The plugin dir can be the repo root — just add `.claude-plugin/` and `hooks/` at the top level. The `app/` directory stays where it is.

---

## File Mapping: Current → Plugin

```
Current                          Plugin
─────────────────────────────────────────────────────
app/hooks/send_event.mjs     →  scripts/send_event.mjs
app/server/                  →  app/server/ (unchanged)
app/client/                  →  app/client/ (+ dist/ for built assets)
.claude/settings.json        →  hooks/hooks.json (auto-installed)
docker-compose.yml           →  kept for Docker users (optional)
justfile                     →  kept for dev workflow
(new)                        →  .claude-plugin/plugin.json
(new)                        →  scripts/ensure-daemon.sh
(new)                        →  scripts/stop-daemon.sh
(new)                        →  scripts/status.sh
```

---

## Migration Path

1. Add plugin files alongside existing structure (non-breaking)
2. Test with `claude --plugin-dir .`
3. Verify hooks auto-install and daemon starts
4. Remove manual `.claude/settings.json` hooks (plugin handles them)
5. Publish to marketplace

---

## Open Questions

1. **Pre-build vs postinstall?** — Should we commit `dist/` or run `npm run build` on install?
2. **Port conflicts** — What if 4001 is in use? Auto-detect next available port?
3. **Multi-project** — When the plugin is installed globally, it runs across all projects. Should the daemon be per-project or shared? (Shared is simpler — one server, all projects send to it.)
4. **Daemon lifecycle** — Should there be an auto-shutdown after inactivity (e.g., 30 min no events)? Or run forever until manually stopped?
5. **Bun dependency** — The server requires Bun. Should we check for it in `ensure-daemon.sh` and provide a helpful error if missing?
