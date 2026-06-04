import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import type { EventStore } from '../storage/types'

type Env = {
  Variables: {
    store: EventStore
    broadcastToSession: (sessionId: string, msg: object) => void
    broadcastToAll: (msg: object) => void
  }
}

function createStore(overrides = {}) {
  return {
    getProjects: vi.fn(),
    createProject: vi.fn(),
    isSlugAvailable: vi.fn(),
    getSessionsForProject: vi.fn(),
    updateProjectName: vi.fn(),
    ...overrides,
  }
}

function createApp(storeOverrides = {}) {
  const store = createStore(storeOverrides)
  const broadcastToAll = vi.fn()
  const broadcastToSession = vi.fn()
  const app = new Hono<Env>()
  app.use('*', async (c, next) => {
    c.set('store', store as unknown as EventStore)
    c.set('broadcastToAll', broadcastToAll)
    c.set('broadcastToSession', broadcastToSession)
    await next()
  })
  return { app, store, broadcastToAll, broadcastToSession }
}

describe('projects routes — GET /projects', () => {
  let app: Hono<Env>
  let store: ReturnType<typeof createStore>

  beforeEach(async () => {
    vi.resetModules()

    const built = createApp()
    app = built.app
    store = built.store

    const { default: projectsRouter } = await import('./projects')
    app.route('/api', projectsRouter)
  })

  it('returns empty array when there are no projects', async () => {
    store.getProjects.mockResolvedValue([])

    const res = await app.request('/api/projects')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([])
  })

  it('returns mapped project list with camelCase fields', async () => {
    store.getProjects.mockResolvedValue([
      {
        id: 1,
        slug: 'my-project',
        name: 'My Project',
        created_at: 1700000000000,
        session_count: 5,
      },
      {
        id: 2,
        slug: 'other',
        name: 'Other Project',
        created_at: 1700000001000,
        session_count: 0,
      },
    ])

    const res = await app.request('/api/projects')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([
      { id: 1, slug: 'my-project', name: 'My Project', createdAt: 1700000000000, sessionCount: 5 },
      { id: 2, slug: 'other', name: 'Other Project', createdAt: 1700000001000, sessionCount: 0 },
    ])
  })

  it('handles missing session_count gracefully', async () => {
    store.getProjects.mockResolvedValue([
      { id: 3, slug: 'minimal', name: 'Minimal', created_at: 1700000002000 },
    ])

    const res = await app.request('/api/projects')
    const body = await res.json()
    expect(body[0].sessionCount).toBeUndefined()
  })
})

