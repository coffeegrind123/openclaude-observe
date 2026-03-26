# Claude Observe - Multi-Agent Observability
# Usage: just <recipe>

set dotenv-load
set quiet

port := env("SERVER_PORT", "4001")
project_root := justfile_directory()

# List available recipes
default:
    @just --list

# ─── Docker ─────────────────────────────────────────────

# Start production containers (detached)
start:
    @mkdir -p {{project_root}}/data
    @docker compose down >/dev/null 2>&1 || true
    docker compose up -d --build
    @echo ""
    @echo "Waiting for server..."
    @for i in $(seq 1 15); do \
      if curl -sf http://localhost:{{port}}/api/projects >/dev/null 2>&1; then \
        echo "Ready: http://localhost:{{port}}"; \
        break; \
      fi; \
      sleep 1; \
    done

# Stop containers
stop:
    docker compose down

# Restart containers
restart: stop start

# View container logs (follow)
logs:
    docker compose logs -f

# ─── Development ─────────────────────────────────────────

# Start server + client in dev mode (hot reload)
dev:
    @echo "Starting dev server + client..."
    @echo "Server: http://localhost:{{port}}"
    @echo "Client: http://localhost:5174 (Vite dev)"
    @echo ""
    cd {{project_root}}/app/server && npx tsx watch src/index.ts &
    cd {{project_root}}/app/client && npm run dev &
    @wait

# Start only the server (dev mode with hot reload)
dev-server:
    cd {{project_root}}/app/server && npx tsx watch src/index.ts

# Start only the client (Vite dev server)
dev-client:
    cd {{project_root}}/app/client && npm run dev

# Build the client for production
build:
    cd {{project_root}}/app/client && npm run build

# Run server tests
test:
    cd {{project_root}}/app/server && npx vitest run

# Run server tests in watch mode
test-watch:
    cd {{project_root}}/app/server && npx vitest

# ─── Database ────────────────────────────────────────────

# Delete the events database
db-reset:
    rm -f {{project_root}}/data/observe.db {{project_root}}/data/observe.db-wal {{project_root}}/data/observe.db-shm
    rm -f {{project_root}}/app/server/observe.db {{project_root}}/app/server/observe.db-wal {{project_root}}/app/server/observe.db-shm
    @echo "Database reset"

# ─── Utilities ───────────────────────────────────────────

# Send a test event to the server
test-event:
    @echo '{"session_id":"test-1234","hook_event_name":"SessionStart","cwd":"/tmp","source":"new"}' \
      | CLAUDE_OBSERVE_PROJECT_NAME=test-project CLAUDE_OBSERVE_PORT={{port}} node {{project_root}}/app/hooks/send_event.mjs
    @echo "Event sent"

# Check server health
health:
    @curl -sf http://localhost:{{port}}/api/projects > /dev/null 2>&1 \
      && echo "Server: UP (http://localhost:{{port}})" \
      || echo "Server: DOWN (port {{port}})"

# Open the dashboard in browser
open:
    open http://localhost:{{port}}

# Format all source files
fmt:
    npx prettier --write "app/**/*.{ts,tsx,mjs}"

# Install all dependencies
install:
    cd {{project_root}}/app/server && npm install
    cd {{project_root}}/app/client && npm install
