import { test, expect, beforeEach } from 'bun:test'
import {
  initDatabase,
  upsertProject,
  upsertSession,
  upsertAgent,
  insertEvent,
  getProjects,
  getSessionsForProject,
  getAgentsForSession,
  getEventsForSession,
  clearAllData,
} from './db'

beforeEach(() => {
  initDatabase(':memory:')
})

test('upsert project and query', () => {
  upsertProject('test-proj', 'Test Project')
  const projects = getProjects()
  expect(projects).toHaveLength(1)
  expect(projects[0].id).toBe('test-proj')
})

test('upsert session with agents and events', () => {
  upsertProject('proj1', 'Project 1')
  upsertSession('sess1', 'proj1', 'twinkly-dragon', null, Date.now())
  upsertAgent('agent1', 'sess1', null, 'twinkly-dragon', null, Date.now())
  upsertAgent('agent2', 'sess1', 'agent1', null, 'ls-subagent', Date.now())

  const eventId = insertEvent(
    'agent1',
    'sess1',
    'user',
    'UserPromptSubmit',
    null,
    '"hello"',
    Date.now(),
    { test: true },
  )
  expect(eventId).toBeGreaterThan(0)

  const agents = getAgentsForSession('sess1')
  expect(agents).toHaveLength(2)

  const events = getEventsForSession('sess1')
  expect(events).toHaveLength(1)
})

test('event filtering by agent', () => {
  upsertProject('proj1', 'Project 1')
  upsertSession('sess1', 'proj1', null, null, Date.now())
  upsertAgent('a1', 'sess1', null, null, null, Date.now())
  upsertAgent('a2', 'sess1', null, null, null, Date.now())

  insertEvent('a1', 'sess1', 'user', 'UserPromptSubmit', null, 'hello', Date.now(), {})
  insertEvent('a2', 'sess1', 'assistant', 'PreToolUse', 'Bash', 'ls', Date.now(), {})

  const filtered = getEventsForSession('sess1', { agentIds: ['a1'] })
  expect(filtered).toHaveLength(1)
  expect(filtered[0].agent_id).toBe('a1')
})

test('clearAllData empties all tables', () => {
  upsertProject('proj1', 'Project 1')
  upsertSession('sess1', 'proj1', null, null, Date.now())
  upsertAgent('a1', 'sess1', null, null, null, Date.now())
  insertEvent('a1', 'sess1', 'user', null, null, null, Date.now(), {})

  clearAllData()
  expect(getProjects()).toHaveLength(0)
})
