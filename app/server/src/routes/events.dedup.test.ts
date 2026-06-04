import { describe, test, expect, beforeEach } from 'vitest'
import { SqliteAdapter } from '../storage/sqlite-adapter'
import { createApp } from '../app'

const noop = () => {}

function makeApp() {
  const store = new SqliteAdapter(':memory:')
  const app = createApp(store, noop, noop, noop)
  return { store, app }
}

// events.ts keeps module-level caches keyed by session_id (root-agent cache,
// pending-agent queues). Each test uses a unique session_id so a fresh
// :memory: store never collides with state left by an earlier test.
let seq = 0
function nextSession() {
  return `sess-dedup-${++seq}`
}

function hookPayload(sessionId: string, overrides: Record<string, unknown> = {}) {
  return {
    hook_event_name: 'PreToolUse',
    session_id: sessionId,
    tool_name: 'Bash',
    tool_use_id: 'tu-1',
    tool_input: { command: 'ls -la' },
    timestamp: 1_711_411_202_000,
    ...overrides,
  }
}

async function post(app: ReturnType<typeof createApp>, payload: Record<string, unknown>) {
  return app.request('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hook_payload: payload }),
  })
}

describe('POST /events — dedup', () => {
  let store: SqliteAdapter
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    ;({ store, app } = makeApp())
  })

  test('a re-delivered identical event is deduplicated and stored once', async () => {
    const sid = nextSession()
    const first = await post(app, hookPayload(sid))
    expect(first.status).toBe(201)
    const firstBody = await first.json()
    expect(firstBody.deduplicated).toBeUndefined()

    const second = await post(app, hookPayload(sid))
    expect(second.status).toBe(201)
    const secondBody = await second.json()
    expect(secondBody.deduplicated).toBe(true)
    expect(secondBody.meta.event_id).toBe(firstBody.meta.event_id)

    expect(await store.getEventsForSession(sid)).toHaveLength(1)
  })

  test('the same event >5s apart is treated as a distinct event', async () => {
    const sid = nextSession()
    const t = 1_711_411_202_000
    await post(app, hookPayload(sid, { timestamp: t }))
    const later = await post(app, hookPayload(sid, { timestamp: t + 6_000 }))
    expect((await later.json()).deduplicated).toBeUndefined()
    expect(await store.getEventsForSession(sid)).toHaveLength(2)
  })

  test('a different payload in the same bucket is not deduplicated', async () => {
    const sid = nextSession()
    await post(app, hookPayload(sid, { tool_input: { command: 'ls' } }))
    const other = await post(app, hookPayload(sid, { tool_input: { command: 'pwd' } }))
    expect((await other.json()).deduplicated).toBeUndefined()
    expect(await store.getEventsForSession(sid)).toHaveLength(2)
  })
})
