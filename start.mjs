#!/usr/bin/env node

/**
 * Runs the API server and dashboard UI locally (no Docker).
 *
 * Modes are selected via AGENTS_OBSERVE_RUNTIME:
 *   dev   — installs deps, runs server with tsx watch + Vite client with HMR
 *   local — installs deps, builds client, runs server (serves built UI)
 */

import { execFileSync, spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = dirname(fileURLToPath(import.meta.url))
const serverDir = resolve(rootDir, 'app/server')
const clientDir = resolve(rootDir, 'app/client')

const runtime = (process.env.AGENTS_OBSERVE_RUNTIME || 'local').toLowerCase()
const isDev = runtime === 'dev'

const serverPort = process.env.AGENTS_OBSERVE_SERVER_PORT || '4981'
const clientPort = process.env.AGENTS_OBSERVE_DEV_CLIENT_PORT || '5174'

function run(cmd, args, cwd) {
  const rel = cwd.replace(rootDir + '/', '') || '.'
  console.log(`\n> ${cmd} ${args.join(' ')}  (in ${rel})`)
  execFileSync(cmd, args, { cwd, stdio: 'inherit' })
}

run('npm', ['install'], serverDir)
run('npm', ['install'], clientDir)

if (!isDev) {
  run('npm', ['run', 'build'], clientDir)
}

const serverEnv = {
  ...process.env,
  AGENTS_OBSERVE_SERVER_PORT: serverPort,
  AGENTS_OBSERVE_RUNTIME: runtime,
  AGENTS_OBSERVE_RUNTIME_DEV: isDev ? '1' : '0',
}

const clientEnv = {
  ...process.env,
  AGENTS_OBSERVE_SERVER_PORT: serverPort,
  AGENTS_OBSERVE_DEV_CLIENT_PORT: clientPort,
}

if (isDev) {
  console.log(`\nStarting dev server on http://localhost:${serverPort} (API)`)
  console.log(`Starting dev client on http://localhost:${clientPort} (UI + proxy)\n`)

  const server = spawn('npm', ['run', 'dev'], {
    cwd: serverDir,
    stdio: 'inherit',
    env: serverEnv,
  })
  const client = spawn('npm', ['run', 'dev'], {
    cwd: clientDir,
    stdio: 'inherit',
    env: clientEnv,
  })

  const shutdown = () => {
    server.kill('SIGINT')
    client.kill('SIGINT')
  }
  server.on('close', (code) => {
    client.kill()
    process.exit(code ?? 0)
  })
  client.on('close', () => server.kill())
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
} else {
  console.log(`\nStarting server on http://localhost:${serverPort} (API + UI)\n`)

  const server = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: serverDir,
    stdio: 'inherit',
    env: serverEnv,
  })
  server.on('close', (code) => process.exit(code ?? 0))
  process.on('SIGINT', () => server.kill('SIGINT'))
  process.on('SIGTERM', () => server.kill('SIGTERM'))
}
