import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import type { EventStore } from '../storage/types'

type Env = {
  Variables: {
    store: EventStore
    broadcastToSession: (sessionId: string, msg: object) => void
    broadcastToAll: (msg: object) => void
    broadcastActivity: (sessionId: string, eventId: number) => void
  }
}

/** Derive parsed fields from hook payload so the mock parser reflects real parser behavior. */
function makeParsed(hookPayload: Record<string, unknown>) {
  const hookEventName = hookPayload.hook_event_name as string | undefined
  let type = 'tool'
  let subtype: string | null = null
  if (hookEventName) {
    subtype = hookEventName
    if (
      hookEventName === 'SessionStart' ||
      hookEventName === 'SessionEnd' ||
      hookEventName === 'Stop' ||
      hookEventName === 'Notification' ||
      hookEventName === 'CompactionRun' ||
      hookEventName === 'CostUpdate' ||
      hookEventName === 'SubagentStart' ||
      hookEventName === 'SubagentStop' ||
      hookEventName === 'SuperModeToggle'
    ) {
      type = 'system'
    } else if (
      hookEventName === 'DaemonStart' ||
      hookEventName === 'DaemonStop' ||
      hookEventName === 'DaemonHeartbeat'
    ) {
      type = 'daemon'
    } else if (hookEventName === 'LLMGeneration') {
      type = 'llm'
    } else if (hookEventName === 'UserPromptSubmit') {
      type = 'user'
    }
  }

  const ts = hookPayload.timestamp
  const timestamp =
    typeof ts === 'number' ? ts : typeof ts === 'string' ? new Date(ts).getTime() : Date.now()

  return {
    sessionId: (hookPayload.session_id as string) || 'test-session',
    slug: (hookPayload.slug as string) || null,
    transcriptPath: (hookPayload.transcript_path as string) || null,
    type,
    subtype,
    toolName: (hookPayload.tool_name as string) || null,
    toolUseId: (hookPayload.tool_use_id as string) || null,
    timestamp: isNaN(timestamp) ? Date.now() : timestamp,
    ownerAgentId: (hookPayload.agent_id as string) || null,
    subAgentId: null,
    subAgentName: null,
    subAgentDescription: null,
    instanceId: (hookPayload.instance_id as string) || null,
    metadata: {},
    raw: hookPayload,
  }
}

function createStore(overrides = {}) {
  return {
    getSessionById: vi.fn(),
    getProjectById: vi.fn(),
    getProjectBySlug: vi.fn(),
    getProjectByCwd: vi.fn(),
    getProjectByTranscriptPath: vi.fn(),
    upsertSession: vi.fn(),
    upsertAgent: vi.fn(),
    insertEvent: vi.fn(),
    upsertInstance: vi.fn(),
    updateInstanceHeartbeat: vi.fn(),
    getInstancesForSession: vi.fn(),
    updateSessionStatus: vi.fn(),
    updateSessionProject: vi.fn(),
    getThreadForEvent: vi.fn(),
    updateAgentType: vi.fn(),
    ...overrides,
  }
}

async function createApp(storeOverrides = {}) {
  const store = createStore(storeOverrides)
  const broadcastToSession = vi.fn()
  const broadcastToAll = vi.fn()
  const broadcastActivity = vi.fn()

  vi.resetModules()

  vi.doMock('../parser', () => ({
    parseRawEvent: vi.fn((payload: Record<string, unknown>) => makeParsed(payload)),
  }))
  vi.doMock('../services/project-resolver', () => ({
    resolveProject: vi.fn().mockResolvedValue({ projectId: 1, slug: 'test-project' }),
  }))
  vi.doMock('../config', () => ({
    config: {
      logLevel: 'info',
      notificationEventSubtypes: new Set(['Notification']),
    },
  }))
  vi.doMock('../middleware/rate-limit', () => ({
    rateLimit: vi.fn(async (_c: any, next: any) => {
      await next()
    }),
  }))

  const { default: eventsRouter } = await import('./events')

  const app = new Hono<Env>()
  app.use('*', async (c, next) => {
    c.set('store', store as unknown as EventStore)
    c.set('broadcastToSession', broadcastToSession)
    c.set('broadcastToAll', broadcastToAll)
    c.set('broadcastActivity', broadcastActivity)
    await next()
  })
  app.route('/api', eventsRouter)

  return { app, store, broadcastToSession, broadcastToAll, broadcastActivity }
}

