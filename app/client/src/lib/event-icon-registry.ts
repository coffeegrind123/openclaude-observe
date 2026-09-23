/**
 * Centralized event icon and color registry.
 *
 * Keys are icon ids chosen by the event's agent class (`AgentClass.iconId`):
 *   - pi tools by name (`read`, `bash`, `Agent`, `mcp`, …), `browser` for
 *     every pi-mcp-adapter `browser_*` direct tool
 *   - non-tool events by hook name (`LLMGeneration`, `Stop`, …), with a few
 *     variants (`LLMGenerationError`, `CustomMessage:subagent-result`,
 *     `UserPromptSubmit:extension`)
 *   - generic fallbacks (`PreToolUse`, `PostToolUse`, `PostToolUseFailure`,
 *     `Default`) for tools and events no class recognises
 *
 * The registry decouples metadata (icon name, color, label, group) from the
 * React rendering layer.  Actual `<LucideIcon>` resolution happens via
 * `@/lib/dynamic-icon` at the call site.
 */

// ---------------------------------------------------------------------------
// Color Presets
// ---------------------------------------------------------------------------

export interface ColorPreset {
  /** Tailwind class for the stream icon (e.g. `text-blue-600 dark:text-blue-400`) */
  readonly iconColor: string
  /** Tailwind class for solid backgrounds / timeline dots */
  readonly dotColor: string
  /** Hex swatch for colour-picker UI (e.g. `#2563eb`) */
  readonly swatch: string
}

export const RED: ColorPreset = {
  iconColor: 'text-red-600 dark:text-red-400',
  dotColor: 'bg-red-600 dark:bg-red-500',
  swatch: '#dc2626',
}

export const ORANGE: ColorPreset = {
  iconColor: 'text-orange-600 dark:text-orange-400',
  dotColor: 'bg-orange-600 dark:bg-orange-500',
  swatch: '#ea580c',
}

export const AMBER: ColorPreset = {
  iconColor: 'text-amber-600 dark:text-amber-400',
  dotColor: 'bg-amber-600 dark:bg-amber-500',
  swatch: '#d97706',
}

export const YELLOW: ColorPreset = {
  iconColor: 'text-yellow-600 dark:text-yellow-400',
  dotColor: 'bg-yellow-600 dark:bg-yellow-500',
  swatch: '#ca8a04',
}

export const LIME: ColorPreset = {
  iconColor: 'text-lime-600 dark:text-lime-400',
  dotColor: 'bg-lime-600 dark:bg-lime-500',
  swatch: '#65a30d',
}

export const GREEN: ColorPreset = {
  iconColor: 'text-green-600 dark:text-green-400',
  dotColor: 'bg-green-600 dark:bg-green-500',
  swatch: '#16a34a',
}

export const EMERALD: ColorPreset = {
  iconColor: 'text-emerald-600 dark:text-emerald-400',
  dotColor: 'bg-emerald-600 dark:bg-emerald-500',
  swatch: '#059669',
}

export const TEAL: ColorPreset = {
  iconColor: 'text-teal-600 dark:text-teal-400',
  dotColor: 'bg-teal-600 dark:bg-teal-500',
  swatch: '#0d9488',
}

export const CYAN: ColorPreset = {
  iconColor: 'text-cyan-600 dark:text-cyan-400',
  dotColor: 'bg-cyan-600 dark:bg-cyan-500',
  swatch: '#0891b2',
}

export const SKY: ColorPreset = {
  iconColor: 'text-sky-600 dark:text-sky-400',
  dotColor: 'bg-sky-600 dark:bg-sky-500',
  swatch: '#0284c7',
}

export const BLUE: ColorPreset = {
  iconColor: 'text-blue-600 dark:text-blue-400',
  dotColor: 'bg-blue-600 dark:bg-blue-500',
  swatch: '#2563eb',
}

export const INDIGO: ColorPreset = {
  iconColor: 'text-indigo-600 dark:text-indigo-400',
  dotColor: 'bg-indigo-600 dark:bg-indigo-500',
  swatch: '#4f46e5',
}

export const VIOLET: ColorPreset = {
  iconColor: 'text-violet-600 dark:text-violet-400',
  dotColor: 'bg-violet-600 dark:bg-violet-500',
  swatch: '#7c3aed',
}

