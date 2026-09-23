// app/server/src/routes/events.ts
import { Hono } from 'hono'
import type { EventStore, NotificationTransition } from '../storage/types'
import { DuplicateEventSignatureError } from '../storage/types'
import type { ParsedEvent } from '../types'
import { parseRawEvent } from '../parser'
import { resolveProject } from '../services/project-resolver'
import { computeEventSignature } from '../utils/event-signature'
import { redactImageData } from '../utils/redact-image-data'
import { config } from '../config'
import { apiError } from '../errors'
import { rateLimit } from '../middleware/rate-limit'

type Env = {
  Variables: {
    store: EventStore
    broadcastToSession: (sessionId: string, msg: object) => void
    broadcastToAll: (msg: object) => void
    broadcastActivity: (sessionId: string, eventId: number, projectId: number | null) => void
  }
}

const router = new Hono<Env>()

const LOG_LEVEL = config.logLevel

/** Derive event status from subtype (not stored in DB) */
function deriveEventStatus(subtype: string | null): string {
  if (subtype === 'PreToolUse') return 'running'
  if (subtype === 'PostToolUse') return 'completed'
  return 'pending'
}

// Track root agent IDs per session (sessionId -> agentId)
const sessionRootAgents = new Map<string, string>()

async function ensureRootAgent(
  store: EventStore,
  sessionId: string,
  agentClass: string | null,
): Promise<string> {
  // Fast path: trust the in-memory cache. Cache invalidation happens in all
  // delete paths (DELETE /projects/:id, DELETE /sessions/:id, DELETE /data),
  // and the startup repairOrphans pass cleans up any pre-existing orphans.
  // Defensive always-upserting on every event added a measurable per-event
  // write cost (~500µs) for no benefit in the common case.
  let rootId = sessionRootAgents.get(sessionId)
  if (!rootId) {
    rootId = sessionId
    await store.upsertAgent(rootId, sessionId, null, null, null, null, agentClass)
    sessionRootAgents.set(sessionId, rootId)
  }
  return rootId
}

const REQUIRED_ENVELOPE_FIELDS = ['hook_event_name', 'session_id'] as const

