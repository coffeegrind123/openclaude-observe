# Contributing to instantcoffee-observe

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

instantcoffee-observe has two inputs:
- **pi events** — instantcoffee's pi extension (`.pi/extensions/observe/`) POSTs each session event to `/api/events`. It links subagents to the call that spawned them itself; the contract is [docs/pi-protocol.md](docs/pi-protocol.md), and both sides test against the same real captured session.
- **Stack metrics** — the server polls llama-server `/metrics` and forge `/forge/usage` (`app/server/src/services/stack-metrics.ts`).

## Development

`just dev` runs the server with hot reload (tsx) and the Vite client in parallel — see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the full guide.

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
