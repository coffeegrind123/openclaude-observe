// app/server/src/config.ts
// Central config for the server. All env var reads happen here.

import { resolve, dirname } from 'path'
import { readFileSync, existsSync } from 'fs'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

const logLevel = (process.env.OPENCLAUDE_OBSERVE_LOG_LEVEL || 'debug').toLowerCase()

function detectRuntime(): 'docker' | 'local' {
  const explicit = process.env.OPENCLAUDE_OBSERVE_RUNTIME
  if (explicit === 'docker' || explicit === 'local') return explicit
  if (existsSync('/.dockerenv')) return 'docker'
  return 'local'
}

function readVersion(): string {
  const dir = dirname(fileURLToPath(import.meta.url))
  const paths = [
    resolve(dir, '../../../VERSION'), // dev: app/server/src -> root
    resolve(dir, '../../VERSION'), // Docker: /app/server/src -> /app
    '/app/VERSION', // Docker fallback
  ]
  for (const p of paths) {
    try {
      return readFileSync(p, 'utf8').trim()
    } catch {
      continue
    }
  }
  return 'unknown'
}

export const config = {
  apiId: 'openclaude-observe',
  runtime: detectRuntime(),
  isDev: process.env.OPENCLAUDE_OBSERVE_RUNTIME_DEV === '1',
  version: readVersion(),
  gitHash: (() => {
    const dir = dirname(fileURLToPath(import.meta.url))
    for (const p of [
      resolve(dir, '../../../GIT_HASH'),
      resolve(dir, '../../GIT_HASH'),
      '/app/GIT_HASH',
    ]) {
      try {
        const v = readFileSync(p, 'utf8').trim()
        if (v) return v
      } catch {}
    }
    try {
      return execSync('git rev-parse --short HEAD').toString().trim()
    } catch {
      return 'unknown'
    }
  })(),
  port: (() => {
    const rawPort = parseInt(process.env.OPENCLAUDE_OBSERVE_SERVER_PORT || '', 10)
    return !isNaN(rawPort) && rawPort > 0 && rawPort < 65536 ? rawPort : 4981
  })(),
  logLevel,
  verbose: logLevel === 'debug' || logLevel === 'trace',
  dbPath: resolve(process.env.OPENCLAUDE_OBSERVE_DB_PATH || '../../data/observe.db'),
  // Directory for persistent server state outside the SQLite DB —
  // currently just the models.dev pricing cache. Defaults to the same
  // directory as the DB so docker volume mounts cover both.
  dataDir: resolve(
    process.env.OPENCLAUDE_OBSERVE_DATA_DIR ||
      dirname(resolve(process.env.OPENCLAUDE_OBSERVE_DB_PATH || '../../data/observe.db')),
  ),
  storageAdapter: process.env.OPENCLAUDE_OBSERVE_STORAGE_ADAPTER || 'sqlite',
  clientDistPath: process.env.OPENCLAUDE_OBSERVE_CLIENT_DIST_PATH || '',
  devClientPort: (() => {
    const rawPort = parseInt(process.env.OPENCLAUDE_OBSERVE_DEV_CLIENT_PORT || '', 10)
    return !isNaN(rawPort) && rawPort > 0 && rawPort < 65536 ? rawPort : 5174
  })(),

  // DB reset policy: 'allow' = permit, 'deny' = reject, 'backup' (default) = backup then reset
  // Unrecognized values are treated as 'deny' to prevent misconfiguration
  allowDbReset:
    ({ allow: 'allow', backup: 'backup' } as Record<string, 'allow' | 'backup'>)[
      (process.env.OPENCLAUDE_OBSERVE_ALLOW_DB_RESET || 'backup').toLowerCase()
    ] ?? ('deny' as const),

  // Notification event subtypes: comma-separated list of subtypes that trigger
  // notification bells in the UI. Defaults to just 'Notification'. Set to empty
  // string to disable all notification triggers, or include additional subtypes
  // like 'Stop,SubagentStop' to get notified when agents finish.
  notificationEventSubtypes: new Set(
    (process.env.OPENCLAUDE_OBSERVE_NOTIFICATION_ON_EVENTS || 'Notification')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  ),

  // Consumer tracker tuning. The server never auto-shuts-down; these only
  // govern how stale consumer heartbeats are reaped for the /health count.
  consumerTtlMs: 30_000,
  sweepIntervalMs: 10_000,

  transcriptStats: {
    enabled: process.env.OPENCLAUDE_OBSERVE_TRANSCRIPT_STATS !== '0',
    // Bind-mount base for translating a session's host-side
    // transcript_path into the path the server can read inside its
    // runtime. Trailing slashes stripped defensively.
    base: {
      host: (process.env.OPENCLAUDE_OBSERVE_TRANSCRIPT_CLAUDE_HOST_BASE || '').replace(/\/$/, ''),
      container: (process.env.OPENCLAUDE_OBSERVE_TRANSCRIPT_CLAUDE_CONTAINER_BASE || '').replace(
        /\/$/,
        '',
      ),
    },
    // 100 MB safety cap — defensive, not an expected operating point.
    maxFileBytes: 100 * 1024 * 1024,
  },

  // Interactive memory browser/editor. Reads and WRITES OpenClaude's
  // file-based memory under the Claude config dir (~/.claude): per-project
  // auto-memory (projects/<slug>/memory/*.md + MEMORY.md), the global
  // instruction file (CLAUDE.md), and global agent memory
  // (agent-memory/<type>/MEMORY.md). Unlike transcriptStats this surface is
  // read-write, so in docker it gets its OWN bind mount (read-only transcript
  // mount stays untouched). Set OPENCLAUDE_OBSERVE_MEMORY=0 to disable.
  memory: {
    enabled: process.env.OPENCLAUDE_OBSERVE_MEMORY !== '0',
    // Bind-mount base for translating the host-side Claude config dir into the
    // path the server reads/writes inside its runtime. `host` is the real
    // ~/.claude on the host; `container` is where it's mounted in docker. In
    // local mode `container` is empty and the server uses `host` directly.
    base: {
      host: (
        process.env.OPENCLAUDE_OBSERVE_MEMORY_CLAUDE_HOST_BASE ||
        (process.env.HOME ? `${process.env.HOME}/.claude` : '')
      ).replace(/\/$/, ''),
      container: (process.env.OPENCLAUDE_OBSERVE_MEMORY_CLAUDE_CONTAINER_BASE || '').replace(
        /\/$/,
        '',
      ),
    },
    // 2 MB per-file cap — memory facts are small prose files; this guards
    // against accidentally loading/saving something pathological.
    maxFileBytes: 2 * 1024 * 1024,
  },
}