/** Helper to set up common store mocks for a successful POST /events request */
function setupSuccessfulPost(store: ReturnType<typeof createStore>, sessionOverrides: Record<string, unknown> = {}) {
  store.getSessionById.mockResolvedValue({
    id: sessionOverrides.id || 'test-session',
    project_id: sessionOverrides.project_id ?? 1,
    slug: (sessionOverrides.slug as string) || null,
    status: (sessionOverrides.status as string) || 'active',
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_cache_read_tokens: 0,
    total_cache_creation_tokens: 0,
    total_duration_ms: 0,
    llm_call_count: 0,
  })
  store.getProjectById.mockResolvedValue({ id: 1, slug: 'test-project' })
  store.upsertSession.mockResolvedValue(undefined)
  store.upsertAgent.mockResolvedValue(undefined)
  store.insertEvent.mockResolvedValue(42)
  store.getInstancesForSession.mockReturnValue([])
}

describe('events routes — POST /events', () => {
  describe('content-type validation', () => {
    it('returns 415 when Content-Type is not application/json', async () => {
      const { app } = await createApp()

      const res = await app.request('/api/events', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: 'not json',
      })

      expect(res.status).toBe(415)
      const body = await res.json()
      expect(body.error).toBe('Content-Type must be application/json')
    })

    it('returns 500 when body is not valid JSON (caught by outer error handler)', async () => {
      const { app } = await createApp()

      const res = await app.request('/api/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not valid { json',
      })

      // Hono's c.req.json() throws SyntaxError, caught by outer catch → 500
      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body.error.message).toBe('Failed to process event')
    })
  })

  describe('missing hook_payload', () => {
    it('returns 400 when hook_payload is missing', async () => {
      const { app } = await createApp()

      const res = await app.request('/api/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ meta: { env: {} } }),
      })

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error.message).toBe('Missing hook_payload in request body')
    })
  })

  describe('successful event processing', () => {
    it('processes a basic event and returns 201 with metadata', async () => {
      const { app, store, broadcastToSession } = await createApp()
      setupSuccessfulPost(store, { id: 'test-session', slug: 'my-session' })

      const res = await app.request('/api/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          hook_payload: {
            hook_event_name: 'PreToolUse',
            tool_name: 'Bash',
            session_id: 'test-session',
            transcript_path: '/tmp/transcript.json',
          },
          meta: {},
        }),
      })

      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.status).toBe('OK')
      expect(body.meta.event_id).toBe(42)
      expect(body.meta.session_id).toBe('test-session')
      expect(body.meta.project_id).toBe(1)

      expect(store.upsertSession).toHaveBeenCalled()
      expect(store.insertEvent).toHaveBeenCalled()
      expect(broadcastToSession).toHaveBeenCalledWith(
        'test-session',
        expect.objectContaining({ type: 'event' }),
      )
    })
  })
})

