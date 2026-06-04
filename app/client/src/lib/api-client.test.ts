import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ApiError, api } from './api-client'

const API_BASE = '/api'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// ApiError
// ---------------------------------------------------------------------------

describe('ApiError', () => {
  it('should be an instance of Error', () => {
    const err = new ApiError(404, '/projects', 'Not found')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(ApiError)
  })

  it('should set name to "ApiError"', () => {
    const err = new ApiError(500, '/test', 'Server error')
    expect(err.name).toBe('ApiError')
  })

  it('should store status, path, and message', () => {
    const err = new ApiError(422, '/sessions/abc', 'Unprocessable', 'Missing field xyz')
    expect(err.status).toBe(422)
    expect(err.path).toBe('/sessions/abc')
    expect(err.message).toBe('Unprocessable')
    expect(err.serverMessage).toBe('Missing field xyz')
  })

  it('should allow undefined serverMessage', () => {
    const err = new ApiError(0, '/health', 'Network error: connection refused')
    expect(err.serverMessage).toBeUndefined()
  })

  it('should support status 0 for network-level failures', () => {
    const err = new ApiError(0, '/projects', 'Network error: Failed to fetch')
    expect(err.status).toBe(0)
  })

  it('should stringify to its message', () => {
    const err = new ApiError(500, '/x', 'boom')
    expect(err.toString()).toContain('boom')
  })
})

// ---------------------------------------------------------------------------
// api.getProjects
// ---------------------------------------------------------------------------

describe('api.getProjects', () => {
  it('should fetch /projects and return JSON on success', async () => {
    const projects = [{ id: 1, name: 'Test', slug: 'test' }]
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(projects),
    } as Response)

    const result = await api.getProjects()
    expect(result).toEqual(projects)
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/projects`, undefined)
  })

  it('should throw ApiError on non-ok response without JSON body', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.reject(new Error('Not JSON')),
    } as Response)

    await expect(api.getProjects()).rejects.toThrow(ApiError)
    await expect(api.getProjects()).rejects.toMatchObject({
      status: 500,
      path: '/projects',
    })
  })

  it('should throw ApiError on network failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Connection refused'))

    await expect(api.getProjects()).rejects.toThrow(ApiError)
    await expect(api.getProjects()).rejects.toMatchObject({
      status: 0,
      path: '/projects',
    })
  })

  it('should throw ApiError with server message from structured error body', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
      json: () =>
        Promise.resolve({ error: { message: 'Invalid input', details: 'name is required' } }),
    } as Response)

    await expect(api.getProjects()).rejects.toMatchObject({
      status: 422,
      path: '/projects',
      serverMessage: 'Invalid input: name is required',
    })
  })

  it('should throw ApiError with server message from legacy error format', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: () => Promise.resolve({ error: 'Something went wrong' }),
    } as Response)

    await expect(api.getProjects()).rejects.toMatchObject({
      status: 400,
      serverMessage: 'Something went wrong',
    })
  })
})

// ---------------------------------------------------------------------------
// api.getPendingNotifications
// ---------------------------------------------------------------------------

describe('api.getPendingNotifications', () => {
  it('should fetch notifications with since timestamp', async () => {
    const notifications = [{ id: 1, message: 'test' }]
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(notifications),
    } as Response)

    const result = await api.getPendingNotifications(1700000000000)
    expect(result).toEqual(notifications)
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/notifications?since=1700000000000`, undefined)
  })

  it('should handle since=0', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    } as Response)

    await api.getPendingNotifications(0)
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/notifications?since=0`, undefined)
  })

  it('should throw ApiError on failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Down'))
    await expect(api.getPendingNotifications(1000)).rejects.toThrow(ApiError)
  })
})

// ---------------------------------------------------------------------------
// api.getRecentSessions
// ---------------------------------------------------------------------------

describe('api.getRecentSessions', () => {
  it('should fetch recent sessions without limit param when no limit given', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    } as Response)

    await api.getRecentSessions()
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/sessions/recent`, undefined)
  })

  it('should include limit query param when provided', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    } as Response)

    await api.getRecentSessions(10)
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/sessions/recent?limit=10`, undefined)
  })

  it('should return session data on success', async () => {
    const sessions = [{ id: 's1', projectId: 1 }]
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(sessions),
    } as Response)

    const result = await api.getRecentSessions(5)
    expect(result).toEqual(sessions)
  })

  it('should throw ApiError on failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('fail'))
    await expect(api.getRecentSessions()).rejects.toThrow(ApiError)
  })
})

// ---------------------------------------------------------------------------
// api.getUnassignedSessions
// ---------------------------------------------------------------------------

describe('api.getUnassignedSessions', () => {
  it('should fetch unassigned sessions without limit param when no limit given', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    } as Response)

    await api.getUnassignedSessions()
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/sessions/unassigned`, undefined)
  })

  it('should include limit query param when provided', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    } as Response)

    await api.getUnassignedSessions(20)
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/sessions/unassigned?limit=20`, undefined)
  })

  it('should throw ApiError on failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('fail'))
    await expect(api.getUnassignedSessions()).rejects.toThrow(ApiError)
  })
})

// ---------------------------------------------------------------------------
// api.getSessions
// ---------------------------------------------------------------------------

describe('api.getSessions', () => {
  it('should fetch sessions for a project', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    } as Response)

    await api.getSessions(42)
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/projects/42/sessions`, undefined)
  })

  it('should throw ApiError on failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('fail'))
    await expect(api.getSessions(1)).rejects.toThrow(ApiError)
  })
})

