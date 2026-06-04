/**
 * Tests for the centralized event-icon-registry.
 *
 * Adapted from the upstream test suite for our event key format.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
  resolveEventKey,
  type EventIconEntry,
  type IconCustomization,
} from './event-icon-registry'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** All unique colour keys referenced by registry entries. */
function registryColorKeys(): Set<string> {
  return new Set(EVENT_ICON_REGISTRY.map((e) => e.defaultColor))
}

/** All unique registry entry IDs. */
function registryIds(): Set<string> {
  return new Set(EVENT_ICON_REGISTRY.map((e) => e.id))
}

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
// resolveEventIcon
// ---------------------------------------------------------------------------

describe('resolveEventIcon', () => {
  it('returns the correct icon for a known non-tool key', () => {
    expect(resolveEventIcon('SessionStart')).toBe('Rocket')
    expect(resolveEventIcon('SessionEnd')).toBe('Flag')
    expect(resolveEventIcon('Stop')).toBe('CircleStop')
    expect(resolveEventIcon('StopFailure')).toBe('Bomb')
    expect(resolveEventIcon('LLMGeneration')).toBe('Brain')
    expect(resolveEventIcon('Notification')).toBe('Bell')
    expect(resolveEventIcon('PreCompact')).toBe('Minimize')
    expect(resolveEventIcon('SubagentStart')).toBe('Bot')
  })

  it('returns the correct icon for a bare tool-name key', () => {
    expect(resolveEventIcon('Bash')).toBe('Zap')
    expect(resolveEventIcon('Read')).toBe('BookOpen')
    expect(resolveEventIcon('Write')).toBe('Pencil')
    expect(resolveEventIcon('Edit')).toBe('FilePen')
    expect(resolveEventIcon('Glob')).toBe('Search')
    expect(resolveEventIcon('Grep')).toBe('SearchCode')
    expect(resolveEventIcon('WebSearch')).toBe('Globe')
    expect(resolveEventIcon('Agent')).toBe('Bot')
  })

  it('returns the correct icon for a per-phase tool key', () => {
    expect(resolveEventIcon('PreToolUse:Bash')).toBe('Zap')
    expect(resolveEventIcon('PostToolUse:Bash')).toBe('Zap')
    expect(resolveEventIcon('PostToolUseFailure:Bash')).toBe('Zap')
  })

  it('falls back to generic phase key for unknown tool names', () => {
    // "PreToolUse:UnknownTool" has no explicit entry → falls back to "PreToolUse" → Wrench
    expect(resolveEventIcon('PreToolUse:SomeUnknownTool')).toBe('Wrench')
    expect(resolveEventIcon('PostToolUse:SomeUnknownTool')).toBe('CircleCheck')
    expect(resolveEventIcon('PostToolUseFailure:SomeUnknownTool')).toBe('CircleX')
  })

  it('falls back to DEFAULT_ICON for a completely unknown key', () => {
    expect(resolveEventIcon('TotallyUnknown')).toBe(DEFAULT_ICON)
    expect(resolveEventIcon('')).toBe(DEFAULT_ICON)
    expect(resolveEventIcon('Nope:Nothing')).toBe(DEFAULT_ICON) // generic phase not in registry either
  })

  it('resolves MCP tool keys', () => {
    expect(resolveEventIcon('PreToolUse:mcp__browser__navigate')).toBe('Plug')
    expect(resolveEventIcon('PostToolUse:mcp__filesystem__read')).toBe('Plug')
  })
})

// ---------------------------------------------------------------------------
// resolveEventColor
// ---------------------------------------------------------------------------