describe('events routes — POST /events session lifecycle', () => {
  it('resolves project for a new session (no existing session)', async () => {
    const { app, store } = await createApp()

    store.getSessionById.mockResolvedValue(null) // new session
    store.upsertSession.mockResolvedValue(undefined)
    store.upsertAgent.mockResolvedValue(undefined)
    store.insertEvent.mockResolvedValue(1)
    store.getInstancesForSession.mockReturnValue([])

    const res = await app.request('/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        hook_payload: {
          hook_event_name: 'PreToolUse',
          session_id: 'new-session',
        },
        meta: {},
      }),
    })

    expect(res.status).toBe(201)
  })

  it('re-resolves project when existing session references a missing project', async () => {
    const { app, store } = await createApp()

    store.getSessionById.mockResolvedValue({
      id: 'bad-session',
      project_id: 999,
      slug: null,
      status: 'active',
    })
    store.getProjectById.mockResolvedValue(null) // project missing
    store.upsertSession.mockResolvedValue(undefined)
    store.upsertAgent.mockResolvedValue(undefined)
    store.insertEvent.mockResolvedValue(1)
    store.updateSessionProject.mockResolvedValue(undefined)
    store.getInstancesForSession.mockReturnValue([])

    const res = await app.request('/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        hook_payload: {
          hook_event_name: 'PreToolUse',
          session_id: 'bad-session',
        },
        meta: {},
      }),
    })

    expect(res.status).toBe(201)
    expect(store.updateSessionProject).toHaveBeenCalledWith('bad-session', 1)
  })

  it('SessionEnd stops the session and broadcasts session_update', async () => {
    const { app, store, broadcastToAll } = await createApp()
    setupSuccessfulPost(store, { id: 'sess-end', slug: 'ending' })

    const res = await app.request('/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        hook_payload: {
          hook_event_name: 'SessionEnd',
          session_id: 'sess-end',
        },
        meta: {},
      }),
    })

    expect(res.status).toBe(201)
    expect(store.updateSessionStatus).toHaveBeenCalledWith('sess-end', 'stopped')
    expect(broadcastToAll).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'session_update',
        data: { id: 'sess-end', status: 'stopped' },
      }),
    )
  })

  it('reactivates a stopped session on any non-SessionEnd event', async () => {
    const { app, store, broadcastToAll } = await createApp()
    setupSuccessfulPost(store, { id: 'stopped-session', slug: 'stopped', status: 'stopped' })

    const res = await app.request('/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        hook_payload: {
          hook_event_name: 'PreToolUse',
          session_id: 'stopped-session',
        },
        meta: {},
      }),
    })

    expect(res.status).toBe(201)
    expect(store.updateSessionStatus).toHaveBeenCalledWith('stopped-session', 'active')
    expect(broadcastToAll).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'session_update',
        data: { id: 'stopped-session', status: 'active' },
      }),
    )
  })
})

describe('events routes — POST /events instance handling', () => {
  it('upserts instance when instanceId is present on the parsed event', async () => {
    const { app, store, broadcastToSession } = await createApp()
    setupSuccessfulPost(store, { id: 'sess-inst' })
    store.getInstancesForSession.mockReturnValue([
      {
        id: 'inst-1',
        session_id: 'sess-inst',
        role: 'main',
        name: 'my-instance',
        machine_id: 'm1',
        pid: 42,
        first_seen: Date.now(),
        last_heartbeat: Date.now(),
        status: 'active',
      },
    ])

    const res = await app.request('/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        hook_payload: {
          hook_event_name: 'PreToolUse',
          session_id: 'sess-inst',
          instance_id: 'inst-1',
          instance_role: 'main',
          instance_name: 'my-instance',
          machine_id: 'm1',
          pid: 42,
        },
        meta: {},
      }),
    })

    expect(res.status).toBe(201)
    expect(store.upsertInstance).toHaveBeenCalledWith(
      'inst-1',
      'sess-inst',
      'main',
      'my-instance',
      'm1',
      42,
    )
    expect(broadcastToSession).toHaveBeenCalledWith(
      'sess-inst',
      expect.objectContaining({ type: 'instance_update' }),
    )
  })

  it('maps unknown instance_role to "unknown"', async () => {
    const { app, store } = await createApp()
    setupSuccessfulPost(store, { id: 'sess-unk' })
    store.getInstancesForSession.mockReturnValue([
      { id: 'inst-u', session_id: 'sess-unk', role: 'unknown', name: null, machine_id: null, pid: null, first_seen: 1, last_heartbeat: 1, status: 'active' },
    ])

    const res = await app.request('/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        hook_payload: {
          hook_event_name: 'PreToolUse',
          session_id: 'sess-unk',
          instance_id: 'inst-u',
          instance_role: 'bogus_role_xyz',
        },
        meta: {},
      }),
    })

    expect(res.status).toBe(201)
    expect(store.upsertInstance).toHaveBeenCalledWith(
      'inst-u', 'sess-unk', 'unknown', null, null, null,
    )
  })

  it('updates heartbeat for DaemonHeartbeat subtype', async () => {
    const { app, store } = await createApp()
    setupSuccessfulPost(store, { id: 'sess-daemon' })
    store.getInstancesForSession.mockReturnValue([
      { id: 'inst-d', session_id: 'sess-daemon', role: 'daemon', name: null, machine_id: null, pid: null, first_seen: 1, last_heartbeat: 1, status: 'active' },
    ])

    const now = Date.now()
    const res = await app.request('/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        hook_payload: {
          hook_event_name: 'DaemonHeartbeat',
          session_id: 'sess-daemon',
          instance_id: 'inst-d',
          instance_role: 'daemon',
          timestamp: now,
        },
        meta: {},
      }),
    })

    expect(res.status).toBe(201)
    expect(store.updateInstanceHeartbeat).toHaveBeenCalledWith('inst-d', now)
  })

  it('silently skips instance handling for non-string instanceId', async () => {
    const { app, store } = await createApp()
    setupSuccessfulPost(store, { id: 'sess-bad-inst' })

    const res = await app.request('/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        hook_payload: {
          hook_event_name: 'PreToolUse',
          session_id: 'sess-bad-inst',
          instance_id: 42, // number, not string
        },
        meta: {},
      }),
    })

    // Should still succeed — invalid instanceId is silently skipped
    expect(res.status).toBe(201)
    expect(store.upsertInstance).not.toHaveBeenCalled()
  })

  it('silently skips instance handling for empty string instanceId', async () => {
    const { app, store } = await createApp()
    setupSuccessfulPost(store, { id: 'sess-empty-inst' })

    const res = await app.request('/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        hook_payload: {
          hook_event_name: 'PreToolUse',
          session_id: 'sess-empty-inst',
          instance_id: '',
        },
        meta: {},
      }),
    })

    expect(res.status).toBe(201)
    expect(store.upsertInstance).not.toHaveBeenCalled()
  })

  it('silently skips instance handling for overly long instanceId', async () => {
    const { app, store } = await createApp()
    setupSuccessfulPost(store, { id: 'sess-long' })

    const res = await app.request('/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        hook_payload: {
          hook_event_name: 'PreToolUse',
          session_id: 'sess-long',
          instance_id: 'x'.repeat(300),
        },
        meta: {},
      }),
    })

    expect(res.status).toBe(201)
    expect(store.upsertInstance).not.toHaveBeenCalled()
  })
})

