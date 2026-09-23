/**
 * Tests for event-icons.ts — per-class icon id resolution plus the
 * customisation-aware icon/colour lookups the stream, timeline and settings use.
 */
import { describe, it, expect } from 'vitest'
import {
  eventIconId,
  getEventIcon,
  getEventColor,
  eventIcons,
  eventColors,
  defaultEventIcon,
} from './event-icons'
import { EVENT_ICON_REGISTRY, COLOR_PRESETS } from '@/lib/event-icon-registry'
import { piFixtureEvents } from '@/test/pi-fixture'
import type { ParsedEvent } from '@/types'

function displayName(icon: unknown): string | undefined {
  return (icon as { displayName?: string }).displayName
}

function ev(overrides: Partial<ParsedEvent>): ParsedEvent {
  return {
    id: 1,
    agentId: 'a',
    sessionId: 's',
    type: 'system',
    subtype: null,
    toolName: null,
    toolUseId: null,
    status: 'pending',
    timestamp: 0,
    payload: { agent_class: 'pi' },
    ...overrides,
  }
}

describe('eventIconId', () => {
  it('maps every event of the real pi capture to a registered icon', () => {
    const registered = new Set(EVENT_ICON_REGISTRY.map((e) => e.id))
    for (const e of piFixtureEvents()) {
      expect(registered.has(eventIconId(e)), `${e.subtype}:${e.toolName}`).toBe(true)
    }
  })

  it('keys pi tools by their lowercase names', () => {
    const events = piFixtureEvents()
    const read = events.find((e) => e.subtype === 'PreToolUse' && e.toolName === 'read')!
    const bash = events.find((e) => e.subtype === 'PreToolUse' && e.toolName === 'bash')!
    const agent = events.find((e) => e.subtype === 'PreToolUse' && e.toolName === 'Agent')!
    expect(eventIconId(read)).toBe('read')
    expect(eventIconId(bash)).toBe('bash')
    expect(eventIconId(agent)).toBe('Agent')
  })

  it('collapses browser_* direct tools and marks variants', () => {
    expect(eventIconId(ev({ subtype: 'PreToolUse', toolName: 'browser_navigate' }))).toBe('browser')
    expect(eventIconId(ev({ subtype: 'PreToolUse', toolName: 'some_extension_tool' }))).toBe(
      'PreToolUse',
    )
    expect(
      eventIconId(
        ev({ subtype: 'UserPromptSubmit', payload: { agent_class: 'pi', source: 'extension' } }),
      ),
    ).toBe('UserPromptSubmit:extension')
    expect(
      eventIconId(
        ev({ subtype: 'LLMGeneration', payload: { agent_class: 'pi', stop_reason: 'error' } }),
      ),
    ).toBe('LLMGenerationError')
    expect(
      eventIconId(
        ev({
          subtype: 'CustomMessage',
          payload: { agent_class: 'pi', custom_type: 'subagent-result' },
        }),
      ),
    ).toBe('CustomMessage:subagent-result')
  })

  it('uses the default class for legacy claude-code rows', () => {
    const legacy = ev({
      subtype: 'PreToolUse',
      toolName: 'Bash',
      payload: { agent_class: 'claude-code' },
    })
    expect(eventIconId(legacy)).toBe('PreToolUse')
    expect(eventIconId(ev({ subtype: 'StopFailure', payload: {} }))).toBe('Default')
  })
})

describe('getEventIcon / getEventColor', () => {
  it('resolves registry icons by id', () => {
    expect(displayName(getEventIcon('bash'))).toBe('Terminal')
    expect(displayName(getEventIcon('LLMGeneration'))).toBe('Brain')
  })

  it('falls back to the pin icon for unknown ids', () => {
    expect(displayName(getEventIcon('NoSuchEvent'))).toBe('Pin')
  })

  it('resolves registry colours by id', () => {
    expect(getEventColor('Agent').iconColor).toBe(COLOR_PRESETS.PURPLE.iconColor)
    expect(getEventColor('NoSuchEvent').iconColor).toBe(COLOR_PRESETS.GRAY.iconColor)
  })
})

describe('eventIcons / eventColors (settings UI maps)', () => {
  it('have an entry for every registry id', () => {
    for (const entry of EVENT_ICON_REGISTRY) {
      expect(eventIcons[entry.id], entry.id).toBeDefined()
      expect(eventColors[entry.id], entry.id).toBeDefined()
    }
  })

  it('exposes a default icon', () => {
    expect(displayName(defaultEventIcon)).toBe('Pin')
  })
})
