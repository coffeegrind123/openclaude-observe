// app/server/src/config.ts
// Central config for the server. All env var reads happen here.

import { resolve, dirname } from 'path'
import { readFileSync, existsSync } from 'fs'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

const logLevel = (process.env.AGENTS_OBSERVE_LOG_LEVEL || 'debug').toLowerCase()

function detectRuntime(): 'docker' | 'local' {
  const explicit = process.env.AGENTS_OBSERVE_RUNTIME
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
  isDev: process.env.AGENTS_OBSERVE_RUNTIME_DEV === '1',
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
    const rawPort = parseInt(process.env.AGENTS_OBSERVE_SERVER_PORT || '', 10)
    return !isNaN(rawPort) && rawPort > 0 && rawPort < 65536 ? rawPort : 4981
  })(),
  logLevel,
  verbose: logLevel === 'debug' || logLevel === 'trace',
  dbPath: resolve(process.env.AGENTS_OBSERVE_DB_PATH || '../../data/observe.db'),
  // Directory for persistent server state outside the SQLite DB —
  // currently just the models.dev pricing cache. Defaults to the same
  // directory as the DB so docker volume mounts cover both.
  dataDir: resolve(
    process.env.AGENTS_OBSERVE_DATA_DIR ||
      dirname(resolve(process.env.AGENTS_OBSERVE_DB_PATH || '../../data/observe.db')),
  ),
  storageAdapter: process.env.AGENTS_OBSERVE_STORAGE_ADAPTER || 'sqlite',
  clientDistPath: process.env.AGENTS_OBSERVE_CLIENT_DIST_PATH || '',
  devClientPort: (() => {
    const rawPort = parseInt(process.env.AGENTS_OBSERVE_DEV_CLIENT_PORT || '', 10)
    return !isNaN(rawPort) && rawPort > 0 && rawPort < 65536 ? rawPort : 5174
  })(),

  // DB reset policy: 'allow' = permit, 'deny' = reject, 'backup' (default) = backup then reset
  // Unrecognized values are treated as 'deny' to prevent misconfiguration
  allowDbReset:
    ({ allow: 'allow', backup: 'backup' } as Record<string, 'allow' | 'backup'>)[
      (process.env.AGENTS_OBSERVE_ALLOW_DB_RESET || 'backup').toLowerCase()
    ] ?? ('deny' as const),

  // Notification event subtypes: comma-separated list of subtypes that trigger
  // notification bells in the UI. Defaults to just 'Notification'. Set to empty
  // string to disable all notification triggers, or include additional subtypes
  // like 'Stop,SubagentStop' to get notified when agents finish.
  notificationEventSubtypes: new Set(
    (process.env.AGENTS_OBSERVE_NOTIFICATION_ON_EVENTS || 'Notification')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  ),

  // Auto-shutdown: <= 0 disables, > 0 is delay in ms after last consumer disconnects
  shutdownDelayMs: parseInt(process.env.AGENTS_OBSERVE_SHUTDOWN_DELAY_MS || '30000', 10),
  // Consumer tracker tuning
  consumerTtlMs: 30_000,
  sweepIntervalMs: 10_000,
  startupGraceMs: 60_000,

  transcriptStats: {
    enabled: process.env.AGENTS_OBSERVE_TRANSCRIPT_STATS !== '0',
    // Bind-mount base for translating a session's host-side
    // transcript_path into the path the server can read inside its
    // runtime. Trailing slashes stripped defensively.
    bases: [
      {
        agentClass: 'claude-code' as const,
        host: (process.env.AGENTS_OBSERVE_TRANSCRIPT_CLAUDE_HOST_BASE || '').replace(/\/$/, ''),
        container: (process.env.AGENTS_OBSERVE_TRANSCRIPT_CLAUDE_CONTAINER_BASE || '').replace(
          /\/$/,
          '',
        ),
      },
    ],
    // 100 MB safety cap — defensive, not an expected operating point.
    maxFileBytes: 100 * 1024 * 1024,
  },
}