export const PURPLE: ColorPreset = {
  iconColor: 'text-purple-600 dark:text-purple-400',
  dotColor: 'bg-purple-600 dark:bg-purple-500',
  swatch: '#9333ea',
}

export const FUCHSIA: ColorPreset = {
  iconColor: 'text-fuchsia-600 dark:text-fuchsia-400',
  dotColor: 'bg-fuchsia-600 dark:bg-fuchsia-500',
  swatch: '#c026d3',
}

export const PINK: ColorPreset = {
  iconColor: 'text-pink-600 dark:text-pink-400',
  dotColor: 'bg-pink-600 dark:bg-pink-500',
  swatch: '#db2777',
}

export const ROSE: ColorPreset = {
  iconColor: 'text-rose-600 dark:text-rose-400',
  dotColor: 'bg-rose-600 dark:bg-rose-500',
  swatch: '#e11d48',
}

export const SLATE: ColorPreset = {
  iconColor: 'text-slate-600 dark:text-slate-400',
  dotColor: 'bg-slate-600 dark:bg-slate-500',
  swatch: '#475569',
}

export const GRAY: ColorPreset = {
  iconColor: 'text-gray-500 dark:text-gray-400',
  dotColor: 'bg-gray-500 dark:bg-gray-400',
  swatch: '#6b7280',
}

/** All colour presets keyed by name for programmatic lookup. */
export const COLOR_PRESETS: Readonly<Record<string, ColorPreset>> = {
  RED,
  ORANGE,
  AMBER,
  YELLOW,
  LIME,
  GREEN,
  EMERALD,
  TEAL,
  CYAN,
  SKY,
  BLUE,
  INDIGO,
  VIOLET,
  PURPLE,
  FUCHSIA,
  PINK,
  ROSE,
  SLATE,
  GRAY,
} as const

/** Fallback colour used when no registry entry matches. */
export const DEFAULT_COLOR_PRESET: ColorPreset = GRAY

/** Name of the fallback colour key. */
export const DEFAULT_COLOR_KEY = 'GRAY'

// ---------------------------------------------------------------------------
// Registry entry
// ---------------------------------------------------------------------------

