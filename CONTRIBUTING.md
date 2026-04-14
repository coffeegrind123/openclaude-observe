# Contributing to OpenClaude Observe

Thanks for your interest in contributing!

## Getting started

1. Fork the repo and clone it
2. Run `just install` to install dependencies
3. Run `just dev` to start the dev server
4. Make your changes
5. Run `just test` to make sure tests pass
6. Run `just fmt` to format your code
7. Open a pull request

## Project layout

- `app/server/` — Hono server with SQLite storage and WebSocket
- `app/client/` — React 19 dashboard with shadcn/ui
- `scripts/` — Release and build scripts
- `docs/` — Development documentation

## Architecture

OpenClaude Observe receives events via two paths:
- **Hook forwarding** — OpenClaude's `forwardHookToObserve()` POSTs all 27 hook events to `/api/events`
- **OTel tracing** — `ClaudeObserveExporter` sends LLMGeneration and multi-instance events via OTel spans

No Claude Code plugin or hook scripts needed — integration is native in OpenClaude.

## Development

- **Server**: `just dev-server` starts with hot reload via tsx
- **Client**: `just dev-client` starts the Vite dev server
- **Both**: `just dev` runs both in parallel

## Code style

- Run `just fmt` before committing (uses Prettier via `.prettierrc`)
- TypeScript throughout — avoid `any` where possible
- kebab-case file names

## Reporting issues

Open an issue on GitHub with:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Your environment (OS, Docker version)