// ---------------------------------------------------------------------------
// api.getSession
// ---------------------------------------------------------------------------

describe('api.getSession', () => {
  it('should fetch a single session by id', async () => {
    const session = { id: 'abc-123', projectId: 1 }
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(session),
    } as Response)

    const result = await api.getSession('abc-123')
    expect(result).toEqual(session)
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/sessions/abc-123`, undefined)
  })

  it('should URI-encode the session id', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response)

    await api.getSession('session with spaces/and slashes')
    expect(fetch).toHaveBeenCalledWith(
      `${API_BASE}/sessions/session%20with%20spaces%2Fand%20slashes`,
      undefined,
    )
  })

  it('should throw ApiError on failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('fail'))
    await expect(api.getSession('x')).rejects.toThrow(ApiError)
  })
})

// ---------------------------------------------------------------------------
// api.getAgent
// ---------------------------------------------------------------------------

describe('api.getAgent', () => {
  it('should fetch an agent by id', async () => {
    const agent = { id: 'agent-1', sessionId: 's1' }
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(agent),
    } as Response)

    const result = await api.getAgent('agent-1')
    expect(result).toEqual(agent)
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/agents/agent-1`, undefined)
  })

  it('should URI-encode the agent id', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response)

    await api.getAgent('agent?special')
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/agents/agent%3Fspecial`, undefined)
  })

  it('should throw ApiError on failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('fail'))
    await expect(api.getAgent('x')).rejects.toThrow(ApiError)
  })
})

// ---------------------------------------------------------------------------
// api.getAgents
// ---------------------------------------------------------------------------

describe('api.getAgents', () => {
  it('should fetch agents for a session', async () => {
    const agents = [{ id: 'a1' }, { id: 'a2' }]
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(agents),
    } as Response)

    const result = await api.getAgents('sess-1')
    expect(result).toEqual(agents)
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/sessions/sess-1/agents`, undefined)
  })

  it('should throw ApiError on failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('fail'))
    await expect(api.getAgents('x')).rejects.toThrow(ApiError)
  })
})

// ---------------------------------------------------------------------------
// api.getEvents
// ---------------------------------------------------------------------------