export interface EventIconEntry {
  /** Icon id — what `AgentClass.iconId` returns. */
  readonly id: string
  /** PascalCase lucide-react icon name (e.g. `'Zap'`, `'Rocket'`). */
  readonly icon: string
  /** Key into `COLOR_PRESETS`. */
  readonly defaultColor: string
  /** Human-readable label for settings UI. */
  readonly name: string
  /** Grouping category for settings UI. */
  readonly group: string
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const EVENT_ICON_REGISTRY: readonly EventIconEntry[] = [
  // ── Session ────────────────────────────────────────────────────────
  {
    id: 'SessionStart',
    icon: 'Rocket',
    defaultColor: 'YELLOW',
    name: 'Session Start',
    group: 'Session',
  },
  { id: 'SessionEnd', icon: 'Flag', defaultColor: 'YELLOW', name: 'Session End', group: 'Session' },
  {
    id: 'SessionRename',
    icon: 'PencilLine',
    defaultColor: 'YELLOW',
    name: 'Session Rename',
    group: 'Session',
  },
  {
    id: 'SessionTree',
    icon: 'GitFork',
    defaultColor: 'YELLOW',
    name: 'Tree Navigation',
    group: 'Session',
  },
  {
    id: 'SystemPrompt',
    icon: 'ScrollText',
    defaultColor: 'SLATE',
    name: 'System Prompt',
    group: 'Session',
  },
  {
    id: 'ModelChange',
    icon: 'Cpu',
    defaultColor: 'INDIGO',
    name: 'Model Change',
    group: 'Session',
  },
  {
    id: 'ThinkingLevelChange',
    icon: 'Gauge',
    defaultColor: 'INDIGO',
    name: 'Thinking Level',
    group: 'Session',
  },
  {
    id: 'Stop',
    icon: 'CircleStop',
    defaultColor: 'YELLOW',
    name: 'Stop (settled)',
    group: 'Session',
  },

  // ── User input ─────────────────────────────────────────────────────
  {
    id: 'UserPromptSubmit',
    icon: 'MessageSquare',
    defaultColor: 'GREEN',
    name: 'User Prompt',
    group: 'User Input',
  },
  {
    id: 'UserPromptSubmit:extension',
    icon: 'MessageSquareShare',
    defaultColor: 'AMBER',
    name: 'Injected Prompt',
    group: 'User Input',
  },
  {
    id: 'UserBash',
    icon: 'SquareTerminal',
    defaultColor: 'GREEN',
    name: 'User !bash',
    group: 'User Input',
  },

  // ── pi built-in tools ──────────────────────────────────────────────
  { id: 'read', icon: 'BookOpen', defaultColor: 'BLUE', name: 'read', group: 'Tools' },
  { id: 'bash', icon: 'Terminal', defaultColor: 'BLUE', name: 'bash', group: 'Tools' },
  { id: 'edit', icon: 'FilePen', defaultColor: 'BLUE', name: 'edit', group: 'Tools' },
  { id: 'write', icon: 'Pencil', defaultColor: 'BLUE', name: 'write', group: 'Tools' },
  { id: 'grep', icon: 'SearchCode', defaultColor: 'BLUE', name: 'grep', group: 'Tools' },
  { id: 'find', icon: 'Search', defaultColor: 'BLUE', name: 'find', group: 'Tools' },
  { id: 'ls', icon: 'FolderOpen', defaultColor: 'BLUE', name: 'ls', group: 'Tools' },
  { id: 'PreToolUse', icon: 'Wrench', defaultColor: 'BLUE', name: 'Other Tool', group: 'Tools' },
  {
    id: 'PostToolUse',
    icon: 'CircleCheck',
    defaultColor: 'BLUE',
    name: 'Tool Result',
    group: 'Tools',
  },
  {
    id: 'PostToolUseFailure',
    icon: 'CircleX',
    defaultColor: 'RED',
    name: 'Tool Failure',
    group: 'Tools',
  },

  // ── Subagents (pi-subagents-lite) ──────────────────────────────────
  { id: 'Agent', icon: 'Bot', defaultColor: 'PURPLE', name: 'Agent', group: 'Agents' },
  { id: 'SubAgent', icon: 'Bot', defaultColor: 'PURPLE', name: 'SubAgent', group: 'Agents' },
  { id: 'StopAgent', icon: 'OctagonX', defaultColor: 'PURPLE', name: 'StopAgent', group: 'Agents' },
  {
    id: 'AgentStatus',
    icon: 'ListChecks',
    defaultColor: 'PURPLE',
    name: 'AgentStatus',
    group: 'Agents',
  },
  {
    id: 'SubagentStart',
    icon: 'Bot',
    defaultColor: 'PURPLE',
    name: 'Subagent Start',
    group: 'Agents',
  },
  {
    id: 'SubagentStop',
    icon: 'BotOff',
    defaultColor: 'PURPLE',
    name: 'Subagent Stop',
    group: 'Agents',
  },
  {
    id: 'CustomMessage:subagent-result',
    icon: 'Inbox',
    defaultColor: 'PURPLE',
    name: 'Subagent Result',
    group: 'Agents',
  },

  // ── MCP (pi-mcp-adapter) ───────────────────────────────────────────
  { id: 'mcp', icon: 'Plug', defaultColor: 'CYAN', name: 'mcp', group: 'MCP' },
  { id: 'mcpScript', icon: 'FileCode', defaultColor: 'CYAN', name: 'mcpScript', group: 'MCP' },
  { id: 'browser', icon: 'Globe', defaultColor: 'CYAN', name: 'browser_* tools', group: 'MCP' },

  // ── LLM ────────────────────────────────────────────────────────────
  {
    id: 'LLMGeneration',
    icon: 'Brain',
    defaultColor: 'BLUE',
    name: 'LLM Generation',
    group: 'LLM',
  },
  {
    id: 'LLMGenerationError',
    icon: 'TriangleAlert',
    defaultColor: 'RED',
    name: 'LLM Error',
    group: 'LLM',
  },

  // ── Compaction ─────────────────────────────────────────────────────
  {
    id: 'PreCompact',
    icon: 'Minimize',
    defaultColor: 'GRAY',
    name: 'Pre-Compact',
    group: 'Compaction',
  },
  {
    id: 'PostCompact',
    icon: 'Minimize2',
    defaultColor: 'GRAY',
    name: 'Post-Compact',
    group: 'Compaction',
  },
  {
    id: 'CompactionFailed',
    icon: 'CircleAlert',
    defaultColor: 'RED',
    name: 'Compaction Failed',
    group: 'Compaction',
  },

  // ── System ─────────────────────────────────────────────────────────
  { id: 'Notification', icon: 'Bell', defaultColor: 'SKY', name: 'Notification', group: 'System' },
  {
    id: 'CustomMessage',
    icon: 'MessageSquareDot',
    defaultColor: 'SLATE',
    name: 'Custom Message',
    group: 'System',
  },
  { id: 'Default', icon: 'Pin', defaultColor: 'GRAY', name: 'Other Event', group: 'System' },
]

// ---------------------------------------------------------------------------
// Lookup (built once)
// ---------------------------------------------------------------------------

const _entryById = new Map<string, EventIconEntry>(EVENT_ICON_REGISTRY.map((e) => [e.id, e]))

/** The icon returned when no registry entry matches. */
export const DEFAULT_ICON = 'Pin'

export function hasIconEntry(id: string): boolean {
  return _entryById.has(id)
}

/** PascalCase icon name for `id`, or the fallback icon. */
export function resolveEventIcon(id: string): string {
  return _entryById.get(id)?.icon ?? DEFAULT_ICON
}

/** Colour preset for `id`, or the default colour. */
export function resolveEventColor(id: string): ColorPreset {
  const entry = _entryById.get(id)
  if (!entry) {
    return DEFAULT_COLOR_PRESET
  }
  return COLOR_PRESETS[entry.defaultColor] ?? DEFAULT_COLOR_PRESET
}

// ---------------------------------------------------------------------------
// Customisation-aware getters
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'observe-icon-customizations'

export interface IconCustomization {
  /** PascalCase lucide icon name (overrides registry default). */
  iconName?: string
  /** Key into `COLOR_PRESETS`, or `'custom'` when `customHex` is set. */
  colorName?: string
  /** Hex colour (e.g. `'#ff5500'`), only honoured when `colorName === 'custom'`. */
  customHex?: string
}

/** Read-only snapshot of all user customisations from localStorage. */
function readCustomizations(): Record<string, IconCustomization> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

/**
 * Return the PascalCase icon name for `key`, respecting user customisations
 * stored in localStorage.
 *
 * @param key             Event key (e.g. `'PreToolUse:Bash'`, `'SessionStart'`)
 * @param customizations  Optional pre-fetched customisation map (avoids
 *                        repeated localStorage reads in hot paths).
 */
export function getEventIcon(
  key: string,
  customizations?: Record<string, IconCustomization> | null,
): string {
  // 1. User customisation override
  const cust = customizations ?? readCustomizations()
  const override = cust[key]?.iconName
  if (override) return override

  // 2. Registry lookup (exact → generic fallback)
  return resolveEventIcon(key)
}

/**
 * Return the colour for `key`, respecting user customisations stored in
 * localStorage.
 *
 * @param key             Event key (e.g. `'PreToolUse:Bash'`, `'SessionStart'`)
 * @param customizations  Optional pre-fetched customisation map.
 * @returns An object with the resolved `ColorPreset` and an optional
 *          `customHex` when the user has picked a custom colour.
 */
export function getEventColor(
  key: string,
  customizations?: Record<string, IconCustomization> | null,
): { color: ColorPreset; customHex?: string } {
  // 1. User customisation override
  const cust = customizations ?? readCustomizations()
  const override = cust[key]
  if (override) {
    if (override.colorName === 'custom' && override.customHex) {
      return { color: DEFAULT_COLOR_PRESET, customHex: override.customHex }
    }
    if (override.colorName && COLOR_PRESETS[override.colorName]) {
      return { color: COLOR_PRESETS[override.colorName] }
    }
  }

  // 2. Registry lookup
  return { color: resolveEventColor(key) }
}
