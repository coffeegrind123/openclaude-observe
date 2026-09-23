// app/server/src/config.ts
// Central config for the server. All env var reads happen here.

import { resolve, dirname } from 'path'
import { readFileSync, existsSync } from 'fs'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

export const LOOPBACK = '127.0.0.1'

const logLevel = (process.env.INSTANTCOFFEE_OBSERVE_LOG_LEVEL || 'debug').toLowerCase()

/**
 * The DB path the dashboard shows: where the user can find the file on THEIR
 * machine. In docker the server only sees the bind-mount target
 * (/data/observe.db), so compose passes the host-side path in
 * INSTANTCOFFEE_OBSERVE_HOST_DB_PATH. That path is passed through verbatim —
 * it may be a Windows or Docker Desktop path (C:\... or //c/...), which a
 * POSIX resolve() inside the container would mangle into /app/server/C:\....
 * Only the local-mode fallback, a real path on this OS, is resolved.
 */
export function resolveHostDbPath(hostDbPath: string | undefined, dbPath: string): string {
  const host = hostDbPath?.trim()
  if (host) {
    return host
  }
  return resolve(dbPath)
}

function detectRuntime(): 'docker' | 'local' {
  const explicit = process.env.INSTANTCOFFEE_OBSERVE_RUNTIME
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
  apiId: 'instantcoffee-observe',
  runtime: detectRuntime(),
  isDev: process.env.INSTANTCOFFEE_OBSERVE_RUNTIME_DEV === '1',
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
  // Interface the server listens on. IPv4 loopback by default, as a literal:
  // 'localhost' can resolve to ::1 alone, binding IPv6-only, and then every
  // IPv4 client — Node's fetch in the pi extension included — is refused
  // while curl (which tries both) says the server is up. docker-compose sets
  // 0.0.0.0 inside the container and publishes on host loopback instead.
  serverHost: process.env.INSTANTCOFFEE_OBSERVE_SERVER_HOST || LOOPBACK,
  // CORS + WebSocket origin allowlist. Empty → loopback origins only (the
  // client is served same-origin, so that covers normal use). `*` → any
  // origin. Otherwise an explicit comma-separated list.
  corsAllowedOrigins: (process.env.INSTANTCOFFEE_OBSERVE_CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  port: (() => {
    const rawPort = parseInt(process.env.INSTANTCOFFEE_OBSERVE_SERVER_PORT || '', 10)
    return !isNaN(rawPort) && rawPort > 0 && rawPort < 65536 ? rawPort : 4981
  })(),
  logLevel,
  verbose: logLevel === 'debug' || logLevel === 'trace',
  dbPath: resolve(process.env.INSTANTCOFFEE_OBSERVE_DB_PATH || '../../data/observe.db'),
  hostDbPath: resolveHostDbPath(
    process.env.INSTANTCOFFEE_OBSERVE_HOST_DB_PATH,
    process.env.INSTANTCOFFEE_OBSERVE_DB_PATH || '../../data/observe.db',
  ),
  // Directory for persistent server state outside the SQLite DB —
  // currently just the models.dev pricing cache. Always the DB's directory,
  // so the /data mount covers both. INSTANTCOFFEE_OBSERVE_DATA_DIR is
  // deliberately not read: it is compose's host-side mount source, and
  // `just dev` loads it from .env too.
  dataDir: dirname(resolve(process.env.INSTANTCOFFEE_OBSERVE_DB_PATH || '../../data/observe.db')),
  storageAdapter: process.env.INSTANTCOFFEE_OBSERVE_STORAGE_ADAPTER || 'sqlite',
  clientDistPath: process.env.INSTANTCOFFEE_OBSERVE_CLIENT_DIST_PATH || '',
  devClientPort: (() => {
    const rawPort = parseInt(process.env.INSTANTCOFFEE_OBSERVE_DEV_CLIENT_PORT || '', 10)
    return !isNaN(rawPort) && rawPort > 0 && rawPort < 65536 ? rawPort : 5174
  })(),

  // DB reset policy: 'allow' = permit, 'deny' = reject, 'backup' (default) = backup then reset
  // Unrecognized values are treated as 'deny' to prevent misconfiguration
  allowDbReset:
    ({ allow: 'allow', backup: 'backup' } as Record<string, 'allow' | 'backup'>)[
      (process.env.INSTANTCOFFEE_OBSERVE_ALLOW_DB_RESET || 'backup').toLowerCase()
    ] ?? ('deny' as const),

  // Notification event subtypes: comma-separated list of subtypes that trigger
  // notification bells in the UI. Defaults to just 'Notification'. Set to empty
  // string to disable all notification triggers, or include additional subtypes
  // like 'Stop,SubagentStop' to get notified when agents finish.
  notificationEventSubtypes: new Set(
    (process.env.INSTANTCOFFEE_OBSERVE_NOTIFICATION_ON_EVENTS || 'Notification')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  ),

  // instantcoffee inference stack: llama-server /metrics and forge
  // /forge/usage, polled for decode speed, speculative-decoding acceptance,
  // KV-cache reuse and context fill. Defaults assume the stack's standard
  // ports on the same host; in docker that host is host.docker.internal.
  // INSTANTCOFFEE_OBSERVE_STACK_POLL_MS=0 disables polling.
  stack: (() => {
    const host = detectRuntime() === 'docker' ? 'host.docker.internal' : LOOPBACK
    const pollMs = parseInt(process.env.INSTANTCOFFEE_OBSERVE_STACK_POLL_MS ?? '', 10)
    const effectivePollMs = !isNaN(pollMs) && pollMs >= 0 ? pollMs : 5000
    return {
      llamaUrl: (process.env.INSTANTCOFFEE_OBSERVE_LLAMA_URL || `http://${host}:8080`).replace(
        /\/+$/,
        '',
      ),
      forgeUrl: (process.env.INSTANTCOFFEE_OBSERVE_FORGE_URL || `http://${host}:8081`).replace(
        /\/+$/,
        '',
      ),
      pollMs: effectivePollMs,
      timeoutMs: 3000,
      // One hour of history at the default interval.
      maxSamples: effectivePollMs > 0 ? Math.ceil(3_600_000 / effectivePollMs) : 0,
    }
  })(),

  // Base64 image runs longer than this many chars are replaced with a
  // "[REDACTED base64 N chars]" sentinel at ingestion, before the event is
  // hashed or stored (utils/redact-image-data.ts). The pi views never render
  // image bytes, so the default is low; 0 disables redaction.
  maxImageDataChars: (() => {
    const raw = parseInt(process.env.INSTANTCOFFEE_OBSERVE_MAX_IMAGE_DATA_CHARS ?? '', 10)
    return !isNaN(raw) && raw >= 0 ? raw : 1024
  })(),

  // Consumer tracker tuning. The server never auto-shuts-down; these only
  // govern how stale consumer heartbeats are reaped for the /health count.
  consumerTtlMs: 30_000,
  sweepIntervalMs: 10_000,

  transcriptStats: {
    enabled: process.env.INSTANTCOFFEE_OBSERVE_TRANSCRIPT_STATS !== '0',
    // 100 MB safety cap — defensive, not an expected operating point.
    maxFileBytes: 100 * 1024 * 1024,
  },

  // pi home directories. Each one's .pi/agent holds that pi install's
  // sessions (transcripts), global instruction files and subagent
  // definitions. instantcoffee runs pi both on the host and in its own
  // container with a separate home, so there can be several. In docker every
  // home is bind-mounted at the SAME absolute path it has for pi, so paths
  // pi reports (transcript_path, cwd) resolve here unchanged.
  pi: {
    homes: (process.env.INSTANTCOFFEE_OBSERVE_PI_HOMES || process.env.HOME || '')
      .split(',')
      .map((s) => s.trim().replace(/\/+$/, ''))
      .filter(Boolean),
  },

  // Instructions browser/editor: pi's context files (AGENTS.md, CLAUDE.md,
  // SYSTEM.md, APPEND_SYSTEM.md) and subagent definitions (agents/*.md), per
  // pi home and per project. READS AND WRITES them — every request pi makes
  // carries these files, so this is where the standing context cost is paid.
  // Set INSTANTCOFFEE_OBSERVE_INSTRUCTIONS=0 to disable.
  instructions: {
    enabled: process.env.INSTANTCOFFEE_OBSERVE_INSTRUCTIONS !== '0',
    // 2 MB per-file cap — instruction files are prose; this guards against
    // accidentally loading/saving something pathological.
    maxFileBytes: 2 * 1024 * 1024,
  },
}