describe('api.getEvents', () => {
  it('should fetch events for a session with default fields param', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    } as Response)

    await api.getEvents('sess-1')
    expect(fetch).toHaveBeenCalledWith(
      `${API_BASE}/sessions/sess-1/events?fields=sessionId%2CcreatedAt`,
      undefined,
    )
  })

  it('should include agentId filter when provided', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    } as Response)

    await api.getEvents('sess-1', { agentIds: ['a1', 'a2'] })
    const url = vi.mocked(fetch).mock.calls[0][0] as string
    expect(url).toContain('agentId=a1%2Ca2')
  })

  it('should include type filter', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    } as Response)

    await api.getEvents('sess-1', { type: 'hook' })
    const url = vi.mocked(fetch).mock.calls[0][0] as string
    expect(url).toContain('type=hook')
  })

  it('should include subtype filter', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    } as Response)

    await api.getEvents('sess-1', { subtype: 'UserPromptSubmit' })
    const url = vi.mocked(fetch).mock.calls[0][0] as string
    expect(url).toContain('subtype=UserPromptSubmit')
  })

  it('should include search filter', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    } as Response)

    await api.getEvents('sess-1', { search: 'error' })
    const url = vi.mocked(fetch).mock.calls[0][0] as string
    expect(url).toContain('search=error')
  })

  it('should include limit and offset', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    } as Response)

    await api.getEvents('sess-1', { limit: 50, offset: 100 })
    const url = vi.mocked(fetch).mock.calls[0][0] as string
    expect(url).toContain('limit=50')
    expect(url).toContain('offset=100')
  })

  it('should combine all filters', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    } as Response)

    await api.getEvents('sess-1', {
      agentIds: ['a1'],
      type: 'tool',
      subtype: 'PreToolUse',
      search: 'Bash',
      limit: 20,
      offset: 10,
    })

    const url = vi.mocked(fetch).mock.calls[0][0] as string
    expect(url).toContain('agentId=a1')
    expect(url).toContain('type=tool')
    expect(url).toContain('subtype=PreToolUse')
    expect(url).toContain('search=Bash')
    expect(url).toContain('limit=20')
    expect(url).toContain('offset=10')
    expect(url).toContain('fields=sessionId%2CcreatedAt')
  })

  it('should skip filter params when filters object is empty', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    } as Response)

    await api.getEvents('sess-1', {})
    const url = vi.mocked(fetch).mock.calls[0][0] as string
    // Only fields param should be present
    expect(url).toBe(`${API_BASE}/sessions/sess-1/events?fields=sessionId%2CcreatedAt`)
  })

  it('should skip filter params when filters is undefined', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    } as Response)

    await api.getEvents('sess-1')
    const url = vi.mocked(fetch).mock.calls[0][0] as string
    expect(url).toBe(`${API_BASE}/sessions/sess-1/events?fields=sessionId%2CcreatedAt`)
  })

  it('should throw ApiError on failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('fail'))
    await expect(api.getEvents('sess-1')).rejects.toThrow(ApiError)
  })
})

// ---------------------------------------------------------------------------
// api.getThread
// ---------------------------------------------------------------------------

describe('api.getThread', () => {
  it('should fetch thread events for an event id', async () => {
    const events = [{ id: 1 }, { id: 2 }]
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(events),
    } as Response)

    const result = await api.getThread(42)
    expect(result).toEqual(events)
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/events/42/thread`, undefined)
  })

  it('should throw ApiError on failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('fail'))
    await expect(api.getThread(1)).rejects.toThrow(ApiError)
  })
})

// ---------------------------------------------------------------------------
// api.getSessionUsage
// ---------------------------------------------------------------------------

describe('api.getSessionUsage', () => {
  it('should fetch usage data for a session', async () => {
    const usage = {
      sessionId: 's1',
      totalInputTokens: 1000,
      totalOutputTokens: 500,
      totalCacheReadTokens: 200,
      totalCacheCreationTokens: 100,
      totalDurationMs: 30000,
      llmCallCount: 5,
      agentUsage: [],
    }
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(usage),
    } as Response)

    const result = await api.getSessionUsage('sess-1')
    expect(result).toEqual(usage)
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/sessions/sess-1/usage`, undefined)
  })

  it('should throw ApiError on failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('fail'))
    await expect(api.getSessionUsage('x')).rejects.toThrow(ApiError)
  })
})