describe('projects routes — POST /projects', () => {
  let app: Hono<Env>
  let store: ReturnType<typeof createStore>
  let broadcastToAll: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()

    const built = createApp()
    app = built.app
    store = built.store
    broadcastToAll = built.broadcastToAll

    const { default: projectsRouter } = await import('./projects')
    app.route('/api', projectsRouter)
  })

  it('creates a project successfully with just a name', async () => {
    store.isSlugAvailable.mockResolvedValue(true)
    store.createProject.mockResolvedValue(42)

    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'My New Project' }),
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBe(42)
    expect(body.name).toBe('My New Project')
    expect(body.slug).toBe('my-new-project')
    expect(body.sessionCount).toBe(0)
    expect(typeof body.createdAt).toBe('number')

    expect(store.isSlugAvailable).toHaveBeenCalledWith('my-new-project')
    expect(store.createProject).toHaveBeenCalledWith('my-new-project', 'My New Project', null)
    expect(broadcastToAll).toHaveBeenCalledWith({
      type: 'project_update',
      data: { id: 42, name: 'My New Project', slug: 'my-new-project' },
    })
  })

  it('uses provided slug when given', async () => {
    store.isSlugAvailable.mockResolvedValue(true)
    store.createProject.mockResolvedValue(7)

    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Test', slug: 'custom-slug' }),
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.slug).toBe('custom-slug')
    expect(store.isSlugAvailable).toHaveBeenCalledWith('custom-slug')
    expect(store.createProject).toHaveBeenCalledWith('custom-slug', 'Test', null)
  })

  it('trims whitespace from name and slug', async () => {
    store.isSlugAvailable.mockResolvedValue(true)
    store.createProject.mockResolvedValue(1)

    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '  Spaced Out  ', slug: '  custom  ' }),
    })

    expect(res.status).toBe(201)
    expect(store.isSlugAvailable).toHaveBeenCalledWith('custom')
    expect(store.createProject).toHaveBeenCalledWith('custom', 'Spaced Out', null)
  })

  it('returns 415 when Content-Type is not application/json', async () => {
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'not json',
    })

    expect(res.status).toBe(415)
    const body = await res.json()
    expect(body.error).toBe('Content-Type must be application/json')
  })

  it('returns 400 when body is not valid JSON', async () => {
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not valid json {[',
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.message).toBe('Invalid JSON body')
  })

  it('returns 400 when name is empty string', async () => {
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.message).toBe('name must not be empty')
  })

  it('returns 400 when name is only whitespace', async () => {
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.message).toBe('name must not be empty')
  })

  it('returns 400 when name is missing', async () => {
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.message).toBe('name must not be empty')
  })

  it('returns 400 when name is not a string', async () => {
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 42 }),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.message).toBe('name must not be empty')
  })

  it('returns 400 when derived slug is empty (name is all special chars)', async () => {
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '!!!' }),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.message).toBe('could not derive a valid slug from name')
  })

  it('returns 400 when slug contains invalid characters', async () => {
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Test', slug: 'bad slug!' }),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.message).toBe('slug must be kebab-case (a-z, 0-9, hyphens)')
  })

  it('returns 400 when slug starts with a hyphen', async () => {
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Test', slug: '-bad-start' }),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.message).toBe('slug must be kebab-case (a-z, 0-9, hyphens)')
  })

  it('returns 400 when slug contains uppercase letters', async () => {
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Test', slug: 'UPPERCASE' }),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.message).toBe('slug must be kebab-case (a-z, 0-9, hyphens)')
  })

  it('returns 400 when slug exceeds 100 characters', async () => {
    const longSlug = 'a'.repeat(101)

    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Test', slug: longSlug }),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.message).toBe('Slug must be 100 characters or fewer')
  })

  it('returns 409 when slug is already taken', async () => {
    store.isSlugAvailable.mockResolvedValue(false)

    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Duplicate', slug: 'taken' }),
    })

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error.message).toBe('slug "taken" is already in use')
    expect(body.error.code).toBe('SLUG_TAKEN')
    expect(store.createProject).not.toHaveBeenCalled()
  })

  it('accepts slug with hyphens between segments', async () => {
    store.isSlugAvailable.mockResolvedValue(true)
    store.createProject.mockResolvedValue(10)

    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Test', slug: 'valid-kebab-slug-123' }),
    })

    expect(res.status).toBe(201)
  })

  it('slugifies name with special characters into valid kebab-case', async () => {
    store.isSlugAvailable.mockResolvedValue(true)
    store.createProject.mockResolvedValue(1)

    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Hello World! & Stuff' }),
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.slug).toBe('hello-world-stuff')
  })
})

describe('projects routes — GET /projects/:id/sessions', () => {
  let app: Hono<Env>
  let store: ReturnType<typeof createStore>

  beforeEach(async () => {
    vi.resetModules()

    const built = createApp()
    app = built.app
    store = built.store

    const { default: projectsRouter } = await import('./projects')
    app.route('/api', projectsRouter)
  })

  it('returns 400 for non-numeric project ID', async () => {
    const res = await app.request('/api/projects/abc/sessions')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.message).toBe('Invalid project ID')
  })

  it('returns sessions for a valid project ID with camelCase mapping', async () => {
    store.getSessionsForProject.mockResolvedValue([
      {
        id: 'sess-1',
        project_id: 1,
        slug: 'my-session',
        status: 'active',
        started_at: 1700000000000,
        stopped_at: null,
        transcript_path: '/tmp/transcript.json',
        metadata: JSON.stringify({ model: 'claude-sonnet' }),
        agent_count: 3,
        event_count: 150,
        last_activity: 1700000005000,
        total_input_tokens: 10000,
        total_output_tokens: 5000,
        total_cache_read_tokens: 2000,
        total_cache_creation_tokens: 1000,
        total_duration_ms: 30000,
        llm_call_count: 25,
      },
    ])

    const res = await app.request('/api/projects/1/sessions')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([
      {
        id: 'sess-1',
        projectId: 1,
        slug: 'my-session',
        status: 'active',
        startedAt: 1700000000000,
        stoppedAt: null,
        transcriptPath: '/tmp/transcript.json',
        metadata: { model: 'claude-sonnet' },
        agentCount: 3,
        eventCount: 150,
        lastActivity: 1700000005000,
        totalInputTokens: 10000,
        totalOutputTokens: 5000,
        totalCacheReadTokens: 2000,
        totalCacheCreationTokens: 1000,
        totalDurationMs: 30000,
        llmCallCount: 25,
      },
    ])
    expect(store.getSessionsForProject).toHaveBeenCalledWith(1)
  })

  it('returns empty array when project has no sessions', async () => {
    store.getSessionsForProject.mockResolvedValue([])

    const res = await app.request('/api/projects/99/sessions')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([])
  })

  it('handles null transcript_path, metadata, and zero token counts', async () => {
    store.getSessionsForProject.mockResolvedValue([
      {
        id: 'sess-min',
        project_id: 1,
        slug: null,
        status: 'stopped',
        started_at: 1700000000000,
        stopped_at: 1700000001000,
        transcript_path: null,
        metadata: null,
        agent_count: 0,
        event_count: 0,
        last_activity: null,
        total_input_tokens: undefined,
        total_output_tokens: undefined,
        total_cache_read_tokens: undefined,
        total_cache_creation_tokens: undefined,
        total_duration_ms: undefined,
        llm_call_count: undefined,
      },
    ])

    const res = await app.request('/api/projects/1/sessions')
    const body = await res.json()
    expect(body[0].transcriptPath).toBeNull()
    expect(body[0].metadata).toBeNull()
    expect(body[0].totalInputTokens).toBe(0)
    expect(body[0].totalOutputTokens).toBe(0)
    expect(body[0].totalCacheReadTokens).toBe(0)
    expect(body[0].totalCacheCreationTokens).toBe(0)
    expect(body[0].totalDurationMs).toBe(0)
    expect(body[0].llmCallCount).toBe(0)
  })
})

