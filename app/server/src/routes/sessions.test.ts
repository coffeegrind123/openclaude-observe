import { describe, test, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { EventStore } from '../storage/types'

type Env = {
  Variables: {
    store: EventStore
    broadcastToSession: (sessionId: string, msg: object) => void
    broadcastToAll: (msg: object) => void
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createStore(overrides: Record<string, unknown> = {}) {
  return {
    getUnassignedSessions: vi.fn().mockResolvedValue([]),
    getRecentSessions: vi.fn().mockResolvedValue([]),
    getSessionById: vi.fn().mockResolvedValue(null),
    getAgentsForSession: vi.fn().mockResolvedValue([]),
    getEventsForSession: vi.fn().mockResolvedValue([]),
    getEventsSince: vi.fn().mockResolvedValue([]),
    getSessionUsage: vi.fn().mockResolvedValue(null),
    updateSessionStatus: vi.fn().mockResolvedValue(undefined),
    updateSessionSlug: vi.fn().mockResolvedValue(undefined),
    updateSessionProject: vi.fn().mockResolvedValue(undefined),
    patchSessionMetadata: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

/** Build a minimal valid DB row used by many endpoints. */
function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess-1',
    project_id: 1,
    project_name: 'my-project',
    project_slug: 'my-project',
    slug: null,
    transcript_path: '/tmp/transcript.json',
    status: 'active',
    started_at: 1700000000000,
    stopped_at: null,
    metadata: '{"key":"value"}',
    agent_count: 3,
    event_count: 150,
    last_activity: 1700000100000,
    total_input_tokens: 5000,
    total_output_tokens: 3000,
    total_cache_read_tokens: 1000,
    total_cache_creation_tokens: 200,
    total_duration_ms: 12000,
    llm_call_count: 5,
    ...overrides,
  }
}

function agentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-1',
    session_id: 'sess-1',
    parent_agent_id: null,
    name: 'Root Agent',
    description: 'The root',
    agent_type: 'primary',
    ...overrides,
  }
}

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    agent_id: 'agent-1',
    session_id: 'sess-1',
    type: 'LLMCall',
    subtype: 'LLMGeneration',
    tool_name: null,
    tool_use_id: null,
    timestamp: 1700000001000,
    created_at: 1700000001000,
    payload: JSON.stringify({ input_tokens: 100, output_tokens: 50 }),
    ...overrides,
  }
}