describe('events routes — POST /events broadcast behavior', () => {
  it('broadcasts event to session subscribers', async () => {
    const { app, store, broadcastToSession } = await createApp()
    setupSuccessfulPost(store, { id: 'sess-bcast' })

    await app.request('/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        hook_payload: {
          hook_event_name: 'PreToolUse',
          tool_name: 'Bash',
          session_id: 'sess-bcast',
        },
        meta: {},
      }),
    })

    expect(broadcastToSession).toHaveBeenCalledWith(
      'sess-bcast',
      expect.objectContaining({
        type: 'event',
        data: expect.objectContaining({
          sessionId: 'sess-bcast',
          type: 'tool',
          subtype: 'PreToolUse',
          toolName: 'Bash',
        }),
      }),
    )
  })

  it('broadcasts notification when subtype is in notificationEventSubtypes', async () => {
    vi.resetModules()

    vi.doMock('../config', () => ({
      config: {
        logLevel: 'info',
        notificationEventSubtypes: new Set(['Notification', 'Stop']),
      },
    }))
    vi.doMock('../middleware/rate-limit', () => ({
      rateLimit: vi.fn(async (_c: any, next: any) => {
        await next()
      }),
    }))
    vi.doMock('../parser', () => ({
      parseRawEvent: vi.fn((payload: Record<string, unknown>) => makeParsed(payload)),
    }))
    vi.doMock('../services/project-resolver', () => ({
      resolveProject: vi.fn().mockResolvedValue({ projectId: 1, slug: 'test-project' }),
    }))

    const { default: eventsRouter } = await import('./events')

    const store = createStore()
    store.getSessionById.mockResolvedValue({ id: 's-notify', project_id: 1, slug: null, status: 'active' })
    store.getProjectById.mockResolvedValue({ id: 1 })
    store.upsertSession.mockResolvedValue(undefined)
    store.upsertAgent.mockResolvedValue(undefined)
    store.insertEvent.mockResolvedValue(1)
    store.getInstancesForSession.mockReturnValue([])

    const broadcastToAll = vi.fn()
    const app = new Hono<Env>()
    app.use('*', async (c, next) => {
      c.set('store', store as unknown as EventStore)
      c.set('broadcastToSession', vi.fn())
      c.set('broadcastToAll', broadcastToAll)
      c.set('broadcastActivity', vi.fn())
      await next()
    })
    app.route('/api', eventsRouter)

    await app.request('/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        hook_payload: { hook_event_name: 'Notification', session_id: 's-notify' },
        meta: {},
      }),
    })

    expect(broadcastToAll).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'notification' }),
    )
  })

  it('broadcasts notification_clear for subtypes NOT in notificationEventSubtypes', async () => {
    const { app, store, broadcastToAll } = await createApp()
    setupSuccessfulPost(store, { id: 'sess-clear' })

    await app.request('/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        hook_payload: {
          hook_event_name: 'PreToolUse',
          session_id: 'sess-clear',
        },
        meta: {},
      }),
    })

    const notificationClearCalls = broadcastToAll.mock.calls.filter(
      (call: any[]) => call[0]?.type === 'notification_clear',
    )
    expect(notificationClearCalls.length).toBeGreaterThan(0)
    expect(notificationClearCalls[0][0]).toEqual(
      expect.objectContaining({
        type: 'notification_clear',
        data: expect.objectContaining({ sessionId: 'sess-clear' }),
      }),
    )
  })

  it('calls broadcastActivity for every event', async () => {
    const { app, store, broadcastActivity } = await createApp()
    setupSuccessfulPost(store, { id: 'test-session' })

    await app.request('/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        hook_payload: {
          hook_event_name: 'PreToolUse',
          session_id: 'test-session',
        },
        meta: {},
      }),
    })

    expect(broadcastActivity).toHaveBeenCalledWith('test-session', 42)
  })
})

