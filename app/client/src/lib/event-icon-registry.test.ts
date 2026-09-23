/**
 * Tests for the centralized event-icon-registry (icon ids chosen per agent
 * class — see agents/pi/describe.ts piIconId).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import dynamicIconImports from 'lucide-react/dynamicIconImports'
import { resolveIconName } from './dynamic-icon'
import {
  EVENT_ICON_REGISTRY,
  COLOR_PRESETS,
  DEFAULT_COLOR_PRESET,
  DEFAULT_COLOR_KEY,
  DEFAULT_ICON,
  resolveEventIcon,
  resolveEventColor,
  getEventIcon,
  getEventColor,
  hasIconEntry,
  type IconCustomization,
} from './event-icon-registry'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EVENT_ICON_REGISTRY', () => {
  it('every entry has a non-empty id', () => {
    for (const entry of EVENT_ICON_REGISTRY) {
      expect(entry.id, `entry with icon "${entry.icon}" has empty id`).toBeTruthy()
    }
  })

  it('every entry has a non-empty PascalCase icon name', () => {
    for (const entry of EVENT_ICON_REGISTRY) {
      expect(entry.icon, `entry "${entry.id}" has empty icon`).toBeTruthy()
      // PascalCase: starts with uppercase, no hyphens
      expect(entry.icon, `entry "${entry.id}" icon "${entry.icon}" is not PascalCase`).toMatch(
        /^[A-Z]/,
      )
      expect(entry.icon).not.toContain('-')
    }
  })

  it('every entry has a non-empty name', () => {
    for (const entry of EVENT_ICON_REGISTRY) {
      expect(entry.name, `entry "${entry.id}" has empty name`).toBeTruthy()
    }
  })

  it('every defaultColor references a valid COLOR_PRESETS key', () => {
    for (const entry of EVENT_ICON_REGISTRY) {
      expect(
        COLOR_PRESETS[entry.defaultColor],
        `entry "${entry.id}" has invalid defaultColor "${entry.defaultColor}"`,
      ).toBeDefined()
    }
  })

  it('contains the default colour key in COLOR_PRESETS', () => {
    expect(COLOR_PRESETS[DEFAULT_COLOR_KEY]).toBeDefined()
  })

  it('has no duplicate ids', () => {
    const seen = new Set<string>()
    for (const entry of EVENT_ICON_REGISTRY) {
      expect(seen.has(entry.id), `duplicate id "${entry.id}"`).toBe(false)
      seen.add(entry.id)
    }
  })

  it('all entries with a group have a non-empty group string', () => {
    for (const entry of EVENT_ICON_REGISTRY) {
      if (entry.group !== undefined) {
        expect(entry.group, `entry "${entry.id}" group is empty`).toBeTruthy()
      }
    }
  })
})

describe('COLOR_PRESETS', () => {
  it('every preset has iconColor, dotColor, and swatch', () => {
    for (const [key, preset] of Object.entries(COLOR_PRESETS)) {
      expect(preset.iconColor, `"${key}" missing iconColor`).toBeTruthy()
      expect(preset.dotColor, `"${key}" missing dotColor`).toBeTruthy()
      expect(preset.swatch, `"${key}" missing swatch`).toBeTruthy()
    }
  })

  it('swatches are valid hex colours', () => {
    for (const [key, preset] of Object.entries(COLOR_PRESETS)) {
      expect(preset.swatch, `"${key}" swatch "${preset.swatch}"`).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })

  it('iconColor and dotColor are non-empty strings', () => {
    for (const [key, preset] of Object.entries(COLOR_PRESETS)) {
      expect(preset.iconColor.length, `"${key}" iconColor empty`).toBeGreaterThan(0)
      expect(preset.dotColor.length, `"${key}" dotColor empty`).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// resolveEventIcon / resolveEventColor
// ---------------------------------------------------------------------------

describe('resolveEventIcon', () => {
  it('resolves pi built-in tools', () => {
    expect(resolveEventIcon('read')).toBe('BookOpen')
    expect(resolveEventIcon('bash')).toBe('Terminal')
    expect(resolveEventIcon('edit')).toBe('FilePen')
    expect(resolveEventIcon('write')).toBe('Pencil')
    expect(resolveEventIcon('grep')).toBe('SearchCode')
    expect(resolveEventIcon('find')).toBe('Search')
    expect(resolveEventIcon('ls')).toBe('FolderOpen')
  })

  it('resolves subagent, MCP and browser tools', () => {
    expect(resolveEventIcon('Agent')).toBe('Bot')
    expect(resolveEventIcon('SubAgent')).toBe('Bot')
    expect(resolveEventIcon('StopAgent')).toBe('OctagonX')
    expect(resolveEventIcon('AgentStatus')).toBe('ListChecks')
    expect(resolveEventIcon('mcp')).toBe('Plug')
    expect(resolveEventIcon('mcpScript')).toBe('FileCode')
    expect(resolveEventIcon('browser')).toBe('Globe')
  })

  it('resolves pi events and their variants', () => {
    expect(resolveEventIcon('SystemPrompt')).toBe('ScrollText')
    expect(resolveEventIcon('LLMGeneration')).toBe('Brain')
    expect(resolveEventIcon('LLMGenerationError')).toBe('TriangleAlert')
    expect(resolveEventIcon('UserPromptSubmit:extension')).toBe('MessageSquareShare')
    expect(resolveEventIcon('CustomMessage:subagent-result')).toBe('Inbox')
    expect(resolveEventIcon('CompactionFailed')).toBe('CircleAlert')
  })

  it('falls back to the default icon for unknown ids', () => {
    expect(resolveEventIcon('NoSuchEvent')).toBe(DEFAULT_ICON)
    expect(resolveEventIcon('')).toBe(DEFAULT_ICON)
  })
})

describe('resolveEventColor', () => {
  it('resolves registered colours', () => {
    expect(resolveEventColor('SessionStart')).toBe(COLOR_PRESETS.YELLOW)
    expect(resolveEventColor('bash')).toBe(COLOR_PRESETS.BLUE)
    expect(resolveEventColor('Agent')).toBe(COLOR_PRESETS.PURPLE)
    expect(resolveEventColor('browser')).toBe(COLOR_PRESETS.CYAN)
    expect(resolveEventColor('PostToolUseFailure')).toBe(COLOR_PRESETS.RED)
    expect(resolveEventColor('UserPromptSubmit:extension')).toBe(COLOR_PRESETS.AMBER)
  })

  it('falls back to the default colour for unknown ids', () => {
    expect(resolveEventColor('NoSuchEvent')).toBe(DEFAULT_COLOR_PRESET)
  })
})

// ---------------------------------------------------------------------------
// getEventIcon / getEventColor (with localStorage customisations)
// ---------------------------------------------------------------------------

describe('getEventIcon with customizations', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('returns the registry default when no customizations exist', () => {
    expect(getEventIcon('SessionStart', null)).toBe('Rocket')
  })

  it('returns the overridden icon when a customization is provided', () => {
    const cust: Record<string, IconCustomization> = {
      SessionStart: { iconName: 'Star' },
    }
    expect(getEventIcon('SessionStart', cust)).toBe('Star')
  })

  it('falls back to registry default when customization is empty', () => {
    const cust: Record<string, IconCustomization> = {
      SessionStart: {},
    }
    expect(getEventIcon('SessionStart', cust)).toBe('Rocket')
  })

  it('reads customizations from localStorage when none are passed', () => {
    localStorage.setItem(
      'observe-icon-customizations',
      JSON.stringify({ SessionStart: { iconName: 'Heart' } }),
    )
    expect(getEventIcon('SessionStart')).toBe('Heart')
  })

  it('handles missing localStorage gracefully', () => {
    localStorage.removeItem('observe-icon-customizations')
    expect(getEventIcon('SessionStart')).toBe('Rocket')
  })

  it('handles malformed localStorage JSON gracefully', () => {
    localStorage.setItem('observe-icon-customizations', 'not-json')
    expect(getEventIcon('SessionStart')).toBe('Rocket')
  })
})

describe('getEventColor with customizations', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('returns the registry default colour when no customizations exist', () => {
    const result = getEventColor('SessionStart', null)
    expect(result.color).toBe(COLOR_PRESETS.YELLOW)
    expect(result.customHex).toBeUndefined()
  })

  it('returns the overridden colour from a preset key', () => {
    const cust: Record<string, IconCustomization> = {
      SessionStart: { colorName: 'RED' },
    }
    const result = getEventColor('SessionStart', cust)
    expect(result.color).toBe(COLOR_PRESETS.RED)
    expect(result.customHex).toBeUndefined()
  })

  it('returns customHex when colorName is "custom"', () => {
    const cust: Record<string, IconCustomization> = {
      SessionStart: { colorName: 'custom', customHex: '#ff5500' },
    }
    const result = getEventColor('SessionStart', cust)
    expect(result.customHex).toBe('#ff5500')
  })

  it('falls back to registry default when customization has no colour info', () => {
    const cust: Record<string, IconCustomization> = {
      SessionStart: { iconName: 'Star' },
    }
    const result = getEventColor('SessionStart', cust)
    expect(result.color).toBe(COLOR_PRESETS.YELLOW)
  })

  it('reads from localStorage when no customizations param passed', () => {
    localStorage.setItem(
      'observe-icon-customizations',
      JSON.stringify({ SessionStart: { colorName: 'GREEN' } }),
    )
    const result = getEventColor('SessionStart')
    expect(result.color).toBe(COLOR_PRESETS.GREEN)
  })

  it('returns fallback for unknown colour preset key', () => {
    const cust: Record<string, IconCustomization> = {
      SessionStart: { colorName: 'NONEXISTENT' },
    }
    const result = getEventColor('SessionStart', cust)
    expect(result.color).toBe(COLOR_PRESETS.YELLOW) // falls back to registry
  })
})

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

describe('registry coverage', () => {
  // Every hook_event_name in docs/pi-protocol.md.
  const PI_EVENTS = [
    'SessionStart',
    'SessionEnd',
    'SessionRename',
    'SystemPrompt',
    'UserPromptSubmit',
    'PreToolUse',
    'PostToolUse',
    'PostToolUseFailure',
    'LLMGeneration',
    'Stop',
    'SubagentStart',
    'SubagentStop',
    'PreCompact',
    'PostCompact',
    'CompactionFailed',
    'ModelChange',
    'ThinkingLevelChange',
    'UserBash',
    'Notification',
    'SessionTree',
    'CustomMessage',
  ]

  it.each(PI_EVENTS)('has an entry for pi event %s', (id) => {
    expect(hasIconEntry(id)).toBe(true)
  })

  it('names only icons that exist in lucide-react', () => {
    for (const entry of EVENT_ICON_REGISTRY) {
      const name = resolveIconName(entry.icon)
      expect(name, `${entry.id}: ${entry.icon}`).not.toBeNull()
      expect(name! in dynamicIconImports).toBe(true)
    }
  })

  it('has no OpenClaude / Claude Code entries', () => {
    for (const id of [
      'Bash',
      'Read',
      'Glob',
      'StopFailure',
      'PermissionRequest',
      'DaemonStart',
      '_MCP',
    ]) {
      expect(hasIconEntry(id), id).toBe(false)
    }
  })
})
