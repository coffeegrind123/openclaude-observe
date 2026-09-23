import { describe, test, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SqliteAdapter } from '../storage/sqlite-adapter'
import { createApp } from '../app'
import { clearSessionRootAgents } from './events'

// The cross-repo contract, end to end: these are the envelopes instantcoffee's
// pi extension (.pi/extensions/observe) produced when replaying a real captured
// pi 0.85.1 session — a prompt, four parallel tool calls (one failing), and a
// general-purpose subagent. They go through the real parser, route and SQLite
// store. docs/pi-protocol.md is the written contract.
const ENVELOPES: Record<string, unknown>[] = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'pi-envelopes.jsonl'),
  'utf8',
)
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l))

const ROOT_ID = ENVELOPES[0].session_id as string
const CHILD_ID = ENVELOPES.find((e) => e.agent_id)!.agent_id as string

const noop = () => {}

async function post(app: ReturnType<typeof createApp>, payload: Record<string, unknown>) {
  return app.request('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hook_payload: payload }),
  })
}

describe('POST /events — pi sessions', () => {
  let store: SqliteAdapter
  let app: ReturnType<typeof createApp>
  let broadcasts: Array<{ type: string; data: any }>

  beforeEach(() => {
    // The route caches root agents per session id; every test here reuses the
    // fixture's ids against a fresh store, as a DB reset does in production.
    clearSessionRootAgents()
    store = new SqliteAdapter(':memory:')
    broadcasts = []
    app = createApp(store, noop, (msg) => broadcasts.push(msg as any), noop)
  })

  async function ingestAll() {
    const bodies = []
    for (const env of ENVELOPES) {
      const res = await post(app, env)
      expect(res.status, String(env.hook_event_name)).toBe(201)
      bodies.push(await res.json())
    }
    return bodies
  }

  test('a whole real session is accepted and grouped under one session', async () => {
    const bodies = await ingestAll()

    expect(bodies.every((b) => b.meta.session_id === ROOT_ID)).toBe(true)
    // The Claude-plugin callback protocol is gone: pi's extension never reads
    // the response, so the server must not ask it for anything.
    expect(bodies.some((b) => 'requests' in b)).toBe(false)

    const session = await store.getSessionById(ROOT_ID)
    expect(session.status).toBe('stopped')
    const events = await store.getEventsForSession(ROOT_ID)
    expect(events).toHaveLength(ENVELOPES.length)
  })

  test('agents come from the explicit fields, tagged agent_class pi', async () => {
    await ingestAll()
    const agents = await store.getAgentsForSession(ROOT_ID)

    const root = agents.find((a) => a.id === ROOT_ID)
    expect(root.agent_class).toBe('pi')
    expect(root.parent_agent_id).toBeNull()

    const child = agents.find((a) => a.id === CHILD_ID)
    expect(child).toMatchObject({
      parent_agent_id: ROOT_ID,
      agent_type: 'general-purpose',
      description: 'Count lines in notes.txt',
      agent_class: 'pi',
    })
    expect(child.name).toMatch(/^general-purpose#/)
    expect(agents).toHaveLength(2)

    const childEvents = await store.getEventsForAgent(CHILD_ID)
    expect(childEvents.map((e) => e.subtype)).toContain('SubagentStart')
    expect(childEvents.map((e) => e.subtype)).toContain('SubagentStop')
    expect(childEvents.every((e) => e.agent_id === CHILD_ID)).toBe(true)
  })

  test('the agents API exposes agentClass so the client can pick a renderer', async () => {
    await ingestAll()
    const res = await app.request(`/api/sessions/${ROOT_ID}/agents`)
    const agents = (await res.json()) as Array<{
      id: string
      agentClass: string
      agentType: string | null
    }>
    expect(agents.map((a) => a.agentClass)).toEqual(['pi', 'pi'])
    expect(agents.find((a) => a.id === CHILD_ID)?.agentType).toBe('general-purpose')
  })

  test('a grandchild spawned through SubAgent hangs under the child that spawned it', async () => {
    await ingestAll()
    const child = ENVELOPES.find((e) => e.hook_event_name === 'SubagentStart')!
    const res = await post(app, {
      ...child,
      agent_id: 'grandchild-1',
      agent_type: 'explorer',
      agent_name: 'explorer#abcdef12',
      agent_description: 'dig',
      parent_tool_use_id: 'call_nested',
      parent_agent_id: CHILD_ID,
      timestamp: (child.timestamp as number) + 1,
    })
    expect(res.status).toBe(201)

    const grand = (await store.getAgentsForSession(ROOT_ID)).find((a) => a.id === 'grandchild-1')
    expect(grand).toMatchObject({
      parent_agent_id: CHILD_ID,
      agent_type: 'explorer',
      name: 'explorer#abcdef12',
    })
  })

  test('a child whose parent_agent_id is unknown still lands under the root', async () => {
    await ingestAll()
    const child = ENVELOPES.find((e) => e.hook_event_name === 'SubagentStart')!
    await post(app, { ...child, agent_id: 'orphan-1', parent_agent_id: 'never-seen', timestamp: 1 })

    const orphan = (await store.getAgentsForSession(ROOT_ID)).find((a) => a.id === 'orphan-1')
    expect(orphan.parent_agent_id).toBe(ROOT_ID)
  })

  test('SessionRename sets the session slug and broadcasts it', async () => {
    await ingestAll()
    const start = ENVELOPES[0]
    await post(app, {
      ...start,
      hook_event_name: 'SessionRename',
      name: 'fix the parser',
      timestamp: 2,
    })

    expect((await store.getSessionById(ROOT_ID)).slug).toBe('fix the parser')
    expect(broadcasts).toContainEqual({
      type: 'session_update',
      data: { id: ROOT_ID, slug: 'fix the parser' },
    })
  })

  test('LLM generations from parent and child roll up into session token totals', async () => {
    await ingestAll()
    const gens = ENVELOPES.filter((e) => e.hook_event_name === 'LLMGeneration')
    const input = gens.reduce((a, e) => a + (e.input_tokens as number), 0)
    const output = gens.reduce((a, e) => a + (e.output_tokens as number), 0)

    const session = await store.getSessionById(ROOT_ID)
    expect(session.total_input_tokens).toBe(input)
    expect(session.total_output_tokens).toBe(output)
    expect(session.llm_call_count).toBe(gens.length)
  })

  test('base64 images are redacted before storage, and an image-heavy event is no longer rejected', async () => {
    const prompt = ENVELOPES.find((e) => e.hook_event_name === 'UserPromptSubmit')!
    // 1.2 MB of image: over parseRawEvent's 1 MB guard before redaction.
    const blob = 'iVBORw0KGgo' + 'A'.repeat(1_200_000)
    const res = await post(app, {
      ...prompt,
      prompt: `what is in data:image/png;base64,${blob} ?`,
      images: 1,
    })
    expect(res.status).toBe(201)

    const events = await store.getEventsForSession(ROOT_ID)
    expect(events).toHaveLength(1)
    expect(events[0].subtype).toBe('UserPromptSubmit')
    const stored = JSON.parse(events[0].payload)
    expect(stored.prompt).toBe(
      `what is in data:image/png;base64,[REDACTED base64 ${blob.length} chars] ?`,
    )
  })
})
