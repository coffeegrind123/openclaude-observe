# Node Port + Storage Abstraction Plan

## Goal

Port the server from Bun to Node.js with a pluggable storage layer and optional WebSocket, making the app deployable to local, VPS, or Cloudflare.

## Current State

```
app/server/ (Bun)
  - bun:sqlite for storage
  - Bun.serve() for HTTP + WebSocket
  - Bun-specific types and test runner

app/client/ (Vite + React)
  - Separate dev server on port 5174
  - Proxies /api to server in dev
```

## Target State

```
app/server/ (Node.js)
  - Pluggable storage adapters (SQLite, D1, Postgres)
  - Express for HTTP
  - Optional WebSocket (ws package, env-toggleable)
  - Polling-capable API (works without WebSocket)
  - Serves built client static files on same port

app/client/ (Vite + React, unchanged)
  - Built to dist/ for production
  - Dev mode still uses Vite proxy
  - WebSocket with automatic fallback to polling
```

---

## Architecture

### Storage Layer

```
storage/
  types.ts              # EventStore interface
  sqlite-adapter.ts     # Local: better-sqlite3
  d1-adapter.ts         # Cloudflare D1 (future stub)
  postgres-adapter.ts   # Postgres (future stub)
  index.ts              # Factory: picks adapter from config
```

**Interface:**

```typescript
interface EventStore {
  // Write
  upsertProject(id: string, name: string): Promise<void>
  upsertSession(id: string, projectId: string, slug: string | null,
    metadata: Record<string, unknown> | null, timestamp: number): Promise<void>
  upsertAgent(id: string, sessionId: string, parentAgentId: string | null,
    slug: string | null, name: string | null, timestamp: number): Promise<void>
  updateAgentStatus(id: string, status: string): Promise<void>
  updateSessionStatus(id: string, status: string): Promise<void>
  updateSessionSlug(sessionId: string, slug: string): Promise<void>
  updateAgentSlug(agentId: string, slug: string): Promise<void>
  insertEvent(event: InsertEventParams): Promise<number>

  // Read
  getProjects(): Promise<Project[]>
  getSessionsForProject(projectId: string): Promise<Session[]>
  getSessionById(sessionId: string): Promise<Session | null>
  getAgentsForSession(sessionId: string): Promise<Agent[]>
  getEventsForSession(sessionId: string, filters?: EventFilters): Promise<StoredEvent[]>
  getEventsForAgent(agentId: string): Promise<StoredEvent[]>
  getThreadForEvent(eventId: number): Promise<StoredEvent[]>
  getEventsSince(sessionId: string, sinceTimestamp: number): Promise<StoredEvent[]>

  // Admin
  clearAllData(): Promise<void>
}
```

All methods are async (Promise-based) even though SQLite is synchronous. This allows D1 and Postgres adapters to work naturally.

### HTTP Layer

Replace Bun.serve() with Express:

```
server/
  src/
    index.ts              # Entry: create app, start server
    app.ts                # Express app factory (testable without listen())
    routes/
      events.ts           # POST /api/events, GET /api/events/:id/thread
      projects.ts         # GET /api/projects
      sessions.ts         # GET /api/sessions/:id, /agents, /events, /metadata
      agents.ts           # GET /api/agents/:id/events, POST /metadata
      admin.ts            # DELETE /api/data
    middleware/
      cors.ts             # CORS headers
    websocket.ts          # Optional ws upgrade handler
    storage/
      types.ts
      sqlite-adapter.ts
      index.ts
    parser.ts             # Unchanged
    types.ts              # Unchanged (mostly)
```

### WebSocket vs Polling

**Env var:** `ENABLE_WEBSOCKET=true` (default: true for local, false for Cloudflare)

**WebSocket mode (default):**
- `ws` package attached to the HTTP server
- `/api/events/stream` upgrade path
- Same broadcast logic as current Bun implementation

**Polling mode:**
- `GET /api/events/poll?since=<timestamp>` returns events newer than timestamp
- Client polls every 2-3 seconds
- No external dependencies, works everywhere (Workers, serverless, etc.)

**Client behavior:**
- Try WebSocket first
- If connection fails or disabled, fall back to polling
- Transparent to the UI: same query invalidation pattern

### Static File Serving

Express serves the built client after all API routes:

```typescript
const distPath = path.join(__dirname, '../../client/dist')
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath))
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'))
  })
}
```

Single port serves everything. Dev mode still uses Vite's proxy.

---

## Implementation Tasks

### Task 1: Storage Interface + SQLite Adapter

**Files to create:**
- `app/server/src/storage/types.ts` - EventStore interface + all param/return types
- `app/server/src/storage/sqlite-adapter.ts` - Implements EventStore using better-sqlite3
- `app/server/src/storage/index.ts` - Factory that creates the adapter from env/config