function usagePayload(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'sess-1',
    totalInputTokens: 5000,
    totalOutputTokens: 3000,
    totalCacheReadTokens: 1000,
    totalCacheCreationTokens: 200,
    totalDurationMs: 12000,
    llmCallCount: 5,
    agentUsage: [
      {
        agentId: 'agent-1',
        agentName: 'Root Agent',
        inputTokens: 5000,
        outputTokens: 3000,
        cacheReadTokens: 1000,
        cacheCreationTokens: 200,
        durationMs: 12000,
        llmCallCount: 5,
      },
    ],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Build the app once per suite via vi.doMock (mirrors admin.test.ts)
// ---------------------------------------------------------------------------

describe('sessions routes', () => {
  let app: Hono<Env>
  let store: ReturnType<typeof createStore>
  let broadcastToSession: ReturnType<typeof vi.fn>
  let broadcastToAll: ReturnType<typeof vi.fn>
  let computeSessionContext: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()

    store = createStore()
    broadcastToSession = vi.fn()
    broadcastToAll = vi.fn()
    computeSessionContext = vi.fn()

    vi.doMock('../config', () => ({
      config: { logLevel: 'info' },
    }))
    vi.doMock('../errors', () => ({
      apiError: vi.fn((c: any, status: number, message: string) =>
        c.json({ error: { message } }, status),
      ),
    }))
    vi.doMock('../context', () => ({
      computeSessionContext,
    }))

    const { default: sessionsRouter } = await import('./sessions')

    app = new Hono<Env>()
    app.use('*', async (c, next) => {
      c.set('store', store as unknown as EventStore)
      c.set('broadcastToSession', broadcastToSession)
      c.set('broadcastToAll', broadcastToAll)
      await next()
    })
    app.route('/', sessionsRouter)
  })

  // -----------------------------------------------------------------------
  // GET /sessions/unassigned
  // -----------------------------------------------------------------------
  describe('GET /sessions/unassigned', () => {
    test('returns mapped rows with all fields', async () => {
      const row = sessionRow()
      store.getUnassignedSessions.mockResolvedValue([row])

      const res = await app.request('/sessions/unassigned')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveLength(1)
      expect(body[0]).toEqual({
        id: 'sess-1',
        projectId: 1,
        projectName: 'my-project',
        projectSlug: 'my-project',
        slug: null,
        transcriptPath: '/tmp/transcript.json',
        status: 'active',
        startedAt: 1700000000000,
        stoppedAt: null,
        metadata: { key: 'value' },
        agentCount: 3,
        eventCount: 150,
        lastActivity: 1700000100000,
        totalInputTokens: 5000,
        totalOutputTokens: 3000,
        totalCacheReadTokens: 1000,
        totalCacheCreationTokens: 200,
        totalDurationMs: 12000,
        llmCallCount: 5,
      })
    })

    test('defaults null metadata to null', async () => {
      store.getUnassignedSessions.mockResolvedValue([
        sessionRow({ metadata: null }),
      ])
      const res = await app.request('/sessions/unassigned')
      const body = await res.json()
      expect(body[0].metadata).toBeNull()
    })

    test('defaults zero-token fields to 0 when falsy', async () => {
      store.getUnassignedSessions.mockResolvedValue([
        sessionRow({
          total_input_tokens: 0,
          total_output_tokens: undefined,
          total_cache_read_tokens: null,
          total_cache_creation_tokens: undefined,
          total_duration_ms: 0,
          llm_call_count: undefined,
        }),
      ])
      const res = await app.request('/sessions/unassigned')
      const body = await res.json()
      expect(body[0].totalInputTokens).toBe(0)
      expect(body[0].totalOutputTokens).toBe(0)
      expect(body[0].totalCacheReadTokens).toBe(0)
      expect(body[0].totalCacheCreationTokens).toBe(0)
      expect(body[0].totalDurationMs).toBe(0)
      expect(body[0].llmCallCount).toBe(0)
    })

    test('passes undefined limit when query param is missing', async () => {
      store.getUnassignedSessions.mockResolvedValue([])
      const res = await app.request('/sessions/unassigned')
      expect(res.status).toBe(200)
      expect(store.getUnassignedSessions).toHaveBeenCalledWith(undefined)
    })

    test('passes parsed numeric limit', async () => {
      store.getUnassignedSessions.mockResolvedValue([])
      const res = await app.request('/sessions/unassigned?limit=10')
      expect(res.status).toBe(200)
      expect(store.getUnassignedSessions).toHaveBeenCalledWith(10)
    })

    test('treats NaN limit as undefined', async () => {
      store.getUnassignedSessions.mockResolvedValue([])
      const res = await app.request('/sessions/unassigned?limit=abc')
      expect(res.status).toBe(200)
      expect(store.getUnassignedSessions).toHaveBeenCalledWith(undefined)
    })

    test('returns empty array when no unassigned sessions', async () => {
      store.getUnassignedSessions.mockResolvedValue([])
      const res = await app.request('/sessions/unassigned')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([])
    })
  })

  // -----------------------------------------------------------------------
  // GET /sessions/recent
  // -----------------------------------------------------------------------
  describe('GET /sessions/recent', () => {
    test('returns mapped rows', async () => {
      store.getRecentSessions.mockResolvedValue([sessionRow()])
      const res = await app.request('/sessions/recent')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveLength(1)
      expect(body[0].id).toBe('sess-1')
      expect(body[0].projectId).toBe(1)
    })

    test('defaults limit to 20 when query param is missing', async () => {
      store.getRecentSessions.mockResolvedValue([])
      const res = await app.request('/sessions/recent')
      expect(res.status).toBe(200)
      expect(store.getRecentSessions).toHaveBeenCalledWith(20)
    })

    test('uses custom numeric limit', async () => {
      store.getRecentSessions.mockResolvedValue([])
      const res = await app.request('/sessions/recent?limit=5')
      expect(res.status).toBe(200)
      expect(store.getRecentSessions).toHaveBeenCalledWith(5)
    })

    test('defaults NaN limit to 20', async () => {
      store.getRecentSessions.mockResolvedValue([])
      const res = await app.request('/sessions/recent?limit=xyz')
      expect(res.status).toBe(200)
      expect(store.getRecentSessions).toHaveBeenCalledWith(20)
    })
  })

  // -----------------------------------------------------------------------
  // GET /sessions/:id
  // -----------------------------------------------------------------------
  describe('GET /sessions/:id', () => {
    test('returns session when found', async () => {
      store.getSessionById.mockResolvedValue(sessionRow())
      const res = await app.request('/sessions/sess-1')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.id).toBe('sess-1')
    })

    test('returns 404 when session not found', async () => {
      store.getSessionById.mockResolvedValue(null)
      const res = await app.request('/sessions/nonexistent')
      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.error.message).toBe('Session not found')
    })

    test('decodes URL-encoded session id', async () => {
      store.getSessionById.mockResolvedValue(sessionRow())
      const res = await app.request('/sessions/my%20session%2F1')
      expect(res.status).toBe(200)
      expect(store.getSessionById).toHaveBeenCalledWith('my session/1')
    })

    test('returns 400 for malformed URI encoding', async () => {
      // %E0%A4%A decodes to invalid UTF-8, causing decodeURIComponent to throw.
      // The route catches the URIError and returns { error: "string" } (plain string, not object).
      const res = await app.request('/sessions/%E0%A4%A')
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('Invalid URL encoding')
    })

    test('maps all camelCase fields', async () => {
      store.getSessionById.mockResolvedValue(
        sessionRow({
          transcript_path: null,
          metadata: null,
          total_input_tokens: undefined,
          total_output_tokens: undefined,
          total_cache_read_tokens: undefined,
          total_cache_creation_tokens: undefined,
          total_duration_ms: undefined,
          llm_call_count: undefined,
        }),
      )
      const res = await app.request('/sessions/sess-1')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.transcriptPath).toBeNull()
      expect(body.metadata).toBeNull()
      expect(body.totalInputTokens).toBe(0)
      expect(body.totalOutputTokens).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // GET /sessions/:id/agents
  // -----------------------------------------------------------------------
  describe('GET /sessions/:id/agents', () => {
    test('returns mapped agent list', async () => {
      store.getAgentsForSession.mockResolvedValue([
        agentRow(),
        agentRow({
          id: 'agent-2',
          parent_agent_id: 'agent-1',
          name: 'Child Agent',
          description: null,
          agent_type: null,
        }),
      ])
      const res = await app.request('/sessions/sess-1/agents')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveLength(2)
      expect(body[0]).toEqual({
        id: 'agent-1',
        sessionId: 'sess-1',
        parentAgentId: null,
        name: 'Root Agent',
        description: 'The root',
        agentType: 'primary',
      })
      expect(body[1]).toEqual({
        id: 'agent-2',
        sessionId: 'sess-1',
        parentAgentId: 'agent-1',
        name: 'Child Agent',
        description: null,
        agentType: null,
      })
    })

    test('returns empty array when no agents', async () => {
      store.getAgentsForSession.mockResolvedValue([])
      const res = await app.request('/sessions/sess-1/agents')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([])
    })

    test('returns 400 for invalid URL encoding', async () => {
      const res = await app.request('/sessions/%E0%A4%A/agents')
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('Invalid URL encoding')
    })
  })

  // -----------------------------------------------------------------------
  // GET /sessions/:id/events
  // -----------------------------------------------------------------------
  describe('GET /sessions/:id/events', () => {
    test('returns mapped events', async () => {
      store.getEventsForSession.mockResolvedValue([
        eventRow(),
        eventRow({ id: 2, subtype: 'PreToolUse', tool_name: 'Read', tool_use_id: 'tu-1' }),
      ])
      const res = await app.request('/sessions/sess-1/events')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveLength(2)
      expect(body[0]).toMatchObject({
        id: 1,
        agentId: 'agent-1',
        type: 'LLMCall',
        subtype: 'LLMGeneration',
      })
      // derived status from subtype
      // deriveEventStatus("LLMGeneration"): not "PreToolUse", not "PostToolUse" → "pending"
      expect(body[0].status).toBe('pending')
    })

    test('deriveEventStatus returns running for PreToolUse', async () => {
      store.getEventsForSession.mockResolvedValue([
        eventRow({ subtype: 'PreToolUse' }),
      ])
      const res = await app.request('/sessions/sess-1/events')
      const body = await res.json()
      expect(body[0].status).toBe('running')
    })

    test('deriveEventStatus returns completed for PostToolUse', async () => {
      store.getEventsForSession.mockResolvedValue([
        eventRow({ subtype: 'PostToolUse' }),
      ])
      const res = await app.request('/sessions/sess-1/events')
      const body = await res.json()
      expect(body[0].status).toBe('completed')
    })

    test('deriveEventStatus returns pending for other subtypes', async () => {
      store.getEventsForSession.mockResolvedValue([
        eventRow({ subtype: 'LLMGeneration' }),
      ])
      const res = await app.request('/sessions/sess-1/events')
      const body = await res.json()
      expect(body[0].status).toBe('pending')
    })

    test('parses JSON payload', async () => {
      store.getEventsForSession.mockResolvedValue([
        eventRow({ payload: JSON.stringify({ foo: 'bar' }) }),
      ])
      const res = await app.request('/sessions/sess-1/events')
      const body = await res.json()
      expect(body[0].payload).toEqual({ foo: 'bar' })
    })

    test('uses since param to call getEventsSince', async () => {
      store.getEventsSince.mockResolvedValue([eventRow()])
      const res = await app.request('/sessions/sess-1/events?since=1700000000000')
      expect(res.status).toBe(200)
      expect(store.getEventsSince).toHaveBeenCalledWith('sess-1', 1700000000000)
      expect(store.getEventsForSession).not.toHaveBeenCalled()
    })

    test('ignores invalid since param (NaN) and falls through to getEventsForSession', async () => {
      store.getEventsForSession.mockResolvedValue([eventRow()])
      const res = await app.request('/sessions/sess-1/events?since=abc')
      expect(res.status).toBe(200)
      expect(store.getEventsForSession).toHaveBeenCalled()
      expect(store.getEventsSince).not.toHaveBeenCalled()
    })

    test('passes agentId filter split by comma', async () => {
      store.getEventsForSession.mockResolvedValue([])
      await app.request('/sessions/sess-1/events?agentId=a,b,c')
      expect(store.getEventsForSession).toHaveBeenCalledWith('sess-1', {
        agentIds: ['a', 'b', 'c'],
        type: undefined,
        subtype: undefined,
        search: undefined,
        limit: undefined,
        offset: undefined,
      })
    })

    test('passes type, subtype, search filters', async () => {
      store.getEventsForSession.mockResolvedValue([])
      await app.request('/sessions/sess-1/events?type=LLMCall&subtype=LLMGeneration&search=hello')
      expect(store.getEventsForSession).toHaveBeenCalledWith('sess-1', {
        agentIds: undefined,
        type: 'LLMCall',
        subtype: 'LLMGeneration',
        search: 'hello',
        limit: undefined,
        offset: undefined,
      })
    })

    test('passes limit and offset', async () => {
      store.getEventsForSession.mockResolvedValue([])
      await app.request('/sessions/sess-1/events?limit=50&offset=100')
      expect(store.getEventsForSession).toHaveBeenCalledWith('sess-1', {
        agentIds: undefined,
        type: undefined,
        subtype: undefined,
        search: undefined,
        limit: 50,
        offset: 100,
      })
    })

    test('ignores NaN limit/offset', async () => {
      store.getEventsForSession.mockResolvedValue([])
      await app.request('/sessions/sess-1/events?limit=abc&offset=xyz')
      expect(store.getEventsForSession).toHaveBeenCalledWith('sess-1', {
        agentIds: undefined,
        type: undefined,
        subtype: undefined,
        search: undefined,
        limit: undefined,
        offset: undefined,
      })
    })

    test('fields opt-in: omits sessionId and createdAt by default', async () => {
      store.getEventsForSession.mockResolvedValue([eventRow()])
      const res = await app.request('/sessions/sess-1/events')
      const body = await res.json()
      expect(body[0]).not.toHaveProperty('sessionId')
      expect(body[0]).not.toHaveProperty('createdAt')
    })

    test('fields opt-in: includes sessionId when requested', async () => {
      store.getEventsForSession.mockResolvedValue([eventRow()])
      const res = await app.request('/sessions/sess-1/events?fields=sessionId')
      const body = await res.json()
      expect(body[0].sessionId).toBe('sess-1')
      expect(body[0]).not.toHaveProperty('createdAt')
    })

    test('fields opt-in: includes createdAt when requested (falls back to timestamp)', async () => {
      store.getEventsForSession.mockResolvedValue([
        eventRow({ created_at: undefined }),
      ])
      const res = await app.request('/sessions/sess-1/events?fields=createdAt')
      const body = await res.json()
      expect(body[0].createdAt).toBe(1700000001000) // falls back to timestamp
    })

    test('fields opt-in: includes both when both requested', async () => {
      store.getEventsForSession.mockResolvedValue([eventRow({ created_at: 1700000002000 })])
      const res = await app.request(
        '/sessions/sess-1/events?fields=sessionId,createdAt',
      )
      const body = await res.json()
      expect(body[0].sessionId).toBe('sess-1')
      expect(body[0].createdAt).toBe(1700000002000)
    })

    test('fields opt-in: ignores unknown field names', async () => {
      store.getEventsForSession.mockResolvedValue([eventRow()])
      const res = await app.request(
        '/sessions/sess-1/events?fields=sessionId,foo,bar',
      )
      const body = await res.json()
      expect(body[0].sessionId).toBe('sess-1')
      expect(body[0]).not.toHaveProperty('foo')
    })

    test('returns 400 for invalid URL encoding', async () => {
      const res = await app.request('/sessions/%E0%A4%A/events')
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('Invalid URL encoding')
    })

    describe('session status correction', () => {
      test('corrects status when last event is SessionEnd and session is active', async () => {
        store.getEventsForSession.mockResolvedValue([
          eventRow({ id: 1, subtype: 'LLMGeneration' }),
          eventRow({ id: 2, subtype: 'SessionEnd' }),
        ])
        store.getSessionById.mockResolvedValue(sessionRow({ status: 'active' }))

        const res = await app.request('/sessions/sess-1/events')
        expect(res.status).toBe(200)
        expect(store.updateSessionStatus).toHaveBeenCalledWith('sess-1', 'stopped')
      })

      test('corrects status when events exist after SessionEnd but session is stopped', async () => {
        store.getEventsForSession.mockResolvedValue([
          eventRow({ id: 1, subtype: 'SessionEnd' }),
          eventRow({ id: 2, subtype: 'LLMGeneration' }),
        ])
        store.getSessionById.mockResolvedValue(sessionRow({ status: 'stopped' }))

        await app.request('/sessions/sess-1/events')
        expect(store.updateSessionStatus).toHaveBeenCalledWith('sess-1', 'active')
      })

      test('corrects status when no SessionEnd exists but session is stopped', async () => {
        store.getEventsForSession.mockResolvedValue([
          eventRow({ id: 1, subtype: 'LLMGeneration' }),
          eventRow({ id: 2, subtype: 'PreToolUse' }),
        ])
        store.getSessionById.mockResolvedValue(sessionRow({ status: 'stopped' }))

        await app.request('/sessions/sess-1/events')
        expect(store.updateSessionStatus).toHaveBeenCalledWith('sess-1', 'active')
      })

      test('does NOT correct when last event is SessionEnd and session is already stopped', async () => {
        store.getEventsForSession.mockResolvedValue([
          eventRow({ id: 1, subtype: 'LLMGeneration' }),
          eventRow({ id: 2, subtype: 'SessionEnd' }),
        ])
        store.getSessionById.mockResolvedValue(sessionRow({ status: 'stopped' }))

        await app.request('/sessions/sess-1/events')
        expect(store.updateSessionStatus).not.toHaveBeenCalled()
      })

      test('does NOT correct when session query returns null', async () => {
        store.getEventsForSession.mockResolvedValue([
          eventRow({ id: 1, subtype: 'SessionEnd' }),
        ])
        store.getSessionById.mockResolvedValue(null)

        await app.request('/sessions/sess-1/events')
        expect(store.updateSessionStatus).not.toHaveBeenCalled()
      })

      test('does NOT correct when events array is empty', async () => {
        store.getEventsForSession.mockResolvedValue([])

        await app.request('/sessions/sess-1/events')
        expect(store.getSessionById).not.toHaveBeenCalled()
        expect(store.updateSessionStatus).not.toHaveBeenCalled()
      })
    })
  })

  // -----------------------------------------------------------------------
  // GET /sessions/:id/usage
  // -----------------------------------------------------------------------
  describe('GET /sessions/:id/usage', () => {
    test('returns usage when found', async () => {
      const usage = usagePayload()
      store.getSessionUsage.mockResolvedValue(usage)
      const res = await app.request('/sessions/sess-1/usage')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual(usage)
    })

    test('returns 404 when usage not found', async () => {
      store.getSessionUsage.mockResolvedValue(null)
      const res = await app.request('/sessions/sess-1/usage')
      expect(res.status).toBe(404)
      expect((await res.json()).error.message).toBe('Session not found')
    })

    test('returns 400 for invalid URL encoding', async () => {
      const res = await app.request('/sessions/%E0%A4%A/usage')
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('Invalid URL encoding')
    })
  })

  // -----------------------------------------------------------------------
  // GET /sessions/:id/context
  // -----------------------------------------------------------------------
  describe('GET /sessions/:id/context', () => {
    test('returns context breakdown for a session', async () => {
      store.getSessionById.mockResolvedValue(sessionRow())
      store.getEventsForSession.mockResolvedValue([eventRow()])
      const breakdown = {
        sessionId: 'sess-1',
        turns: [],
        aggregates: {},
        peakInputTokens: 0,
      }
      computeSessionContext.mockReturnValue(breakdown)

      const res = await app.request('/sessions/sess-1/context')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual(breakdown)
      expect(store.getEventsForSession).toHaveBeenCalledWith('sess-1', {
        limit: 10000,
      })
    })

    test('returns 404 when session not found', async () => {
      store.getSessionById.mockResolvedValue(null)
      const res = await app.request('/sessions/sess-1/context')
      expect(res.status).toBe(404)
      expect((await res.json()).error.message).toBe('Session not found')
    })

    test('returns 413 when event count reaches MAX_CONTEXT_EVENTS', async () => {
      store.getSessionById.mockResolvedValue(sessionRow())
      const events = Array.from({ length: 10000 }, (_, i) =>
        eventRow({ id: i + 1 }),
      )
      store.getEventsForSession.mockResolvedValue(events)

      const res = await app.request('/sessions/sess-1/context')
      expect(res.status).toBe(413)
      const body = await res.json()
      expect(body.error.message).toContain('10000')
      expect(computeSessionContext).not.toHaveBeenCalled()
    })

    test('does not return 413 when event count is below threshold', async () => {
      store.getSessionById.mockResolvedValue(sessionRow())
      const events = Array.from({ length: 9999 }, (_, i) =>
        eventRow({ id: i + 1 }),
      )
      store.getEventsForSession.mockResolvedValue(events)
      computeSessionContext.mockReturnValue({ sessionId: 'sess-1', turns: [], aggregates: {}, peakInputTokens: 0 })

      const res = await app.request('/sessions/sess-1/context')
      expect(res.status).toBe(200)
    })

    test('returns 400 for invalid URL encoding', async () => {
      const res = await app.request('/sessions/%E0%A4%A/context')
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('Invalid URL encoding')
    })
  })

  // -----------------------------------------------------------------------
  // PATCH /sessions/:id
  // -----------------------------------------------------------------------
  describe('PATCH /sessions/:id', () => {
    test('returns 415 when Content-Type is not application/json', async () => {
      const res = await app.request('/sessions/sess-1', {
        method: 'PATCH',
        headers: { 'content-type': 'text/plain' },
        body: '{}',
      })
      expect(res.status).toBe(415)
      const body = await res.json()
      expect(body.error).toBe('Content-Type must be application/json')
    })

    test('returns 415 when Content-Type header is missing', async () => {
      const res = await app.request('/sessions/sess-1', {
        method: 'PATCH',
        body: '{}',
      })
      expect(res.status).toBe(415)
    })

    test('updates slug and broadcasts', async () => {
      const res = await app.request('/sessions/sess-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: 'new-slug' }),
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })
      expect(store.updateSessionSlug).toHaveBeenCalledWith('sess-1', 'new-slug')
      expect(broadcastToAll).toHaveBeenCalledWith({
        type: 'session_update',
        data: { id: 'sess-1', slug: 'new-slug' },
      })
    })

    test('trims slug whitespace', async () => {
      const res = await app.request('/sessions/sess-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: '  spaced-slug  ' }),
      })
      expect(res.status).toBe(200)
      expect(store.updateSessionSlug).toHaveBeenCalledWith('sess-1', 'spaced-slug')
    })

    test('returns 400 for empty slug after trim', async () => {
      const res = await app.request('/sessions/sess-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: '   ' }),
      })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error.message).toBe('slug must not be empty')
      expect(store.updateSessionSlug).not.toHaveBeenCalled()
    })

    test('returns 400 for empty string slug', async () => {
      const res = await app.request('/sessions/sess-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: '' }),
      })
      expect(res.status).toBe(400)
      expect((await res.json()).error.message).toBe('slug must not be empty')
    })

    test('skips slug update when slug is not a string', async () => {
      const res = await app.request('/sessions/sess-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: 123 }),
      })
      expect(res.status).toBe(200)
      expect(store.updateSessionSlug).not.toHaveBeenCalled()
    })

    test('updates projectId and broadcasts', async () => {
      const res = await app.request('/sessions/sess-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: 42 }),
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })
      expect(store.updateSessionProject).toHaveBeenCalledWith('sess-1', 42)
      expect(broadcastToAll).toHaveBeenCalledWith({
        type: 'session_update',
        data: { id: 'sess-1', projectId: 42 },
      })
    })

    test('skips projectId update when projectId is not a number', async () => {
      const res = await app.request('/sessions/sess-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: 'abc' }),
      })
      expect(res.status).toBe(200)
      expect(store.updateSessionProject).not.toHaveBeenCalled()
    })

    test('updates both slug and projectId simultaneously', async () => {
      const res = await app.request('/sessions/sess-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: 'cool-session', projectId: 7 }),
      })
      expect(res.status).toBe(200)
      expect(store.updateSessionSlug).toHaveBeenCalledWith('sess-1', 'cool-session')
      expect(store.updateSessionProject).toHaveBeenCalledWith('sess-1', 7)
      expect(broadcastToAll).toHaveBeenCalledTimes(2)
    })

    test('no-ops when body has no recognized keys', async () => {
      const res = await app.request('/sessions/sess-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ foo: 'bar' }),
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })
      expect(store.updateSessionSlug).not.toHaveBeenCalled()
      expect(store.updateSessionProject).not.toHaveBeenCalled()
      expect(broadcastToAll).not.toHaveBeenCalled()
    })

    test('returns 400 for invalid JSON body', async () => {
      const res = await app.request('/sessions/sess-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: 'not-json',
      })
      expect(res.status).toBe(400)
      expect((await res.json()).error.message).toBe('Invalid request')
    })

    test('returns 400 for invalid URL encoding', async () => {
      const res = await app.request('/sessions/%E0%A4%A', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: 'test' }),
      })
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('Invalid URL encoding')
    })

    test('debug log when LOG_LEVEL is debug and slug updated', async () => {
      // Rebuild app with debug log level
      vi.resetModules()
      vi.doMock('../config', () => ({ config: { logLevel: 'debug' } }))
      vi.doMock('../errors', () => ({
        apiError: vi.fn((c: any, status: number, message: string) =>
          c.json({ error: { message } }, status),
        ),
      }))
      vi.doMock('../context', () => ({ computeSessionContext: vi.fn() }))

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const { default: sessionsRouter } = await import('./sessions')
      const app2 = new Hono<Env>()
      app2.use('*', async (c, next) => {
        c.set('store', store as unknown as EventStore)
        c.set('broadcastToSession', broadcastToSession)
        c.set('broadcastToAll', broadcastToAll)
        await next()
      })
      app2.route('/', sessionsRouter)

      const res = await app2.request('/sessions/sess-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: 'debug-slug' }),
      })
      expect(res.status).toBe(200)
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[METADATA]'),
      )

      consoleSpy.mockRestore()
    })
  })

  // -----------------------------------------------------------------------
  // PATCH /sessions/:id/metadata
  // -----------------------------------------------------------------------
  describe('PATCH /sessions/:id/metadata', () => {
    test('patches metadata successfully', async () => {
      const res = await app.request('/sessions/sess-1/metadata', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'updated-value', newKey: true }),
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })
      expect(store.patchSessionMetadata).toHaveBeenCalledWith('sess-1', {
        key: 'updated-value',
        newKey: true,
      })
    })

    test('returns 415 when Content-Type is not application/json', async () => {
      const res = await app.request('/sessions/sess-1/metadata', {
        method: 'PATCH',
        headers: { 'content-type': 'text/plain' },
        body: '{}',
      })
      expect(res.status).toBe(415)
      expect((await res.json()).error).toBe('Content-Type must be application/json')
    })

    test('returns 415 when Content-Type header is missing', async () => {
      const res = await app.request('/sessions/sess-1/metadata', {
        method: 'PATCH',
        body: '{}',
      })
      expect(res.status).toBe(415)
    })

    test('returns 400 for empty body object', async () => {
      const res = await app.request('/sessions/sess-1/metadata', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
      expect((await res.json()).error.message).toBe(
        'Provide at least one key to patch',
      )
      expect(store.patchSessionMetadata).not.toHaveBeenCalled()
    })

    test('returns 400 for null body', async () => {
      const res = await app.request('/sessions/sess-1/metadata', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: 'null',
      })
      expect(res.status).toBe(400)
      expect((await res.json()).error.message).toBe(
        'Provide at least one key to patch',
      )
    })

    test('returns 400 for non-object body (array)', async () => {
      const res = await app.request('/sessions/sess-1/metadata', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: '[]',
      })
      expect(res.status).toBe(400)
    })

    test('returns 400 for invalid JSON body', async () => {
      const res = await app.request('/sessions/sess-1/metadata', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: 'not-json',
      })
      expect(res.status).toBe(400)
      expect((await res.json()).error.message).toBe('Invalid request')
    })

    test('returns 400 for invalid URL encoding', async () => {
      const res = await app.request('/sessions/%E0%A4%A/metadata', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'val' }),
      })
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('Invalid URL encoding')
    })

    test('accepts various value types in patch', async () => {
      const res = await app.request('/sessions/sess-1/metadata', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          str: 'hello',
          num: 42,
          bool: false,
          nested: { a: 1 },
          arr: [1, 2, 3],
        }),
      })
      expect(res.status).toBe(200)
      expect(store.patchSessionMetadata).toHaveBeenCalledWith('sess-1', {
        str: 'hello',
        num: 42,
        bool: false,
        nested: { a: 1 },
        arr: [1, 2, 3],
      })
    })
  })
})
