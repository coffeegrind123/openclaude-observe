#!/usr/bin/env node
// hooks/scripts/observe_cli.mjs
// CLI entrypoint for Agents Observe plugin.
// Commands: hook, health, restart

import { createInterface } from 'node:readline'
import { getConfig } from './lib/config.mjs'
import { getJson, postJson } from './lib/http.mjs'
import { createLogger } from './lib/logger.mjs'
import { handleCallbackRequests } from './lib/callbacks.mjs'
import { startServer, stopServer } from './lib/docker.mjs'
import { removeDatabase } from './lib/fs.mjs'

const cliArgs = parseArgs(process.argv.slice(2))
const config = getConfig(cliArgs)
const log = createLogger('cli.log', config)

switch (cliArgs.commands[0] || 'help') {
  case 'help':
    console.log('Usage: node observe_cli.mjs <command> [--base-url URL] [--project-slug SLUG]')
    console.log('Commands: hook, hook-sync, hook-autostart, health, start, stop, restart, db-reset')
    console.log('  hook:            Send an event (fire-and-forget)')
    console.log('  hook-sync:       Send an event and return systemMessage JSON')
    console.log('  hook-autostart:  Like hook-sync, but auto-starts server if unreachable')
    console.log('  health:          Check the server health')
    console.log('  start:           Start the server')
    console.log('  stop:            Stop the server')
    console.log('  restart:         Restart the server')
    console.log('  db-reset:        Delete the SQLite database [--force to skip confirmation]')
    process.exit(0)
  case 'hook':
    hookCommand()
    break
  case 'hook-sync':
    hookSyncCommand()
    break
  case 'hook-autostart':
    hookAutostartCommand()
    break
  case 'health':
    healthCommand()
    break
  case 'start':
    startCommand()
    break
  case 'stop':
    stopCommand()
    break
  case 'restart':
    startCommand('Restarting server...')
    break
  case 'db-reset':
    dbResetCommand()
    break
  default:
    console.error(`Unknown command: ${cliArgs.commands[0]}`)
    console.error(
      'Usage: node observe_cli.mjs <hook|health|restart> [--base-url URL] [--project-slug SLUG]',
    )
    process.exit(1)
}

// -- Commands -----------------------------------------------------

function hookCommand() {
  log.trace('CLI hook command invoked')

  let input = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    input += chunk
  })
  process.stdin.on('end', () => {
    if (!input.trim()) {
      log.trace('Empty stdin, skipping')
      return
    }

    let hookPayload
    try {
      hookPayload = JSON.parse(input)
    } catch (err) {
      log.warn(`Failed to parse hook payload: ${err.message}`)
      return
    }

    const hookEvent = hookPayload.event || 'unknown'
    const toolName = hookPayload.tool_name || hookPayload.tool?.name || ''
    log.debug(`Hook event: ${hookEvent}${toolName ? ` tool=${toolName}` : ''}`)
    log.trace(`Hook payload: ${input.trim().slice(0, 500)}`)

    const envelope = { hook_payload: hookPayload, meta: { env: {} } }
    if (config.projectSlug) {
      envelope.meta.env.AGENTS_OBSERVE_PROJECT_SLUG = config.projectSlug
    }

    // Send hook payload to API server
    postJson(`${config.apiBaseUrl}/events`, envelope, {
      fireAndForget: config.allowedCallbacks.size === 0,
      log,
    })
      .then((result) => {
        if (result.status === 0) {
          log.error(`Server unreachable at ${config.baseOrigin}: ${result.error}`)
          return
        }
        log.trace(`Server response: status=${result.status} hasRequests=${!!result.body?.requests}`)
        if (result.body?.requests) {
          // Handle callback requests from the server
          // Used to patch sessions info
          return handleCallbackRequests(result.body.requests, { config, log })
        }
      })
      .catch((err) => {
        log.error(`Hook POST failed: ${err.message}`)
      })
  })
}

/**
 * Mute console.log/error/warn so only our final JSON goes to stdout.
 * Logger file writes still work — only the console output methods are silenced.
 */
function muteConsole() {
  const noop = () => {}
  console.log = noop
  console.error = noop
  console.warn = noop
  console.debug = noop
}

/**
 * Output a systemMessage JSON to stdout for Claude to surface to the user.
 * This must be the ONLY stdout output — console is muted before this runs.
 */
function outputClaudeSystemMessage(message) {
  // Use process.stdout.write directly since console.log is muted
  process.stdout.write(JSON.stringify({ systemMessage: message }) + '\n')
}

/**
 * Read stdin, POST to server synchronously, return { result, envelope }.
 * Does NOT use fireAndForget — waits for the response.
 */