describe('projects routes — PATCH /projects/:id', () => {
  let app: Hono<Env>
  let store: ReturnType<typeof createStore>
  let broadcastToAll: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()

    const built = createApp()
    app = built.app
    store = built.store
    broadcastToAll = built.broadcastToAll

    const { default: projectsRouter } = await import('./projects')
    app.route('/api', projectsRouter)
  })

  it('returns 415 when Content-Type is not application/json', async () => {
    const res = await app.request('/api/projects/1', {
      method: 'PATCH',
      headers: { 'content-type': 'text/plain' },
      body: 'not json',
    })

    expect(res.status).toBe(415)
    const body = await res.json()
    expect(body.error).toBe('Content-Type must be application/json')
  })

  it('returns 400 for non-numeric project ID', async () => {
    const res = await app.request('/api/projects/abc', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Test' }),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.message).toBe('Invalid project ID')
  })

  it('updates project name successfully', async () => {
    store.updateProjectName.mockResolvedValue(undefined)

    const res = await app.request('/api/projects/1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Name' }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true })

    expect(store.updateProjectName).toHaveBeenCalledWith(1, 'Updated Name')
    expect(broadcastToAll).toHaveBeenCalledWith({
      type: 'project_update',
      data: { id: 1, name: 'Updated Name' },
    })
  })

  it('trims whitespace from name before updating', async () => {
    store.updateProjectName.mockResolvedValue(undefined)

    const res = await app.request('/api/projects/1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '  Spaced  ' }),
    })

    expect(res.status).toBe(200)
    expect(store.updateProjectName).toHaveBeenCalledWith(1, 'Spaced')
  })

  it('returns ok: true when name is empty string (falsy check skips update)', async () => {
    const res = await app.request('/api/projects/1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })

    // Empty string is falsy, so the `if (data.name && ...)` check skips the
    // name-update block entirely. The route returns 200 with { ok: true }.
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true })
    expect(store.updateProjectName).not.toHaveBeenCalled()
  })

  it('returns 400 when name is only whitespace', async () => {
    const res = await app.request('/api/projects/1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.message).toBe('name must not be empty')
  })

  it('returns ok: true even when no name is provided (no-op update)', async () => {
    const res = await app.request('/api/projects/1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ otherField: 'ignored' }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true })
    expect(store.updateProjectName).not.toHaveBeenCalled()
    expect(broadcastToAll).not.toHaveBeenCalled()
  })

  it('does not call updateProjectName when name is not a string', async () => {
    const res = await app.request('/api/projects/1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 42 }),
    })

    expect(res.status).toBe(200)
    expect(store.updateProjectName).not.toHaveBeenCalled()
  })

  it('returns 400 when body is not valid JSON', async () => {
    const res = await app.request('/api/projects/1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: 'not valid {{{',
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.message).toBe('Invalid request')
  })
})
