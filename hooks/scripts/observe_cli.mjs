#!/usr/bin/env node
// hooks/scripts/observe_cli.mjs
// CLI entrypoint for Agents Observe plugin.
// Commands: hook, health

import { readFileSync } from 'node:fs'
import { getConfig } from './lib/config.mjs'
import { getJson, postJson } from './lib/http.mjs'
import { createLogger } from './lib/logger.mjs'

const cliArgs = parseArgs(process.argv.slice(2))
const config = getConfig(cliArgs)
const log = createLogger('cli.log')

switch (cliArgs.commands[0] || 'hook') {
  case 'hook':
    hookCommand()
    break
  case 'health':
    healthCommand()
    break
  default:
    console.error(`Unknown command: ${cliArgs.commands[0]}`)
    console.error('Usage: node observe_cli.mjs <hook|health> [--base-url URL] [--project-slug SLUG]')
    process.exit(1)
}

// -- Commands -----------------------------------------------------

function hookCommand() {
  const allowedCallbacks = (() => {
    const val = (process.env.AGENTS_OBSERVE_ALLOW_LOCAL_CALLBACKS || 'all').trim().toLowerCase()
    if (val === 'all') return null
    return new Set(val.split(',').map((s) => s.trim()).filter(Boolean))
  })()

  const callbackHandlers = {
    getSessionSlug({ transcript_path }) {
      if (!transcript_path) return null
      try {
        const content = readFileSync(transcript_path, 'utf8')
        let pos = 0
        while (pos < content.length) {
          const nextNewline = content.indexOf('\n', pos)
          const end = nextNewline === -1 ? content.length : nextNewline
          const line = content.slice(pos, end).trim()
          pos = end + 1
          if (!line || !line.includes('"slug"')) continue
          try {
            const entry = JSON.parse(line)
            if (entry.slug) return { slug: entry.slug }
          } catch {
            continue
          }
        }
      } catch {
        /* file not readable */
      }
      return null
    },
  }

  async function handleRequests(requests) {
    if (!Array.isArray(requests)) return
    for (const req of requests) {
      if (allowedCallbacks && !allowedCallbacks.has(req.cmd)) {
        log.warn(`Blocked callback: ${req.cmd} (not in AGENTS_OBSERVE_ALLOW_LOCAL_CALLBACKS)`)
        continue
      }
      const handler = callbackHandlers[req.cmd]
      if (!handler) continue
      const result = handler(req.args || {})
      if (result && req.callback) {
        await postJson(`${config.baseOrigin}${req.callback}`, result)
      }
    }
  }

  let input = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => { input += chunk })
  process.stdin.on('end', () => {
    if (!input.trim()) return

    let hookPayload
    try {
      hookPayload = JSON.parse(input)
    } catch {
      return
    }

    const envelope = { hook_payload: hookPayload, meta: { env: {} } }
    if (config.projectSlug) {
      envelope.meta.env.AGENTS_OBSERVE_PROJECT_SLUG = config.projectSlug
    }

    postJson(`${config.apiBaseUrl}/events`, envelope, { fireAndForget: true })
      .then((result) => {
        if (result.status === 0) {
          log.warn(`Server unreachable at ${config.baseOrigin}: ${result.error}`)
          return
        }
        if (result.body?.requests) {
          handleRequests(result.body.requests)
        }
      })
      .catch(() => {})
  })
}

async function healthCommand() {
  const healthUrl = `${config.apiBaseUrl}/health`
  const result = await getJson(healthUrl)
  if (result.status === 200 && result.body?.ok) {
    const b = result.body
    const isDocker = b.runtime === 'docker'
    const runtime = isDocker ? 'Docker container' : 'local process'
    console.log(`Agents Observe v${b.version || 'unknown'} is running as a ${runtime}.`)
    console.log(`  Dashboard: ${config.baseOrigin}`)
    console.log(`  Health API: ${healthUrl}`)
    if (isDocker) {
      console.log(`  Data dir: ${config.dataDir}`)
    } else {
      console.log(`  Database: ${b.dbPath || 'unknown'}`)
    }
    console.log(`  Log level: ${b.logLevel || 'unknown'}`)
    console.log('')
    console.log(`Raw health response:`)
    console.log(JSON.stringify(b, null, 2))
    process.exit(0)
  } else if (result.status === 0) {
    console.log(`Agents Observe server is not running.`)
    console.log(`  Checked: ${healthUrl}`)
    console.log(`  Error: ${result.error || 'connection refused'}`)
    process.exit(1)
  } else {
    console.log(`Agents Observe server error (HTTP ${result.status}):`)
    console.log(JSON.stringify(result.body, null, 2))
    process.exit(1)
  }
}

// -- Helpers ------------------------------------------------------

function parseArgs(args) {
  const parsed = { commands: [], baseUrl: null, projectSlug: null }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base-url' && args[i + 1]) {
      parsed.baseUrl = args[i + 1]
      i++
    } else if (args[i] === '--project-slug' && args[i + 1]) {
      parsed.projectSlug = args[i + 1]
      i++
    } else if (!args[i].startsWith('-')) {
      parsed.commands.push(args[i])
    }
  }
  return parsed
}