async function sendHookSync() {
  const input = await readStdin()
  if (!input) return { result: null, envelope: null }

  let hookPayload
  try {
    hookPayload = JSON.parse(input)
  } catch (err) {
    log.warn(`Failed to parse hook payload: ${err.message}`)
    return { result: null, envelope: null }
  }

  const hookEvent = hookPayload.event || 'unknown'
  const toolName = hookPayload.tool_name || hookPayload.tool?.name || ''
  log.debug(`Hook event: ${hookEvent}${toolName ? ` tool=${toolName}` : ''}`)

  const envelope = { hook_payload: hookPayload, meta: { env: {} } }
  if (config.projectSlug) {
    envelope.meta.env.AGENTS_OBSERVE_PROJECT_SLUG = config.projectSlug
  }

  const result = await postJson(`${config.apiBaseUrl}/events`, envelope, { log })
  return { result, envelope }
}

/**
 * Read all stdin into a string (returns promise).
 */
function readStdin() {
  return new Promise((resolve) => {
    let input = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      input += chunk
    })
    process.stdin.on('end', () => resolve(input.trim() || null))
  })
}

/**
 * hook-sync: Send event synchronously, return systemMessage JSON.
 * Mutes all console output so only the JSON response goes to stdout.
 */
async function hookSyncCommand() {
  // Prevent console output so systemMessage can be returned to claude
  muteConsole()

  try {
    const { result } = await sendHookSync()

    if (!result || result.status === 0) {
      outputClaudeSystemMessage(
        `Agents Observe server is not running. Run /observe status for help.`,
      )
      return
    }

    // Handle callbacks if present
    if (result.body?.requests) {
      await handleCallbackRequests(result.body.requests, { config, log })
    }

    // Return systemMessage from server response if present, otherwise a default
    const serverMessage = result.body?.systemMessage
    if (serverMessage) {
      outputClaudeSystemMessage(serverMessage)
    } else {
      outputClaudeSystemMessage(`Agents Observe: logging events. Dashboard: ${config.baseOrigin}`)
    }
  } catch (err) {
    log.error(`hook-sync failed: ${err.message}`)
    outputClaudeSystemMessage(`Agents Observe: internal error. Run /observe status for help.`)
  }
}

/**
 * hook-autostart: Like hook-sync, but auto-starts the server if unreachable.
 * Waits up to hookStartupTimeout ms for the server to become healthy.
 */
async function hookAutostartCommand() {
  // Prevent console output so systemMessage can be returned to claude
  muteConsole()

  try {
    const { result, envelope } = await sendHookSync()

    // Server is reachable — handle normally
    if (result && result.status !== 0) {
      if (result.body?.requests) {
        await handleCallbackRequests(result.body.requests, { config, log })
      }
      const serverMessage = result.body?.systemMessage
      if (serverMessage) {
        outputClaudeSystemMessage(serverMessage)
      } else {
        outputClaudeSystemMessage(`Agents Observe: logging events. Dashboard: ${config.baseOrigin}`)
      }
      return
    }

    // Server unreachable — auto-start (only if using a local server)
    if (config.hasCustomApiUrl) {
      log.warn('Server unreachable at custom API URL — skipping auto-start')
      outputClaudeSystemMessage(
        `Agents Observe: server unreachable at ${config.apiBaseUrl}. Run /observe status for help.`,
      )
      return
    }

    log.warn('Server not running, auto-starting...')

    // Start the server in the background — don't await it directly because
    // docker pull + health loop can exceed the timeout. Instead, poll for
    // health independently so we detect the server as soon as it's up.
    let startFinished = false
    const startPromise = startServer(config, log).then((port) => {
      startFinished = true
      return port
    })

    // Poll for health until the server is up or we hit the timeout
    const deadline = Date.now() + config.hookStartupTimeout
    let actualPort = null
    while (Date.now() < deadline) {
      const h = await getJson(`${config.apiBaseUrl}/health`, { log: null })
      if (h.status === 200 && h.body?.ok) {
        actualPort = config.serverPort
        break
      }
      // If startServer already finished with null (failed), stop polling
      if (startFinished) {
        actualPort = await startPromise
        break
      }
      await new Promise((r) => setTimeout(r, 1000))
    }

    if (!actualPort) {
      outputClaudeSystemMessage(
        `Agents Observe: server is starting (timed out after ${
          config.hookStartupTimeout / 1000
        }s). Run /observe status to check.`,
      )
      return
    }

    log.info(`Server auto-started on port ${actualPort}`)

    // Retry sending the original event if we have one
    if (envelope) {
      const retryUrl = `http://127.0.0.1:${actualPort}/api/events`
      const retry = await postJson(retryUrl, envelope, { log })
      if (retry.status !== 0) {
        log.info('Event delivered after auto-start')
        if (retry.body?.requests) {
          await handleCallbackRequests(retry.body.requests, { config, log })
        }
      } else {
        log.error(`Event delivery failed after auto-start: ${retry.error}`)
      }
    }

    const dashboardUrl = `http://127.0.0.1:${actualPort}`
    outputClaudeSystemMessage(`Agents Observe: server started. Dashboard: ${dashboardUrl}`)
  } catch (err) {
    log.error(`hook-autostart failed: ${err.message}`)
    outputClaudeSystemMessage(`Agents Observe: internal error. Run /observe status for help.`)
  }
}

