/**
 * Tests for event-icons.ts — React-level icon/color resolution with
 * user-customization support.
 *
 * All heavy dependencies (lucide-react, react, the registry, customisation
 * hooks) are mocked so the tests focus on the orchestration logic.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Vitest mocks (hoisted — must come before imports so module-level code in
// event-icons.ts resolves against mocked deps).  All data is defined inside
// the factories because vi.mock factories are hoisted above top-level
// variable declarations.
// ---------------------------------------------------------------------------

vi.mock('react', () => ({
  lazy: vi.fn((fn: unknown) => fn),
}))

vi.mock('lucide-react/dynamicIconImports', () => {
  // All icon names referenced in the registry + fallbacks
  const names = [
    'Rocket',
    'Flag',
    'MessageSquare',
    'Zap',
    'BookOpen',
    'Pencil',
    'FilePen',
    'SearchCode',
    'Plug',
    'Wrench',
    'CircleCheck',
    'CircleX',
    'CircleStop',
    'Brain',
    'Bell',
    'Minimize',
    'Bot',
    'Pin',
    'pin',
  ]
  const imports: Record<string, unknown> = {}
  for (const name of names) {
    const fn = () => null
    fn.displayName = `MockIcon(${name})`
    // Wrap in an object the way a real dynamic import would — but our lazy()
    // mock just returns the factory directly, so this doesn't matter much.
    // We store the mock function itself for identity checks in tests.
    ;(imports as any)[name] = fn
  }
  return { default: imports }
})

vi.mock('@/lib/dynamic-icon', () => ({
  resolveIconName: vi.fn((name: string) => name),
}))

vi.mock('@/lib/event-icon-registry', () => {
  const TEST_REGISTRY = [
    {
      id: 'SessionStart',
      icon: 'Rocket',
      defaultColor: 'YELLOW',
      name: 'Session Start',
      group: 'Session',
    },
    {
      id: 'SessionEnd',
      icon: 'Flag',
      defaultColor: 'YELLOW',
      name: 'Session End',
      group: 'Session',
    },
    {
      id: 'UserPromptSubmit',
      icon: 'MessageSquare',
      defaultColor: 'GREEN',
      name: 'User Prompt',
      group: 'User Input',
    },
    { id: 'Bash', icon: 'Zap', defaultColor: 'BLUE', name: 'Bash', group: 'Tools' },
    { id: 'Read', icon: 'BookOpen', defaultColor: 'BLUE', name: 'Read', group: 'Tools' },
    { id: 'Write', icon: 'Pencil', defaultColor: 'BLUE', name: 'Write', group: 'Tools' },
    { id: 'Edit', icon: 'FilePen', defaultColor: 'BLUE', name: 'Edit', group: 'Tools' },
    { id: 'Grep', icon: 'SearchCode', defaultColor: 'BLUE', name: 'Grep', group: 'Tools' },
    { id: '_MCP', icon: 'Plug', defaultColor: 'CYAN', name: 'MCP Tool', group: 'MCP' },
    { id: 'PreToolUse', icon: 'Wrench', defaultColor: 'BLUE', name: 'Tool Use', group: 'Tools' },
    {
      id: 'PostToolUse',
      icon: 'CircleCheck',
      defaultColor: 'BLUE',
      name: 'Tool Success',
      group: 'Tools',
    },
    {
      id: 'PostToolUseFailure',
      icon: 'CircleX',
      defaultColor: 'RED',
      name: 'Tool Failure',
      group: 'Tools',
    },
    {
      id: 'PreToolUse:_MCP',
      icon: 'Plug',
      defaultColor: 'CYAN',
      name: 'MCP Tool (Pre)',
      group: 'MCP',
    },
    {
      id: 'PostToolUse:_MCP',
      icon: 'Plug',
      defaultColor: 'CYAN',
      name: 'MCP Tool (Post)',
      group: 'MCP',
    },
    {
      id: 'PostToolUseFailure:_MCP',
      icon: 'Plug',
      defaultColor: 'RED',
      name: 'MCP Tool (Failure)',
      group: 'MCP',
    },
    { id: 'Stop', icon: 'CircleStop', defaultColor: 'YELLOW', name: 'Stop', group: 'Session' },
    {
      id: 'LLMGeneration',
      icon: 'Brain',
      defaultColor: 'BLUE',
      name: 'LLM Generation',
      group: 'LLM',
    },
    {
      id: 'Notification',
      icon: 'Bell',
      defaultColor: 'BLUE',
      name: 'Notification',
      group: 'System',
    },
    {
      id: 'PreCompact',
      icon: 'Minimize',
      defaultColor: 'GRAY',
      name: 'Pre-Compact',
      group: 'Compaction',
    },
    {
      id: 'SubagentStart',
      icon: 'Bot',
      defaultColor: 'PURPLE',
      name: 'Subagent Start',
      group: 'Agents',
    },
  ]

  const TEST_COLOR_PRESETS: Record<string, { iconColor: string; dotColor: string }> = {
    RED: { iconColor: 'text-red-500', dotColor: 'bg-red-500' },
    BLUE: { iconColor: 'text-blue-500', dotColor: 'bg-blue-500' },
    GREEN: { iconColor: 'text-green-500', dotColor: 'bg-green-500' },
    YELLOW: { iconColor: 'text-yellow-500', dotColor: 'bg-yellow-500' },
    PURPLE: { iconColor: 'text-purple-500', dotColor: 'bg-purple-500' },
    CYAN: { iconColor: 'text-cyan-500', dotColor: 'bg-cyan-500' },
    GRAY: { iconColor: 'text-gray-500', dotColor: 'bg-gray-500' },
  }

  const TEST_DEFAULT_ICON_NAME = 'Pin'

  function registryLookup(key: string) {
    return TEST_REGISTRY.find((e) => e.id === key)
  }

  return {
    EVENT_ICON_REGISTRY: TEST_REGISTRY,
    DEFAULT_ICON: TEST_DEFAULT_ICON_NAME,
    resolveEventIcon: vi.fn((key: string) => {
      const entry = registryLookup(key)
      return entry ? entry.icon : TEST_DEFAULT_ICON_NAME
    }),
    resolveEventColor: vi.fn((key: string) => {
      const entry = registryLookup(key)
      const colorKey = entry?.defaultColor ?? 'GRAY'
      return TEST_COLOR_PRESETS[colorKey] ?? TEST_COLOR_PRESETS.GRAY
    }),
  }
})

// Mutable state so tests can set up customisation overrides.
let customIcons: Record<string, { iconName?: string; colorName?: string; customHex?: string }> = {}

vi.mock('@/hooks/use-icon-customizations', () => {
  const TEST_COLOR_PRESETS: Record<string, { iconColor: string; dotColor: string }> = {
    RED: { iconColor: 'text-red-500', dotColor: 'bg-red-500' },
    BLUE: { iconColor: 'text-blue-500', dotColor: 'bg-blue-500' },
    GREEN: { iconColor: 'text-green-500', dotColor: 'bg-green-500' },
    YELLOW: { iconColor: 'text-yellow-500', dotColor: 'bg-yellow-500' },
    PURPLE: { iconColor: 'text-purple-500', dotColor: 'bg-purple-500' },
    CYAN: { iconColor: 'text-cyan-500', dotColor: 'bg-cyan-500' },
    GRAY: { iconColor: 'text-gray-500', dotColor: 'bg-gray-500' },
    ORANGE: { iconColor: 'text-orange-500', dotColor: 'bg-orange-500' },
    SLATE: { iconColor: 'text-slate-500', dotColor: 'bg-slate-500' },
  }

  return {
    getIconCustomization: vi.fn((key: string) => customIcons[key] ?? null),
    COLOR_PRESETS: TEST_COLOR_PRESETS,
  }
})

// ---------------------------------------------------------------------------
// Dynamic import of lucide-react/dynamicIconImports so we can look up mock
// icon functions for identity checks.
// ---------------------------------------------------------------------------
import dynamicIconImports from 'lucide-react/dynamicIconImports'

const mockIcons = dynamicIconImports as unknown as Record<string, () => null>

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------
import {
  eventIcons,
  eventColors,
  defaultEventIcon,
  resolveEventKey,
  getEventIcon,
  getEventColor,
} from './event-icons'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveEventKey', () => {
  it('should return the subtype for non-tool events', () => {
    expect(resolveEventKey('SessionStart')).toBe('SessionStart')
    expect(resolveEventKey('LLMGeneration')).toBe('LLMGeneration')
    expect(resolveEventKey('Stop')).toBe('Stop')
    expect(resolveEventKey('Notification')).toBe('Notification')
    expect(resolveEventKey('PreCompact')).toBe('PreCompact')
  })

  it('should return the toolName for PreToolUse events', () => {
    expect(resolveEventKey('PreToolUse', 'Bash')).toBe('Bash')
    expect(resolveEventKey('PreToolUse', 'Read')).toBe('Read')
    expect(resolveEventKey('PreToolUse', 'Write')).toBe('Write')
    expect(resolveEventKey('PreToolUse', 'Edit')).toBe('Edit')
  })

  it('should return the toolName for PostToolUse events', () => {
    expect(resolveEventKey('PostToolUse', 'Bash')).toBe('Bash')
    expect(resolveEventKey('PostToolUse', 'Grep')).toBe('Grep')
  })

  it('should return the toolName for PostToolUseFailure events', () => {
    expect(resolveEventKey('PostToolUseFailure', 'Bash')).toBe('Bash')
    expect(resolveEventKey('PostToolUseFailure', 'Edit')).toBe('Edit')
  })

  it('should collapse MCP tools to "_MCP"', () => {
    expect(resolveEventKey('PreToolUse', 'mcp__browser__navigate')).toBe('_MCP')
    expect(resolveEventKey('PostToolUse', 'mcp__filesystem__read')).toBe('_MCP')
    expect(resolveEventKey('PostToolUseFailure', 'mcp__something')).toBe('_MCP')
  })

  it('should return subtype when tool event has no toolName', () => {
    expect(resolveEventKey('PreToolUse', null)).toBe('PreToolUse')
    expect(resolveEventKey('PostToolUse', undefined)).toBe('PostToolUse')
    expect(resolveEventKey('PostToolUseFailure', null)).toBe('PostToolUseFailure')
  })

  it('should return "unknown" for null subtype', () => {
    expect(resolveEventKey(null)).toBe('unknown')
    expect(resolveEventKey(null, 'Bash')).toBe('unknown')
    expect(resolveEventKey(null, 'mcp__tool')).toBe('unknown')
  })

  it('should return "unknown" for null subtype with no toolName', () => {
    expect(resolveEventKey(null, null)).toBe('unknown')
  })

  it('should return subtype as-is for non-tool subtype even when toolName provided', () => {
    expect(resolveEventKey('SessionStart', 'Bash')).toBe('SessionStart')
    expect(resolveEventKey('LLMGeneration', 'Read')).toBe('LLMGeneration')
  })
})

describe('eventIcons (derived from registry at module load)', () => {
  it('should contain entries for known registry ids', () => {
    expect(eventIcons['SessionStart']).toBeDefined()
    expect(eventIcons['SessionEnd']).toBeDefined()
    expect(eventIcons['UserPromptSubmit']).toBeDefined()
    expect(eventIcons['Bash']).toBeDefined()
    expect(eventIcons['Read']).toBeDefined()
    expect(eventIcons['Write']).toBeDefined()
    expect(eventIcons['Edit']).toBeDefined()
    expect(eventIcons['Grep']).toBeDefined()
  })

  it('should return functions (mock LucideIcon components)', () => {
    expect(typeof eventIcons['Bash']).toBe('function')
    expect(typeof eventIcons['SessionStart']).toBe('function')
  })
})

describe('eventColors (derived from registry at module load)', () => {
  it('should contain color tuples for known registry ids', () => {
    expect(eventColors['SessionStart']).toBeDefined()
    expect(eventColors['UserPromptSubmit']).toBeDefined()
    expect(eventColors['Bash']).toBeDefined()
    expect(eventColors['_MCP']).toBeDefined()
    expect(eventColors['Stop']).toBeDefined()
  })

  it('should return [iconColor, dotColor] tuples', () => {
    const color = eventColors['Bash']
    expect(Array.isArray(color)).toBe(true)
    expect(color.length).toBe(2)
    expect(typeof color[0]).toBe('string')
    expect(typeof color[1]).toBe('string')
  })

  it('should map BLUE for Bash tool', () => {
    const [iconColor, dotColor] = eventColors['Bash']
    expect(iconColor).toBe('text-blue-500')
    expect(dotColor).toBe('bg-blue-500')
  })

  it('should map YELLOW for SessionStart', () => {
    const [iconColor, dotColor] = eventColors['SessionStart']
    expect(iconColor).toBe('text-yellow-500')
    expect(dotColor).toBe('bg-yellow-500')
  })

  it('should map GREEN for UserPromptSubmit', () => {
    const [iconColor, dotColor] = eventColors['UserPromptSubmit']
    expect(iconColor).toBe('text-green-500')
    expect(dotColor).toBe('bg-green-500')
  })
})

describe('defaultEventIcon', () => {
  it('should be a function (mock LucideIcon)', () => {
    expect(typeof defaultEventIcon).toBe('function')
  })
})

describe('getEventIcon', () => {
  beforeEach(() => {
    customIcons = {}
  })

  it('should return an icon for a known subtype', () => {
    const icon = getEventIcon('SessionStart')
    expect(icon).toBeDefined()
    expect(typeof icon).toBe('function')
  })

  it('should return an icon for a known tool', () => {
    const icon = getEventIcon('PreToolUse', 'Bash')
    expect(icon).toBeDefined()
    expect(typeof icon).toBe('function')
  })

  it('should return an icon for an MCP tool', () => {
    const icon = getEventIcon('PreToolUse', 'mcp__browser__navigate')
    expect(icon).toBeDefined()
    expect(typeof icon).toBe('function')
  })

  it('should use user customization when available', () => {
    customIcons['Bash'] = { iconName: 'BookOpen' }

    const icon = getEventIcon('PreToolUse', 'Bash')
    // Customization overrides to BookOpen
    expect(icon).toBe(mockIcons['BookOpen'])
  })

  it('should fall back to registry when customization has no iconName', () => {
    customIcons['Bash'] = { colorName: 'RED' }

    const icon = getEventIcon('PreToolUse', 'Bash')
    // No custom iconName, so registry returns Zap
    expect(icon).toBe(mockIcons['Zap'])
  })

  it('should fall back to default icon for unknown event types', () => {
    const icon = getEventIcon('TotallyUnknownType')
    expect(icon).toBe(mockIcons['Pin'])
  })

  it('should handle null subtype gracefully', () => {
    const icon = getEventIcon(null)
    expect(icon).toBeDefined()
    expect(typeof icon).toBe('function')
  })

  it('should return an icon for PostToolUseFailure events', () => {
    const icon = getEventIcon('PostToolUseFailure', 'Grep')
    expect(icon).toBeDefined()
    expect(typeof icon).toBe('function')
  })

  it('should resolve icons for all known registry subtypes', () => {
    const nonToolSubtypes = [
      'SessionStart',
      'SessionEnd',
      'UserPromptSubmit',
      'Stop',
      'LLMGeneration',
      'Notification',
      'PreCompact',
      'SubagentStart',
    ]
    for (const subtype of nonToolSubtypes) {
      const icon = getEventIcon(subtype)
      expect(icon, `Failed to resolve icon for subtype: ${subtype}`).toBeDefined()
      expect(typeof icon, `Icon for ${subtype} should be a function`).toBe('function')
    }
  })

  it('should resolve icons for all known tool names', () => {
    const tools = ['Bash', 'Read', 'Write', 'Edit', 'Grep']
    for (const tool of tools) {
      const icon = getEventIcon('PreToolUse', tool)
      expect(icon, `Failed to resolve icon for tool: ${tool}`).toBeDefined()
      expect(typeof icon, `Icon for ${tool} should be a function`).toBe('function')
    }
  })
})

describe('getEventColor', () => {
  beforeEach(() => {
    customIcons = {}
  })

  it('should return registry colors for a known subtype', () => {
    const color = getEventColor('SessionStart')
    expect(color.iconColor).toBe('text-yellow-500')
    expect(color.dotColor).toBe('bg-yellow-500')
    expect(color.customHex).toBeUndefined()
  })

  it('should return registry colors for a known tool', () => {
    const color = getEventColor('PreToolUse', 'Bash')
    expect(color.iconColor).toBe('text-blue-500')
    expect(color.dotColor).toBe('bg-blue-500')
  })

  it('should return CYAN for MCP tools', () => {
    const color = getEventColor('PreToolUse', 'mcp__browser__navigate')
    expect(color.iconColor).toBe('text-cyan-500')
    expect(color.dotColor).toBe('bg-cyan-500')
  })

  it('should use user preset customization', () => {
    customIcons['Bash'] = { colorName: 'RED' }
    const color = getEventColor('PreToolUse', 'Bash')
    expect(color.iconColor).toBe('text-red-500')
    expect(color.dotColor).toBe('bg-red-500')
    expect(color.customHex).toBeUndefined()
  })

  it('should use user custom hex color', () => {
    customIcons['Bash'] = { colorName: 'custom', customHex: '#ff5500' }
    const color = getEventColor('PreToolUse', 'Bash')
    expect(color.iconColor).toBe('')
    expect(color.dotColor).toBe('')
    expect(color.customHex).toBe('#ff5500')
  })

  it('should fall back to registry when custom colorName has no hex', () => {
    customIcons['Bash'] = { colorName: 'custom' }
    const color = getEventColor('PreToolUse', 'Bash')
    // 'custom' is not a key in COLOR_PRESETS, so falls through to registry
    expect(color.iconColor).toBe('text-blue-500')
    expect(color.customHex).toBeUndefined()
  })

  it('should fall back to registry when customization has no color info', () => {
    customIcons['Bash'] = { iconName: 'BookOpen' }
    const color = getEventColor('PreToolUse', 'Bash')
    expect(color.iconColor).toBe('text-blue-500')
    expect(color.dotColor).toBe('bg-blue-500')
  })

  it('should return default colors for unknown event types', () => {
    const color = getEventColor('TotallyUnknownType')
    expect(color.iconColor).toBe('text-gray-500')
    expect(color.dotColor).toBe('bg-gray-500')
  })

  it('should handle null subtype gracefully', () => {
    const color = getEventColor(null)
    expect(color.iconColor).toBe('text-gray-500')
    expect(color.dotColor).toBe('bg-gray-500')
  })

  it('should return the tool color for PostToolUseFailure with toolName', () => {
    // resolveEventKey returns bare toolName → Grep → BLUE
    const colorWithTool = getEventColor('PostToolUseFailure', 'Grep')
    expect(colorWithTool.iconColor).toBe('text-blue-500')
    expect(colorWithTool.dotColor).toBe('bg-blue-500')
  })

  it('should return the subtype color for PostToolUseFailure without toolName', () => {
    // resolveEventKey returns 'PostToolUseFailure' → RED
    const colorWithoutTool = getEventColor('PostToolUseFailure', null)
    expect(colorWithoutTool.iconColor).toBe('text-red-500')
    expect(colorWithoutTool.dotColor).toBe('bg-red-500')
  })

  it('should return CYAN for MCP PostToolUseFailure', () => {
    // resolveEventKey returns '_MCP', and our mock registry maps
    // '_MCP' → CYAN (not RED, since in the real code the per-phase
    // failure fallback happens inside event-icon-registry, not here)
    const color = getEventColor('PostToolUseFailure', 'mcp__browser__click')
    expect(color.iconColor).toBe('text-cyan-500')
  })

  it('should resolve colors for all known subtypes', () => {
    const tests: Array<[string, string | null, string | undefined, string]> = [
      ['SessionStart', null, undefined, 'yellow'],
      ['UserPromptSubmit', null, undefined, 'green'],
      ['Stop', null, undefined, 'yellow'],
      ['LLMGeneration', null, undefined, 'blue'],
      ['SubagentStart', null, undefined, 'purple'],
      ['PreCompact', null, undefined, 'gray'],
      ['PostToolUseFailure', null, undefined, 'red'],
    ]
    for (const [subtype, toolName, _unused, expectedColor] of tests) {
      const color = getEventColor(subtype, toolName)
      expect(color.iconColor, `Wrong iconColor for ${subtype}`).toContain(expectedColor)
    }
  })
})

describe('eventIcons and eventColors coverage', () => {
  it('should have eventIcons entries for SubagentStart', () => {
    expect(eventIcons['SubagentStart']).toBeDefined()
    expect(eventColors['SubagentStart']).toBeDefined()
  })

  it('should have eventIcons entries for _MCP', () => {
    expect(eventIcons['_MCP']).toBeDefined()
    expect(eventColors['_MCP']).toBeDefined()
  })
})