describe('events routes — POST /events error handling', () => {
  it('returns 500 when an unexpected error occurs during processing', async () => {
    vi.resetModules()

    vi.doMock('../config', () => ({
      config: {
        logLevel: 'info',
        notificationEventSubtypes: new Set(['Notification']),
      },
    }))
    vi.doMock('../middleware/rate-limit', () => ({
      rateLimit: vi.fn(async (_c: any, next: any) => {
        await next()
      }),
    }))
    vi.doMock('../parser', () => ({
      parseRawEvent: vi.fn().mockImplementation(() => {
        throw new Error('Parser exploded')
      }),
    }))
    vi.doMock('../services/project-resolver', () => ({
      resolveProject: vi.fn(),
    }))

    const { default: eventsRouter } = await import('./events')

    const store = createStore()
    const app = new Hono<Env>()
    app.use('*', async (c, next) => {
      c.set('store', store as unknown as EventStore)
      c.set('broadcastToSession', vi.fn())
      c.set('broadcastToAll', vi.fn())
      c.set('broadcastActivity', vi.fn())
      await next()
    })
    app.route('/api', eventsRouter)

    const res = await app.request('/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        hook_payload: { session_id: 'bad' },
        meta: {},
      }),
    })

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error.message).toBe('Failed to process event')
  })
})