// ---------------------------------------------------------------------------
// api.getSessionContext
// ---------------------------------------------------------------------------

describe('api.getSessionContext', () => {
  it('should fetch context breakdown for a session', async () => {
    const context = { sessionId: 's1', entries: [] }
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(context),
    } as Response)

    const result = await api.getSessionContext('sess-1')
    expect(result).toEqual(context)
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/sessions/sess-1/context`, undefined)
  })

  it('should throw ApiError on failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('fail'))
    await expect(api.getSessionContext('x')).rejects.toThrow(ApiError)
  })
})

// ---------------------------------------------------------------------------
// api.deleteSession (fetchVoid)
// ---------------------------------------------------------------------------

describe('api.deleteSession', () => {
  it('should send DELETE request to session endpoint', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
    } as Response)

    await api.deleteSession('sess-1')
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/sessions/sess-1`, {
      method: 'DELETE',
    })
  })

  it('should resolve to undefined on success', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: undefined } as unknown as Response)

    const result = await api.deleteSession('sess-1')
    expect(result).toBeUndefined()
  })

  it('should throw ApiError on non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: () => Promise.reject(new Error('not json')),
    } as Response)

    await expect(api.deleteSession('sess-1')).rejects.toThrow(ApiError)
    await expect(api.deleteSession('sess-1')).rejects.toMatchObject({
      status: 404,
    })
  })

  it('should throw ApiError on network failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Offline'))
    await expect(api.deleteSession('sess-1')).rejects.toThrow(ApiError)
  })
})

// ---------------------------------------------------------------------------
// api.clearSessionEvents (fetchVoid)
// ---------------------------------------------------------------------------

describe('api.clearSessionEvents', () => {
  it('should send DELETE request to session events endpoint', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response)

    await api.clearSessionEvents('sess-1')
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/sessions/sess-1/events`, {
      method: 'DELETE',
    })
  })

  it('should throw ApiError on failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('fail'))
    await expect(api.clearSessionEvents('sess-1')).rejects.toThrow(ApiError)
  })
})

// ---------------------------------------------------------------------------
// api.deleteProject (fetchVoid)
// ---------------------------------------------------------------------------

describe('api.deleteProject', () => {
  it('should send DELETE request to project endpoint', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response)

    await api.deleteProject(42)
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/projects/42`, {
      method: 'DELETE',
    })
  })

  it('should throw ApiError on failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('fail'))
    await expect(api.deleteProject(1)).rejects.toThrow(ApiError)
  })
})

// ---------------------------------------------------------------------------
// api.deleteAllData (fetchVoid)
// ---------------------------------------------------------------------------