describe('resolveEventColor', () => {
  it('returns the correct ColorPreset for known keys', () => {
    expect(resolveEventColor('SessionStart')).toBe(COLOR_PRESETS.YELLOW)
    expect(resolveEventColor('UserPromptSubmit')).toBe(COLOR_PRESETS.GREEN)
    expect(resolveEventColor('PermissionRequest')).toBe(COLOR_PRESETS.ROSE)
    expect(resolveEventColor('DaemonStart')).toBe(COLOR_PRESETS.ORANGE)
    expect(resolveEventColor('BridgeConnected')).toBe(COLOR_PRESETS.CYAN)
    expect(resolveEventColor('Elicitation')).toBe(COLOR_PRESETS.INDIGO)
    expect(resolveEventColor('StopFailure')).toBe(COLOR_PRESETS.RED)
  })

  it('returns per-phase colours for tool keys', () => {
    // PreToolUse:Bash → BLUE (same as generic PreToolUse)
    expect(resolveEventColor('PreToolUse:Bash')).toBe(COLOR_PRESETS.BLUE)
    // PostToolUse:Bash → BLUE
    expect(resolveEventColor('PostToolUse:Bash')).toBe(COLOR_PRESETS.BLUE)
    // PostToolUseFailure:Bash → RED
    expect(resolveEventColor('PostToolUseFailure:Bash')).toBe(COLOR_PRESETS.RED)
  })

  it('falls back to generic phase colour for unknown tool names', () => {
    expect(resolveEventColor('PostToolUseFailure:UnknownTool')).toBe(COLOR_PRESETS.RED)
    expect(resolveEventColor('PreToolUse:UnknownTool')).toBe(COLOR_PRESETS.BLUE)
  })

  it('returns DEFAULT_COLOR_PRESET for completely unknown keys', () => {
    expect(resolveEventColor('TotallyUnknown')).toBe(DEFAULT_COLOR_PRESET)
  })

  it('resolves MCP tool colours', () => {
    expect(resolveEventColor('PreToolUse:mcp__anything')).toBe(COLOR_PRESETS.CYAN)
    expect(resolveEventColor('PostToolUseFailure:mcp__anything')).toBe(COLOR_PRESETS.RED)
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
// resolveEventKey
// ---------------------------------------------------------------------------

describe('resolveEventKey', () => {
  it('returns subtype as-is for non-tool events', () => {
    expect(resolveEventKey('LLMGeneration')).toBe('LLMGeneration')
    expect(resolveEventKey('SessionStart')).toBe('SessionStart')
    expect(resolveEventKey('Stop')).toBe('Stop')
    expect(resolveEventKey('Notification')).toBe('Notification')
  })

  it('combines subtype and toolName with colon for tool events', () => {
    expect(resolveEventKey('PreToolUse', 'Bash')).toBe('PreToolUse:Bash')
    expect(resolveEventKey('PostToolUse', 'Write')).toBe('PostToolUse:Write')
    expect(resolveEventKey('PostToolUseFailure', 'Grep')).toBe('PostToolUseFailure:Grep')
  })

  it('collapses MCP tools to the _MCP key', () => {
    expect(resolveEventKey('PreToolUse', 'mcp__browser__navigate')).toBe('PreToolUse:_MCP')
    expect(resolveEventKey('PostToolUse', 'mcp__filesystem__read')).toBe('PostToolUse:_MCP')
    expect(resolveEventKey('PostToolUseFailure', 'mcp__something')).toBe('PostToolUseFailure:_MCP')
  })

  it('returns "unknown" for null subtype', () => {
    expect(resolveEventKey(null)).toBe('unknown')
    expect(resolveEventKey(null, 'Bash')).toBe('unknown')
  })

  it('returns subtype-only when tool event has no toolName', () => {
    expect(resolveEventKey('PreToolUse', null)).toBe('PreToolUse')
    expect(resolveEventKey('PostToolUse', undefined)).toBe('PostToolUse')
  })
})

// ---------------------------------------------------------------------------
// Registry coverage: ensure key event types are present
// ---------------------------------------------------------------------------

describe('registry coverage', () => {
  const ids = registryIds()

  // Non-tool subtypes that MUST be in the registry
  const requiredNonToolIds = [
    'SessionStart',
    'SessionEnd',
    'Stop',
    'StopFailure',
    'UserPromptSubmit',
    'UserPromptSubmitResponse',
    'SubagentStart',
    'SubagentStop',
    'PreCompact',
    'PostCompact',
    'LLMGeneration',
    'Notification',
    'Elicitation',
    'ElicitationResult',
    'PermissionRequest',
    'PermissionDenied',
    'InstructionsLoaded',
    'ConfigChange',
    'CwdChanged',
    'FileChanged',
    'WorktreeCreate',
    'WorktreeRemove',
    'DaemonStart',
    'DaemonStop',
    'DaemonHeartbeat',
    'PipeRoleAssigned',
    'PipeAttach',
    'PipeDetach',
    'PipePromptRouted',
    'PipePermissionForward',
    'PipeLanPeerDiscovered',
    'CoordinatorDispatch',
    'CoordinatorResult',
    'BridgeConnected',
    'BridgeDisconnected',
    'BridgeWorkReceived',
    'SuperModeToggle',
    'TaskCreated',
    'TaskCompleted',
    'CompactionRun',
    'CostUpdate',
    'ToolBatch',
    'Message',
    'Error',
    'Config',
    'Metrics',
    'Startup',
    'Shutdown',
  ]

  // Per-phase tool keys that MUST be in the registry
  const requiredToolPhaseIds = [
    'PreToolUse',
    'PostToolUse',
    'PostToolUseFailure',
    'PreToolUse:_MCP',
    'PostToolUse:_MCP',
    'PostToolUseFailure:_MCP',
  ]

  // Bare tool-name keys
  const requiredToolNameIds = [
    'Bash',
    'Read',
    'Write',
    'Edit',
    'Glob',
    'Grep',
    'WebSearch',
    'WebFetch',
    'Agent',
  ]

  it('contains all required non-tool event types', () => {
    for (const id of requiredNonToolIds) {
      expect(ids.has(id), `missing non-tool registry entry: "${id}"`).toBe(true)
    }
  })

  it('contains all required per-phase tool entries', () => {
    for (const id of requiredToolPhaseIds) {
      expect(ids.has(id), `missing tool phase registry entry: "${id}"`).toBe(true)
    }
  })

  it('contains all required bare tool-name entries', () => {
    for (const id of requiredToolNameIds) {
      expect(ids.has(id), `missing tool-name registry entry: "${id}"`).toBe(true)
    }
  })

  it('contains per-phase entries for each tool name', () => {
    for (const tool of requiredToolNameIds) {
      expect(ids.has(`PreToolUse:${tool}`), `missing PreToolUse:${tool}`).toBe(true)
      expect(ids.has(`PostToolUse:${tool}`), `missing PostToolUse:${tool}`).toBe(true)
      expect(ids.has(`PostToolUseFailure:${tool}`), `missing PostToolUseFailure:${tool}`).toBe(true)
    }
  })
})