// POST /events
router.post('/events', rateLimit, async (c) => {
  const store = c.get('store')
  const broadcastToSession = c.get('broadcastToSession')
  const broadcastToAll = c.get('broadcastToAll')

  const contentType = c.req.header('content-type') || ''
  if (!contentType.includes('application/json')) {
    return c.json({ error: 'Content-Type must be application/json' }, 415)
  }

  try {
    const body = await c.req.json()

    if (!body.hook_payload) {
      return apiError(c, 400, 'Missing hook_payload in request body')
    }

    const hookPayload = body.hook_payload as Record<string, unknown>

    // Every envelope the pi extension sends names its event and session
    // (docs/pi-protocol.md). Without them the event would be filed under a
    // shared "unknown" session, so reject it and say what's missing.
    const missing = REQUIRED_ENVELOPE_FIELDS.filter(
      (f) => typeof hookPayload[f] !== 'string' || (hookPayload[f] as string).trim() === '',
    )
    if (missing.length > 0) {
      return apiError(c, 400, `hook_payload is missing ${missing.join(', ')}`)
    }
    const meta: { env?: Record<string, string> } =
      (body.meta as { env?: Record<string, string> }) || {}

    // Before logging and parsing, so trace logs, the dedup signature, the 1 MB oversize guard and the
    // stored row all see the redacted payload.
    const redactedImages = redactImageData(hookPayload, config.maxImageDataChars)
    if (redactedImages > 0 && config.verbose) {
      console.log(`[event] redacted ${redactedImages} base64 image blob(s)`)
    }

    if (LOG_LEVEL === 'debug' || LOG_LEVEL === 'trace') {
      const logKeys = Object.keys(hookPayload).join(', ')
      const payload = JSON.stringify(hookPayload)
      const logPayload =
        LOG_LEVEL === 'trace'
          ? `Payload: ${payload}`
          : `Keys: ${logKeys} \nPayload: ${payload.slice(0, 500)}`

      if (hookPayload.hook_event_name) {
        const toolInfo = hookPayload.tool_name
          ? `tool:${hookPayload.tool_name} tool_use_id:${hookPayload.tool_use_id}`
          : ''
        console.log(`[HOOK:${hookPayload.hook_event_name}] ${toolInfo} \n${logPayload}\n---`)
      } else {
        console.log('[EVENT]', logPayload)
      }
    }

    const parsed = parseRawEvent(hookPayload)
    const eventCwd = (parsed.metadata.cwd as string | undefined) ?? null

    // Dedup pre-check. Native OTel can re-deliver the same span (exporter
    // retries, duplicate exporters); hash the identifying fields + a 5-second
    // bucket and skip the whole pipeline on a re-delivery so side-effects
    // (session/agent upsert, broadcast) don't fire twice.
    const signatureHash = computeEventSignature(parsed, eventCwd)
    const duplicate = await store.findEventBySignatureHash(signatureHash)
    if (duplicate) {
      if (LOG_LEVEL === 'debug' || LOG_LEVEL === 'trace') {
        console.log(
          `[dedup] subtype=${parsed.subtype} session=${parsed.sessionId} orig_event_id=${duplicate.id}`,
        )
      }
      return c.json(
        {
          status: 'OK',
          deduplicated: true,
          meta: { event_id: duplicate.id, session_id: parsed.sessionId },
        },
        201,
      )
    }

    // Resolve project - only on first event for this session
    const existingSession = await store.getSessionById(parsed.sessionId)
    let effectiveProjectId: number

    if (existingSession) {
      effectiveProjectId = existingSession.project_id
      // Auto-repair: if the session's project FK points to a project that
      // no longer exists (e.g., manual db edit, partial cascade, race
      // condition during a delete), re-resolve it. Without this, upsertSession
      // would update the row in place, leaving the bad project_id, and
      // subsequent queries that JOIN sessions to projects would silently
      // return null project info.
      const projectStillExists = await store.getProjectById(effectiveProjectId)
      if (!projectStillExists) {
        console.log(
          `[event] Session ${parsed.sessionId} references missing project ${effectiveProjectId}; re-resolving`,
        )
        const projectSlugOverride = meta.env?.INSTANTCOFFEE_OBSERVE_PROJECT_SLUG || null
        const resolved = await resolveProject(store, {
          sessionId: parsed.sessionId,
          slug: projectSlugOverride,
          transcriptPath: parsed.transcriptPath,
          cwd: eventCwd,
        })
        effectiveProjectId = resolved.projectId
        await store.updateSessionProject(parsed.sessionId, effectiveProjectId)
      } else if (parsed.subtype === 'SessionStart' && eventCwd && !projectStillExists.cwd) {
        // Lazy re-resolve: the session was assigned before we had a cwd,
        // so the project may have been derived from transcript_path alone.
        // Now that SessionStart has given us a cwd, try to land on the
        // right project — either an existing cwd-keyed one, or create a
        // new one with a cwd-derived slug.
        const projectSlugOverride = meta.env?.INSTANTCOFFEE_OBSERVE_PROJECT_SLUG || null
        const resolved = await resolveProject(store, {
          sessionId: parsed.sessionId,
          slug: projectSlugOverride,
          transcriptPath: parsed.transcriptPath,
          cwd: eventCwd,
        })
        if (resolved.projectId !== effectiveProjectId) {
          console.log(
            `[event] Re-resolving session ${parsed.sessionId} from project ${effectiveProjectId} to ${resolved.projectId} (cwd=${eventCwd})`,
          )
          effectiveProjectId = resolved.projectId
          await store.updateSessionProject(parsed.sessionId, effectiveProjectId)
        }
      }
    } else {
      const projectSlugOverride = meta.env?.INSTANTCOFFEE_OBSERVE_PROJECT_SLUG || null
      const resolved = await resolveProject(store, {
        sessionId: parsed.sessionId,
        slug: projectSlugOverride,
        transcriptPath: parsed.transcriptPath,
        cwd: eventCwd,
      })
      effectiveProjectId = resolved.projectId
    }

    await store.upsertSession(
      parsed.sessionId,
      effectiveProjectId,
      parsed.slug,
      Object.keys(parsed.metadata).length > 0 ? parsed.metadata : null,
      parsed.timestamp,
      parsed.transcriptPath,
    )

    const rootAgentId = await ensureRootAgent(store, parsed.sessionId, parsed.agentClass)

    // Subagent events name their agent explicitly: the pi extension links a
    // child to the call that spawned it (pi itself exposes no link), so the
    // server just records what it is told. The parent is the spawning subagent
    // for nested delegation — but only one this session already knows, so an
    // out-of-order or foreign id can never orphan the tree.
    let agentId = rootAgentId
    let parentId = rootAgentId
    if (parsed.ownerAgentId && parsed.ownerAgentId !== rootAgentId) {
      if (parsed.parentAgentId && parsed.parentAgentId !== parsed.ownerAgentId) {
        const parent = await store.getAgentById(parsed.parentAgentId)
        if (parent && parent.session_id === parsed.sessionId) {
          parentId = parsed.parentAgentId
        }
      }
      await store.upsertAgent(
        parsed.ownerAgentId,
        parsed.sessionId,
        parentId,
        parsed.ownerAgentName,
        parsed.ownerAgentDescription,
        parsed.ownerAgentType,
        parsed.agentClass,
      )
      agentId = parsed.ownerAgentId
    }

    // pi session names (/name, or set by an extension) become the slug.
    if (parsed.subtype === 'SessionRename' && !parsed.ownerAgentId) {
      const name = typeof hookPayload.name === 'string' ? hookPayload.name.trim().slice(0, 256) : ''
      if (name) {
        await store.updateSessionSlug(parsed.sessionId, name)
        broadcastToAll({ type: 'session_update', data: { id: parsed.sessionId, slug: name } })
      }
    }

    // An unnamed session is labelled `<branch>:<id8>` from its git checkout,
    // once. A pi session name — on the envelope, or a later SessionRename —
    // takes precedence, and a branch switch mid-session doesn't rename it.
    const gitBranch = parsed.metadata.git_branch
    if (typeof gitBranch === 'string' && !parsed.ownerAgentId && !parsed.slug) {
      const current = await store.getSessionById(parsed.sessionId)
      if (current && !current.slug) {
        const slug = `${gitBranch}:${parsed.sessionId.split('-')[0]}`
        await store.updateSessionSlug(parsed.sessionId, slug)
        broadcastToAll({ type: 'session_update', data: { id: parsed.sessionId, slug } })
      }
    }

    // Session lifecycle: SessionEnd stops the session, any other event reactivates a stopped session.
    if (parsed.subtype === 'SessionEnd') {
      await store.updateSessionStatus(parsed.sessionId, 'stopped')
      broadcastToAll({
        type: 'session_update',
        data: { id: parsed.sessionId, status: 'stopped' },
      })
    } else {
      const session = await store.getSessionById(parsed.sessionId)
      if (session && session.status === 'stopped') {
        await store.updateSessionStatus(parsed.sessionId, 'active')
        broadcastToAll({
          type: 'session_update',
          data: { id: parsed.sessionId, status: 'active' },
        })
      }
    }

    const now = Date.now()
    const isNotification = config.notificationEventSubtypes.has(parsed.subtype ?? '')

    // Trace-only: shows which events trip the notification bell, for tuning
    // the notification subtype list without wading through payload dumps.
    if (LOG_LEVEL === 'trace' && isNotification) {
      console.log(
        `[NOTIFY] isNotification=true subtype=${parsed.subtype} session=${parsed.sessionId}`,
      )
    }

    // A subagent's lifecycle event (e.g. SubagentStop configured as a
    // notification) is answered by its parent, not by the finished child.
    const notificationOwnerId =
      parsed.subtype === 'SubagentStart' || parsed.subtype === 'SubagentStop' ? parentId : agentId

    let eventId: number
    let notificationTransition: NotificationTransition
    try {
      ;({ eventId, notificationTransition } = await store.insertEvent({
        agentId,
        sessionId: parsed.sessionId,
        type: parsed.type,
        subtype: parsed.subtype,
        toolName: parsed.toolName,
        timestamp: parsed.timestamp,
        payload: parsed.raw,
        toolUseId: parsed.toolUseId,
        signatureHash,
        isNotification,
        notificationOwnerId,
      }))
    } catch (err) {
      // Race: a concurrent identical POST inserted the row between our
      // pre-check and this INSERT. The UNIQUE constraint surfaces as
      // DuplicateEventSignatureError — return the winner's id and skip the
      // rest of the pipeline; the original event already ran its side-effects.
      if (err instanceof DuplicateEventSignatureError) {
        const winner = await store.findEventBySignatureHash(signatureHash)
        if (winner) {
          if (LOG_LEVEL === 'debug' || LOG_LEVEL === 'trace') {
            console.log(
              `[dedup:race] subtype=${parsed.subtype} session=${parsed.sessionId} orig_event_id=${winner.id}`,
            )
          }
          return c.json(
            {
              status: 'OK',
              deduplicated: true,
              meta: { event_id: winner.id, session_id: parsed.sessionId },
            },
            201,
          )
        }
      }
      throw err
    }

    // Broadcast token update for LLM events so sidebar updates in real-time
    if (parsed.subtype === 'LLMGeneration') {
      const session = await store.getSessionById(parsed.sessionId)
      if (session) {
        broadcastToAll({
          type: 'session_update',
          data: {
            id: parsed.sessionId,
            totalInputTokens: session.total_input_tokens || 0,
            totalOutputTokens: session.total_output_tokens || 0,
            totalCacheReadTokens: session.total_cache_read_tokens || 0,
            totalCacheCreationTokens: session.total_cache_creation_tokens || 0,
            totalDurationMs: session.total_duration_ms || 0,
            llmCallCount: session.llm_call_count || 0,
          },
        })
      }
    }

    const event: ParsedEvent = {
      id: eventId,
      agentId,
      sessionId: parsed.sessionId,
      type: parsed.type,
      subtype: parsed.subtype,
      toolName: parsed.toolName,
      toolUseId: parsed.toolUseId,
      status: deriveEventStatus(parsed.subtype),
      timestamp: parsed.timestamp,
      // createdAt is the server-side ingest timestamp; WS subscribers don't
      // read it (the GET endpoint emits it on opt-in via ?fields=createdAt).
      // Drop it from the broadcast to save WS bandwidth.
      payload: parsed.raw,
    }

    broadcastToSession(parsed.sessionId, { type: 'event', data: event })

    // Fire an activity ping for the sidebar pulse animation. The
    // broadcastActivity helper internally throttles to once per
    // session per ACTIVITY_PING_THROTTLE_MS, so calling it on every
    // insert is safe and cheap.
    // projectId rides along so the sidebar can pulse the project folder
    // without fetching each project's session list.
    const broadcastActivity = c.get('broadcastActivity')
    broadcastActivity(parsed.sessionId, eventId, effectiveProjectId)

    // Fan out sidebar notification signals to every connected client so
    // bells can light up regardless of which session the viewer is on — but
    // only when the session's pending state actually changed (see
    // SqliteAdapter.applyNotification for who may clear it).
    if (notificationTransition === 'set') {
      broadcastToAll({
        type: 'notification',
        data: {
          sessionId: parsed.sessionId,
          projectId: effectiveProjectId,
          ts: parsed.timestamp,
        },
      })
    } else if (notificationTransition === 'cleared') {
      broadcastToAll({
        type: 'notification_clear',
        data: {
          sessionId: parsed.sessionId,
          ts: parsed.timestamp,
        },
      })
    }

    const responseBody: Record<string, unknown> = {
      status: 'OK',
      meta: {
        event_id: eventId,
        session_id: parsed.sessionId,
        project_id: effectiveProjectId,
      },
    }

    return c.json(responseBody, 201)
  } catch (error) {
    console.error('Error processing event:', error)
    const message = error instanceof Error ? error.message : String(error)
    // Return 500 (not 400) for genuine processing errors so the client
    // knows it's a server-side issue, not a malformed request. Include
    // the full error message so the dashboard can surface it via toast.
    return apiError(c, 500, 'Failed to process event', { details: message })
  }
})

// GET /events/:id/thread
router.get('/events/:id/thread', async (c) => {
  const store = c.get('store')
  const eventId = parseInt(c.req.param('id'))
  if (isNaN(eventId)) return c.json({ error: 'Invalid ID' }, 400)
  const rows = await store.getThreadForEvent(eventId)
  const events: ParsedEvent[] = rows.map((r) => ({
    id: r.id,
    agentId: r.agent_id,
    sessionId: r.session_id,
    type: r.type,
    subtype: r.subtype,
    toolName: r.tool_name,
    toolUseId: r.tool_use_id || null,
    status: deriveEventStatus(r.subtype),
    timestamp: r.timestamp,
    createdAt: r.created_at || r.timestamp,
    payload: JSON.parse(r.payload),
  }))
  return c.json(events)
})

/** Remove a single session from the in-memory root agent cache */
export function removeSessionRootAgent(sessionId: string): void {
  sessionRootAgents.delete(sessionId)
}

/** Clear all in-memory session state */
export function clearSessionRootAgents(): void {
  sessionRootAgents.clear()
}

export default router