Extract all DB logic from current db.ts into the SQLite adapter. All methods return Promises (wrap sync better-sqlite3 calls). Same SQL queries, swap bun:sqlite for better-sqlite3.

**better-sqlite3 differences from bun:sqlite:**
- `new Database(path)` - same
- `db.prepare(sql).run(...)` - same API
- `db.prepare(sql).all(...)` - same API
- `db.prepare(sql).get(...)` - same API
- `db.pragma('journal_mode = WAL')` instead of `db.exec('PRAGMA ...')`

---

### Task 2: Express HTTP Server

**Files to create:**
- `app/server/src/app.ts` - Express app factory
- `app/server/src/routes/events.ts`
- `app/server/src/routes/projects.ts`
- `app/server/src/routes/sessions.ts`
- `app/server/src/routes/agents.ts`
- `app/server/src/routes/admin.ts`
- `app/server/src/middleware/cors.ts`
- `app/server/src/index.ts` - Entry point

**Files to delete:**
- `app/server/src/db.ts` (replaced by storage layer)

Each route file exports an Express Router. Routes call `store.method()` instead of direct DB functions. Same URL patterns and response shapes.

**package.json changes:**
- Remove: `bun-types`, `@types/bun`
- Add: `express`, `better-sqlite3`, `ws`, `tsx`
- Add: `@types/express`, `@types/better-sqlite3`, `@types/ws`
- Scripts: `"dev": "tsx watch src/index.ts"`, `"start": "tsx src/index.ts"`

---

### Task 3: WebSocket Layer (Optional)

**File to create:**
- `app/server/src/websocket.ts` - Rewrite using ws package

Attach to the HTTP server. Same addClient/removeClient/broadcast API. Enabled by `ENABLE_WEBSOCKET` env var (default: true).

---

### Task 4: Polling Endpoint

**File to create:**
- `app/server/src/routes/poll.ts`

**Endpoint:** `GET /api/events/poll?session_id=<id>&since=<timestamp>`

Returns events newer than `since` for the given session. Client polls every 2-3 seconds when WebSocket is unavailable.

**Storage interface addition:**
```typescript
getEventsSince(sessionId: string, sinceTimestamp: number): Promise<StoredEvent[]>
```

---

### Task 5: Client WebSocket to Polling Fallback

**File to modify:**
- `app/client/src/hooks/use-websocket.ts`

Try WebSocket connection. If it fails, switch to polling mode (setInterval calling /api/events/poll). Both paths invalidate the same TanStack Query caches. Transparent to the rest of the app.

---

### Task 6: Static File Serving + Client Config

**Server:** Add express.static for client/dist/ after all API routes, with SPA fallback to index.html.

**Client config simplification:**
```typescript
export const API_BASE = '/api'
export const WS_URL = `ws://${window.location.host}/api/events/stream`
```

No more dev vs prod branching. Vite proxy handles dev mode.

---

### Task 7: Update Build + Docker

**Dockerfile:** Single stage, Node 22, install deps, build client, run server. One port, no Bun.

**docker-compose.yml:** Single service, single port, ENABLE_WEBSOCKET env var.

---

### Task 8: Port Tests to Vitest

Replace bun:test with vitest. Same test logic, vitest syntax (almost API-compatible).

---

### Task 9: D1 Adapter Stub

Stub implementation with the EventStore interface. Same SQL as SQLite (D1 is SQLite-compatible). Not functional yet, just proves the adapter pattern works.

---

## Migration Checklist

1. Create branch `chore/node-port`
2. Implement storage interface + SQLite adapter (Task 1)
3. Port HTTP server to Express (Task 2)
4. Port WebSocket to ws package (Task 3)
5. Add polling endpoint (Task 4)
6. Client WS fallback to polling (Task 5)
7. Add static file serving (Task 6)
8. Update build + Docker (Task 7)
9. Port tests to vitest (Task 8)
10. Add D1 adapter stub (Task 9)
11. Verify: `npm start` serves everything on one port
12. Verify: hooks still work end-to-end
13. Verify: Docker build works
14. Verify: dev mode still works (Vite proxy)
15. Delete Bun-specific files (bun.lock, bun-types)
16. Merge to main

## New Dependencies

```
express           # HTTP framework
better-sqlite3    # SQLite driver (native)
ws                # WebSocket server
tsx               # TypeScript execution for Node
vitest            # Test runner

@types/express
@types/better-sqlite3
@types/ws
```

## Open Questions

1. **tsx vs ts-node vs esbuild?** tsx is simplest (no config). For production, could pre-compile with tsc or esbuild.
2. **Express vs Hono?** Hono is lighter and runs on Cloudflare Workers natively. Express is more familiar. Could use Hono for easier Cloudflare deployment.
3. **SSE vs polling?** SSE (Server-Sent Events) is a middle ground between WebSocket and polling. Works in Cloudflare Workers. Could add as a third transport option.