describe('events routes — GET /events/:id/thread', () => {
  it('returns 400 for non-numeric event ID', async () => {
    const { app } = await createApp()

    const res = await app.request('/api/events/abc/thread')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Invalid ID')
  })

  it('returns 404 when event ID is empty (route does not match)', async () => {
    const { app } = await createApp()

    const res = await app.request('/api/events//thread')
    // Hono doesn't match the route when :id is empty, returns 404
    expect(res.status).toBe(404)
  })

  it('returns thread events for a valid event ID', async () => {
    const { app, store } = await createApp()

    store.getThreadForEvent.mockResolvedValue([
      {
        id: 10,
        agent_id: 'agent-1',
        session_id: 'sess-1',
        type: 'tool',
        subtype: 'PreToolUse',
        tool_name: 'Bash',
        tool_use_id: null,
        instance_id: null,
        timestamp: 1700000000000,
        created_at: 1700000000100,
        payload: JSON.stringify({ cmd: 'ls' }),
      },
      {
        id: 11,
        agent_id: 'agent-1',
        session_id: 'sess-1',
        type: 'tool',
        subtype: 'PostToolUse',
        tool_name: 'Bash',
        tool_use_id: 'tu-1',
        instance_id: null,
        timestamp: 1700000001000,
        created_at: 1700000001100,
        payload: JSON.stringify({ result: 'ok' }),
      },
    ])

    const res = await app.request('/api/events/10/thread')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(2)
    expect(body[0]).toEqual({
      id: 10,
      agentId: 'agent-1',
      sessionId: 'sess-1',
      type: 'tool',
      subtype: 'PreToolUse',
      toolName: 'Bash',
      toolUseId: null,
      instanceId: null,
      status: 'running',
      timestamp: 1700000000000,
      createdAt: 1700000000100,
      payload: { cmd: 'ls' },
    })
    expect(body[1].status).toBe('completed') // PostToolUse -> completed
    expect(store.getThreadForEvent).toHaveBeenCalledWith(10)
  })

  it('returns empty array when event has no thread', async () => {
    const { app, store } = await createApp()

    store.getThreadForEvent.mockResolvedValue([])

    const res = await app.request('/api/events/99/thread')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([])
  })

  it('falls back to timestamp for createdAt when created_at is missing', async () => {
    const { app, store } = await createApp()

    store.getThreadForEvent.mockResolvedValue([
      {
        id: 1,
        agent_id: 'a1',
        session_id: 's1',
        type: 'system',
        subtype: 'Stop',
        tool_name: null,
        tool_use_id: null,
        instance_id: null,
        timestamp: 1700000000000,
        payload: JSON.stringify({}),
      },
    ])

    const res = await app.request('/api/events/1/thread')
    const body = await res.json()
    expect(body[0].createdAt).toBe(1700000000000) // falls back to timestamp
  })

  it('maps deriveEventStatus correctly: PreToolUse -> running', async () => {
    const { app, store } = await createApp()

    store.getThreadForEvent.mockResolvedValue([
      {
        id: 1, agent_id: 'a1', session_id: 's1', type: 'tool',
        subtype: 'PreToolUse', tool_name: null, tool_use_id: null,
        instance_id: null, timestamp: 1700000000000, created_at: 1700000000100,
        payload: JSON.stringify({}),
      },
    ])

    const res = await app.request('/api/events/1/thread')
    const body = await res.json()
    expect(body[0].status).toBe('running')
  })

  it('maps deriveEventStatus correctly: PostToolUse -> completed', async () => {
    const { app, store } = await createApp()

    store.getThreadForEvent.mockResolvedValue([
      {
        id: 1, agent_id: 'a1', session_id: 's1', type: 'tool',
        subtype: 'PostToolUse', tool_name: null, tool_use_id: null,
        instance_id: null, timestamp: 1700000000000, created_at: 1700000000100,
        payload: JSON.stringify({}),
      },
    ])

    const res = await app.request('/api/events/1/thread')
    const body = await res.json()
    expect(body[0].status).toBe('completed')
  })

  it('maps deriveEventStatus correctly: unknown subtype -> pending', async () => {
    const { app, store } = await createApp()

    store.getThreadForEvent.mockResolvedValue([
      {
        id: 1, agent_id: 'a1', session_id: 's1', type: 'system',
        subtype: 'UnknownSubtype', tool_name: null, tool_use_id: null,
        instance_id: null, timestamp: 1700000000000, created_at: 1700000000100,
        payload: JSON.stringify({}),
      },
    ])

    const res = await app.request('/api/events/1/thread')
    const body = await res.json()
    expect(body[0].status).toBe('pending')
  })

  it('maps tool_use_id and instance_id from DB fields', async () => {
    const { app, store } = await createApp()

    store.getThreadForEvent.mockResolvedValue([
      {
        id: 1, agent_id: 'a1', session_id: 's1', type: 'tool',
        subtype: 'PreToolUse', tool_name: 'Write',
        tool_use_id: 'tu-xyz', instance_id: 'inst-xyz',
        timestamp: 1700000000000, created_at: 1700000000100,
        payload: JSON.stringify({}),
      },
    ])

    const res = await app.request('/api/events/1/thread')
    const body = await res.json()
    expect(body[0].toolUseId).toBe('tu-xyz')
    expect(body[0].instanceId).toBe('inst-xyz')
  })
})
