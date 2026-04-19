# OpenClaude Observe
# Usage: just <recipe>
#
# AGENTS_OBSERVE_SERVER_PORT & AGENTS_OBSERVE_DEV_CLIENT_PORT are read from .env
# to override the defaults (4981 / 5174).

set dotenv-load := true
set export := true
set quiet := true

port := env("AGENTS_OBSERVE_SERVER_PORT", "4981")
dev_client_port := env("AGENTS_OBSERVE_DEV_CLIENT_PORT", "5174")
project_root := justfile_directory()
server := project_root / "app" / "server"
client := project_root / "app" / "client"

# List available recipes
default:
    @just --list

# ─── Development ─────────────────────────────────────────

# Install server + client dependencies
install:
    cd {{ server }} && npm install
    cd {{ client }} && npm install

# Start server + client in dev mode (hot reload)
dev:
    AGENTS_OBSERVE_RUNTIME=dev AGENTS_OBSERVE_SHUTDOWN_DELAY_MS=${AGENTS_OBSERVE_SHUTDOWN_DELAY_MS:-0} node {{ project_root }}/start.mjs

# Start server locally without Docker (production-style)
start-local:
    AGENTS_OBSERVE_RUNTIME=local node {{ project_root }}/start.mjs

# ─── Docker ─────────────────────────────────────────────

# Build the Docker image locally
build:
    docker build -t openclaude-observe:local .

# Start server via docker compose
start:
    docker compose up -d openclaude-observe
    @just open

# Stop the docker compose stack
stop:
    docker compose down

# Restart the docker compose stack
restart:
    docker compose restart openclaude-observe

# Follow docker container logs
logs:
    docker compose logs -f openclaude-observe

# ─── Testing ────────────────────────────────────────────

# Run all tests (server + client)
test:
    npm test

# Run tests, format, and rebuild the client (run before every commit)
check:
    npm test
    npm run fmt
    cd app/client && npm install && npm run build

# ─── Database ───────────────────────────────────────────

# Delete the SQLite database (creates a .bak backup if ALLOW_DB_RESET=backup)
db-reset:
    rm -f {{ project_root }}/data/observe.db

# ─── Utilities ──────────────────────────────────────────

# Check server health
health:
    curl -sf http://localhost:{{ port }}/api/health | (command -v jq >/dev/null && jq . || cat)

# Show client bundle size visualizer in browser
bundle-visualizer:
    cd app/client && npx vite-bundle-visualizer

# Format all source files
fmt:
    npm run fmt

# Open the dashboard in browser
open port=port:
    open http://localhost:{{ port }}

# ─── Release ────────────────────────────────────────────

# Tag and push a release (bumps version, builds, tags, pushes)
release:
    {{ project_root }}/scripts/release.sh