describe('api.deleteAllData', () => {
  it('should send DELETE request to data endpoint', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response)

    await api.deleteAllData()
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/data`, {
      method: 'DELETE',
    })
  })

  it('should throw ApiError on failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('fail'))
    await expect(api.deleteAllData()).rejects.toThrow(ApiError)
  })
})

// ---------------------------------------------------------------------------
// api.updateAgentMetadata (PATCH with JSON body)
// ---------------------------------------------------------------------------

describe('api.updateAgentMetadata', () => {
  it('should send PATCH with JSON body to agent endpoint', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response)

    await api.updateAgentMetadata('agent-1', { agentType: 'bash', name: 'Shell Agent' })
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/agents/agent-1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentType: 'bash', name: 'Shell Agent' }),
    })
  })

  it('should handle partial update (agentType only)', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response)

    await api.updateAgentMetadata('agent-1', { agentType: 'code' })
    const call = vi.mocked(fetch).mock.calls[0][1] as RequestInit
    expect(JSON.parse(call.body as string)).toEqual({ agentType: 'code' })
  })

  it('should handle partial update (name only)', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response)

    await api.updateAgentMetadata('agent-1', { name: 'Renamed' })
    const call = vi.mocked(fetch).mock.calls[0][1] as RequestInit
    expect(JSON.parse(call.body as string)).toEqual({ name: 'Renamed' })
  })

  it('should throw ApiError on failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('fail'))
    await expect(api.updateAgentMetadata('a', {})).rejects.toThrow(ApiError)
  })
})

// ---------------------------------------------------------------------------
// api.updateSessionSlug (PATCH)
// ---------------------------------------------------------------------------

describe('api.updateSessionSlug', () => {
  it('should send PATCH with slug in JSON body', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response)

    await api.updateSessionSlug('sess-1', 'my-session')
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/sessions/sess-1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'my-session' }),
    })
  })

  it('should throw ApiError on failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('fail'))
    await expect(api.updateSessionSlug('s', 'slug')).rejects.toThrow(ApiError)
  })
})

// ---------------------------------------------------------------------------
// api.patchSessionMetadata (PATCH)
// ---------------------------------------------------------------------------

describe('api.patchSessionMetadata', () => {
  it('should PATCH session metadata with arbitrary JSON', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response)

    await api.patchSessionMetadata('sess-1', { key: 'value', num: 42 })
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/sessions/sess-1/metadata`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'value', num: 42 }),
    })
  })

  it('should handle empty patch object', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response)

    await api.patchSessionMetadata('sess-1', {})
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/sessions/sess-1/metadata`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
  })

  it('should throw ApiError on failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('fail'))
    await expect(api.patchSessionMetadata('s', {})).rejects.toThrow(ApiError)
  })
})

// ---------------------------------------------------------------------------
// api.moveSession (PATCH)
// ---------------------------------------------------------------------------

describe('api.moveSession', () => {
  it('should PATCH session with projectId in body', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response)

    await api.moveSession('sess-1', 99)
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/sessions/sess-1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 99 }),
    })
  })

  it('should throw ApiError on failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('fail'))
    await expect(api.moveSession('s', 1)).rejects.toThrow(ApiError)
  })
})

// ---------------------------------------------------------------------------
// api.renameProject (PATCH)
// ---------------------------------------------------------------------------

describe('api.renameProject', () => {
  it('should PATCH project with name in body', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response)

    await api.renameProject(7, 'New Name')
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/projects/7`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Name' }),
    })
  })

  it('should throw ApiError on failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('fail'))
    await expect(api.renameProject(1, 'x')).rejects.toThrow(ApiError)
  })
})

// ---------------------------------------------------------------------------
// api.createProject (POST with JSON body, returns Project)
// ---------------------------------------------------------------------------

describe('api.createProject', () => {
  it('should POST to /projects with JSON body and return created Project', async () => {
    const project = { id: 123, name: 'New Project', slug: 'new-project' }
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(project),
    } as Response)

    const result = await api.createProject({ name: 'New Project', slug: 'new-project' })
    expect(result).toEqual(project)
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Project', slug: 'new-project' }),
    })
  })

  it('should handle creating project without slug', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 1, name: 'P', slug: 'p' }),
    } as Response)

    await api.createProject({ name: 'Just Name' })
    const call = vi.mocked(fetch).mock.calls[0][1] as RequestInit
    expect(JSON.parse(call.body as string)).toEqual({ name: 'Just Name' })
  })

  it('should throw ApiError on failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('fail'))
    await expect(api.createProject({ name: 'x' })).rejects.toThrow(ApiError)
  })
})