/**
 * Get health and runtime info about the server
 *
 * Used by observe-status skill
 */
async function healthCommand(exit = true) {
  log.trace('CLI health command invoked')
  const healthUrl = `${config.apiBaseUrl}/health`
  const result = await getJson(healthUrl, { log })
  if (result.status === 200 && result.body?.ok) {
    const b = result.body
    const isDocker = b.runtime === 'docker'
    const runtime = isDocker ? `Docker` : 'local server'

    console.log(`Raw ${healthUrl} response:`)
    console.log(JSON.stringify(b, null, 2))
    console.log('')
    console.log('Hooks CLI (local):')
    console.log(`  CLI Path: ${config.cliPath}`)
    console.log(`  Log Level: ${config.logLevel || 'unknown'}`)
    console.log(`  Logs: ${config.logsDir}`)
    console.log(
      `  Allowed Callbacks: ${
        config.allowedCallbacks.size ? [...config.allowedCallbacks].join(', ') : 'none'
      }`,
    )
    console.log('')
    console.log(`Agents Observe Server (${runtime}):`)
    console.log(`  Version: v${b.version || 'unknown'}`)
    console.log(`  Dashboard: ${config.baseOrigin}`)
    console.log(`  API: ${config.apiBaseUrl}`)
    console.log(`  Runtime: ${runtime}`)
    if (isDocker) {
      console.log(`  Container Name: ${config.containerName}`)
      console.log(`  Image: ${config.dockerImage}`)
      console.log(`  Data Dir: ${config.dataDir} (bind mounted)`)
    } else {
      console.log(`  Database: ${b.dbPath || 'unknown'}`)
    }
    console.log(`  Log Level: ${b.logLevel || 'unknown'}`)

    // Version mismatch detection
    if (config.expectedVersion && b.version && config.expectedVersion !== b.version) {
      console.log('')
      console.log(`⚠ Version mismatch: CLI is v${config.expectedVersion}, server is v${b.version}`)
      console.log(`  To update the server, run: node ${config.cliPath} restart`)
    }
    exit && process.exit(0)
  } else if (result.status === 0) {
    console.log(`Agents Observe server is not running.`)
    console.log(`  Checked: ${healthUrl}`)
    console.log(`  Error: ${result.error || 'connection refused'}`)
    exit && process.exit(1)
  } else {
    console.log(`Agents Observe server error (HTTP ${result.status}):`)
    console.log(JSON.stringify(result.body, null, 2))
    exit && process.exit(1)
  }
}

/**
 * Restart the Docker container (pulls latest image for current CLI version).
 */
async function startCommand(msg = 'Starting server...') {
  log.info(msg)
  const actualPort = await startServer(config, log)
  if (actualPort) {
    await healthCommand(false)
    console.log(`\nServer started on port ${actualPort}`)
    console.log(`  Dashboard: http://127.0.0.1:${actualPort}`)
  } else {
    console.error('Failed to start server')
    process.exit(1)
  }
}

/**
 * Stop the Docker container.
 */
async function stopCommand() {
  await stopServer(config, log)
  log.info('Server stopped')
}

/**
 * Delete the SQLite database. Stops the server first if running,
 * then restarts it afterward.
 */
async function dbResetCommand() {
  const dbPath = `${config.dataDir}/${config.databaseFileName}`

  if (!cliArgs.force) {
    const confirmed = await confirm(`Delete database at ${dbPath}? This cannot be undone. [y/N] `)
    if (!confirmed) {
      console.log('Aborted.')
      process.exit(0)
    }
  }

  // Check if server is running so we can restart it after
  const health = await getJson(`${config.apiBaseUrl}/health`, { log })
  const wasRunning = health.status === 200 && health.body?.ok

  if (wasRunning) {
    console.log('Stopping server...')
    await stopServer(config, log)
  }

  const { removed } = removeDatabase(config)
  if (removed.length > 0) {
    console.log(`Deleted: ${removed.join(', ')}`)
  } else {
    console.log('No database files found.')
  }

  if (wasRunning) {
    console.log('Restarting server...')
    await startServer(config, log)
    console.log('Server restarted.')
  }
}

function confirm(prompt) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(prompt, (answer) => {
      rl.close()
      resolve(answer.trim().toLowerCase() === 'y')
    })
  })
}
// -- Helpers ------------------------------------------------------

function parseArgs(args) {
  const parsed = { commands: [], baseUrl: null, projectSlug: null, force: false }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base-url' && args[i + 1]) {
      parsed.baseUrl = args[i + 1]
      i++
    } else if (args[i] === '--project-slug' && args[i + 1]) {
      parsed.projectSlug = args[i + 1]
      i++
    } else if (args[i] === '--force') {
      parsed.force = true
    } else if (!args[i].startsWith('-')) {
      parsed.commands.push(args[i])
    }
  }
  return parsed
}