// ---------------------------------------------------------------------------
// api.getChangelog
// ---------------------------------------------------------------------------

describe('api.getChangelog', () => {
  it('should fetch changelog markdown', async () => {
    const changelog = { markdown: '# Changelog\n\n- Item 1' }
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(changelog),
    } as Response)

    const result = await api.getChangelog()
    expect(result).toEqual(changelog)
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/changelog`, undefined)
  })

  it('should throw ApiError on failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('fail'))
    await expect(api.getChangelog()).rejects.toThrow(ApiError)
  })
})

// ---------------------------------------------------------------------------
// api.getDbStats
// ---------------------------------------------------------------------------

describe('api.getDbStats', () => {
  it('should fetch database statistics', async () => {
    const stats = {
      dbPath: '/data/observe.db',
      sizeBytes: 1048576,
      sessionCount: 42,
      eventCount: 10000,
    }
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(stats),
    } as Response)

    const result = await api.getDbStats()
    expect(result).toEqual(stats)
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/db/stats`, undefined)
  })

  it('should throw ApiError on failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('fail'))
    await expect(api.getDbStats()).rejects.toThrow(ApiError)
  })
})

// ---------------------------------------------------------------------------
// api.bulkDeleteSessions (POST with JSON body, returns result)
// ---------------------------------------------------------------------------

describe('api.bulkDeleteSessions', () => {
  it('should POST sessionIds and return deletion result', async () => {
    const result = {
      ok: true,
      deleted: { events: 100, agents: 5, sessions: 3 },
      sizeBefore: 5000000,
      sizeAfter: 3000000,
    }
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(result),
    } as Response)

    const res = await api.bulkDeleteSessions(['s1', 's2', 's3'])
    expect(res).toEqual(result)
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/sessions/bulk-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionIds: ['s1', 's2', 's3'] }),
    })
  })

  it('should handle empty sessionIds array', async () => {
    const result = {
      ok: true,
      deleted: { events: 0, agents: 0, sessions: 0 },
      sizeBefore: 5000000,
      sizeAfter: 5000000,
    }
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(result),
    } as Response)

    await api.bulkDeleteSessions([])
    const call = vi.mocked(fetch).mock.calls[0][1] as RequestInit
    expect(JSON.parse(call.body as string)).toEqual({ sessionIds: [] })
  })

  it('should throw ApiError on failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('fail'))
    await expect(api.bulkDeleteSessions(['s1'])).rejects.toThrow(ApiError)
  })
})

// ---------------------------------------------------------------------------
// Error body parsing (tested indirectly via api methods hitting non-ok)
// ---------------------------------------------------------------------------

describe('error body parsing', () => {
  it('should include serverMessage with details concatenation', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
      json: () =>
        Promise.resolve({
          error: { message: 'Validation failed', details: 'name must be a string' },
        }),
    } as Response)

    await expect(api.getProjects()).rejects.toMatchObject({
      status: 422,
      serverMessage: 'Validation failed: name must be a string',
    })
  })

  it('should handle non-JSON error response bodies gracefully', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.reject(new Error('Unexpected token <')),
    } as Response)

    await expect(api.getProjects()).rejects.toMatchObject({
      status: 500,
      // serverMessage should be undefined since JSON parse failed
    })
  })

  it('should handle JSON response that is not an object (array)', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: () => Promise.resolve(['not an object']),
    } as Response)

    await expect(api.getProjects()).rejects.toMatchObject({
      status: 400,
    })
  })

  it('should handle JSON response that is null', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Error',
      json: () => Promise.resolve(null),
    } as Response)

    await expect(api.getProjects()).rejects.toMatchObject({
      status: 500,
    })
  })

  it('should handle network errors that are not Error instances', async () => {
    vi.mocked(fetch).mockRejectedValue('Offline string')

    await expect(api.getProjects()).rejects.toMatchObject({
      status: 0,
      path: '/projects',
    })
  })
})
