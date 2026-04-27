/**
 * Centralized event icon and color registry.
 *
 * Adapted from the upstream `event-icon-registry.ts` (concept C.3 in the port plan).
 * Uses our event key format:
 *   - Tool events:  `PreToolUse:<toolName>`, `PostToolUse:<toolName>`,
 *                    `PostToolUseFailure:<toolName>`
 *   - Non-tool events: just the `subtype` (e.g., `LLMGeneration`, `Stop`)
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
  /** Lookup key — matches `resolveEventKey` output. */
  readonly id: string
  /** PascalCase lucide-react icon name (e.g. `'Zap'`, `'Rocket'`). */
  readonly icon: string
  /** Key into `COLOR_PRESETS`. */
  readonly defaultColor: string
  /** Human-readable label for settings UI. */
  readonly name: string
  /** Optional grouping category for settings UI. */
  readonly group?: string
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Centralised icon + colour registry for every known event type.
 *
 * Tool events use the format `Phase:ToolName` (e.g. `PreToolUse:Bash`).
 * Non-tool events use the subtype directly (e.g. `SessionStart`).
 */
export const EVENT_ICON_REGISTRY: readonly EventIconEntry[] = [
  // ── Session lifecycle ──────────────────────────────────────────────
  { id: 'SessionStart', icon: 'Rocket', defaultColor: 'YELLOW', name: 'Session Start', group: 'Session' },
  { id: 'SessionEnd', icon: 'Flag', defaultColor: 'YELLOW', name: 'Session End', group: 'Session' },
  { id: 'Startup', icon: 'Rocket', defaultColor: 'YELLOW', name: 'Startup', group: 'Session' },
  { id: 'Shutdown', icon: 'Flag', defaultColor: 'YELLOW', name: 'Shutdown', group: 'Session' },
  { id: 'Stop', icon: 'CircleStop', defaultColor: 'YELLOW', name: 'Stop', group: 'Session' },
  { id: 'StopFailure', icon: 'Bomb', defaultColor: 'RED', name: 'Stop Failure', group: 'Session' },

  // ── User input ─────────────────────────────────────────────────────
  { id: 'UserPromptSubmit', icon: 'MessageSquare', defaultColor: 'GREEN', name: 'User Prompt', group: 'User Input' },
  { id: 'UserPromptSubmitResponse', icon: 'MessageSquareReply', defaultColor: 'GREEN', name: 'Prompt Response', group: 'User Input' },
  { id: 'UserPromptEnd', icon: 'MessageSquare', defaultColor: 'GREEN', name: 'Prompt End', group: 'User Input' },

  // ── Tools — specific tool names ────────────────────────────────────
  { id: 'Bash', icon: 'Zap', defaultColor: 'BLUE', name: 'Bash', group: 'Tools' },
  { id: 'Read', icon: 'BookOpen', defaultColor: 'BLUE', name: 'Read', group: 'Tools' },
  { id: 'Write', icon: 'Pencil', defaultColor: 'BLUE', name: 'Write', group: 'Tools' },
  { id: 'Edit', icon: 'FilePen', defaultColor: 'BLUE', name: 'Edit', group: 'Tools' },
  { id: 'Glob', icon: 'Search', defaultColor: 'BLUE', name: 'Glob', group: 'Tools' },
  { id: 'Grep', icon: 'SearchCode', defaultColor: 'BLUE', name: 'Grep', group: 'Tools' },
  { id: 'WebSearch', icon: 'Globe', defaultColor: 'BLUE', name: 'Web Search', group: 'Tools' },
  { id: 'WebFetch', icon: 'Globe', defaultColor: 'BLUE', name: 'Web Fetch', group: 'Tools' },
  { id: 'Agent', icon: 'Bot', defaultColor: 'PURPLE', name: 'Agent', group: 'Tools' },

  // ── Tools — per-phase entries for common tool names ────────────────
  // PreToolUse
  { id: 'PreToolUse:Bash', icon: 'Zap', defaultColor: 'BLUE', name: 'Bash (Pre)', group: 'Tools' },
  { id: 'PreToolUse:Read', icon: 'BookOpen', defaultColor: 'BLUE', name: 'Read (Pre)', group: 'Tools' },
  { id: 'PreToolUse:Write', icon: 'Pencil', defaultColor: 'BLUE', name: 'Write (Pre)', group: 'Tools' },
  { id: 'PreToolUse:Edit', icon: 'FilePen', defaultColor: 'BLUE', name: 'Edit (Pre)', group: 'Tools' },
  { id: 'PreToolUse:Glob', icon: 'Search', defaultColor: 'BLUE', name: 'Glob (Pre)', group: 'Tools' },
  { id: 'PreToolUse:Grep', icon: 'SearchCode', defaultColor: 'BLUE', name: 'Grep (Pre)', group: 'Tools' },
  { id: 'PreToolUse:WebSearch', icon: 'Globe', defaultColor: 'BLUE', name: 'Web Search (Pre)', group: 'Tools' },
  { id: 'PreToolUse:WebFetch', icon: 'Globe', defaultColor: 'BLUE', name: 'Web Fetch (Pre)', group: 'Tools' },
  { id: 'PreToolUse:Agent', icon: 'Bot', defaultColor: 'PURPLE', name: 'Agent (Pre)', group: 'Tools' },
  { id: 'PreToolUse:Skill', icon: 'Wrench', defaultColor: 'BLUE', name: 'Skill (Pre)', group: 'Tools' },

  // PostToolUse
  { id: 'PostToolUse:Bash', icon: 'Zap', defaultColor: 'BLUE', name: 'Bash (Post)', group: 'Tools' },
  { id: 'PostToolUse:Read', icon: 'BookOpen', defaultColor: 'BLUE', name: 'Read (Post)', group: 'Tools' },
  { id: 'PostToolUse:Write', icon: 'Pencil', defaultColor: 'BLUE', name: 'Write (Post)', group: 'Tools' },
  { id: 'PostToolUse:Edit', icon: 'FilePen', defaultColor: 'BLUE', name: 'Edit (Post)', group: 'Tools' },
  { id: 'PostToolUse:Glob', icon: 'Search', defaultColor: 'BLUE', name: 'Glob (Post)', group: 'Tools' },
  { id: 'PostToolUse:Grep', icon: 'SearchCode', defaultColor: 'BLUE', name: 'Grep (Post)', group: 'Tools' },
  { id: 'PostToolUse:WebSearch', icon: 'Globe', defaultColor: 'BLUE', name: 'Web Search (Post)', group: 'Tools' },
  { id: 'PostToolUse:WebFetch', icon: 'Globe', defaultColor: 'BLUE', name: 'Web Fetch (Post)', group: 'Tools' },
  { id: 'PostToolUse:Agent', icon: 'Bot', defaultColor: 'PURPLE', name: 'Agent (Post)', group: 'Tools' },
  { id: 'PostToolUse:Skill', icon: 'Wrench', defaultColor: 'BLUE', name: 'Skill (Post)', group: 'Tools' },

  // PostToolUseFailure
  { id: 'PostToolUseFailure:Bash', icon: 'Zap', defaultColor: 'RED', name: 'Bash (Failure)', group: 'Tools' },
  { id: 'PostToolUseFailure:Read', icon: 'BookOpen', defaultColor: 'RED', name: 'Read (Failure)', group: 'Tools' },
  { id: 'PostToolUseFailure:Write', icon: 'Pencil', defaultColor: 'RED', name: 'Write (Failure)', group: 'Tools' },
  { id: 'PostToolUseFailure:Edit', icon: 'FilePen', defaultColor: 'RED', name: 'Edit (Failure)', group: 'Tools' },
  { id: 'PostToolUseFailure:Glob', icon: 'Search', defaultColor: 'RED', name: 'Glob (Failure)', group: 'Tools' },
  { id: 'PostToolUseFailure:Grep', icon: 'SearchCode', defaultColor: 'RED', name: 'Grep (Failure)', group: 'Tools' },
  { id: 'PostToolUseFailure:WebSearch', icon: 'Globe', defaultColor: 'RED', name: 'Web Search (Failure)', group: 'Tools' },
  { id: 'PostToolUseFailure:WebFetch', icon: 'Globe', defaultColor: 'RED', name: 'Web Fetch (Failure)', group: 'Tools' },
  { id: 'PostToolUseFailure:Agent', icon: 'Bot', defaultColor: 'RED', name: 'Agent (Failure)', group: 'Tools' },
  { id: 'PostToolUseFailure:Skill', icon: 'Wrench', defaultColor: 'RED', name: 'Skill (Failure)', group: 'Tools' },

  // ── Tools — generic / fallback tool entries ────────────────────────
  { id: 'PreToolUse', icon: 'Wrench', defaultColor: 'BLUE', name: 'Tool Use', group: 'Tools' },
  { id: 'PostToolUse', icon: 'CircleCheck', defaultColor: 'BLUE', name: 'Tool Success', group: 'Tools' },
  { id: 'PostToolUseFailure', icon: 'CircleX', defaultColor: 'RED', name: 'Tool Failure', group: 'Tools' },

  // ── MCP tools ──────────────────────────────────────────────────────
  { id: '_MCP', icon: 'Plug', defaultColor: 'CYAN', name: 'MCP Tool', group: 'MCP' },
  { id: 'PreToolUse:_MCP', icon: 'Plug', defaultColor: 'CYAN', name: 'MCP Tool (Pre)', group: 'MCP' },
  { id: 'PostToolUse:_MCP', icon: 'Plug', defaultColor: 'CYAN', name: 'MCP Tool (Post)', group: 'MCP' },
  { id: 'PostToolUseFailure:_MCP', icon: 'Plug', defaultColor: 'RED', name: 'MCP Tool (Failure)', group: 'MCP' },

  // ── Agents ─────────────────────────────────────────────────────────
  { id: 'SubagentStart', icon: 'Bot', defaultColor: 'PURPLE', name: 'Subagent Start', group: 'Agents' },
  { id: 'SubagentStop', icon: 'Bot', defaultColor: 'PURPLE', name: 'Subagent Stop', group: 'Agents' },
  { id: 'TeammateIdle', icon: 'Moon', defaultColor: 'PURPLE', name: 'Teammate Idle', group: 'Agents' },

  // ── Tasks ──────────────────────────────────────────────────────────
  { id: 'TaskCreated', icon: 'ClipboardList', defaultColor: 'CYAN', name: 'Task Created', group: 'Tasks' },
  { id: 'TaskCompleted', icon: 'CircleCheck', defaultColor: 'CYAN', name: 'Task Completed', group: 'Tasks' },

  // ── Permissions ────────────────────────────────────────────────────
  { id: 'PermissionRequest', icon: 'Lock', defaultColor: 'ROSE', name: 'Permission Request', group: 'Permissions' },
  { id: 'PermissionDenied', icon: 'ShieldOff', defaultColor: 'RED', name: 'Permission Denied', group: 'Permissions' },

  // ── Notifications ──────────────────────────────────────────────────
  { id: 'Notification', icon: 'Bell', defaultColor: 'SKY', name: 'Notification', group: 'System' },

  // ── System / config ────────────────────────────────────────────────
  { id: 'Message', icon: 'MessageSquare', defaultColor: 'SLATE', name: 'Message', group: 'System' },
  { id: 'Error', icon: 'CircleX', defaultColor: 'RED', name: 'Error', group: 'System' },
  { id: 'Config', icon: 'Settings', defaultColor: 'SLATE', name: 'Config', group: 'System' },
  { id: 'Metrics', icon: 'Layers', defaultColor: 'SLATE', name: 'Metrics', group: 'System' },
  { id: 'InstructionsLoaded', icon: 'FileText', defaultColor: 'SLATE', name: 'Instructions Loaded', group: 'System' },
  { id: 'ConfigChange', icon: 'Settings', defaultColor: 'SLATE', name: 'Config Change', group: 'System' },
  { id: 'CwdChanged', icon: 'FolderOpen', defaultColor: 'SLATE', name: 'CWD Changed', group: 'System' },
  { id: 'FileChanged', icon: 'FilePen', defaultColor: 'SLATE', name: 'File Changed', group: 'System' },

  // ── Compaction ─────────────────────────────────────────────────────
  { id: 'PreCompact', icon: 'Minimize', defaultColor: 'GRAY', name: 'Pre-Compact', group: 'Compaction' },
  { id: 'PostCompact', icon: 'Minimize', defaultColor: 'GRAY', name: 'Post-Compact', group: 'Compaction' },
  { id: 'CompactionBoundary', icon: 'Minimize2', defaultColor: 'GRAY', name: 'Compaction Boundary', group: 'Compaction' },

  // ── MCP ────────────────────────────────────────────────────────────
  { id: 'Elicitation', icon: 'CircleHelp', defaultColor: 'INDIGO', name: 'Elicitation', group: 'MCP' },
  { id: 'ElicitationResult', icon: 'MessageSquare', defaultColor: 'INDIGO', name: 'Elicitation Result', group: 'MCP' },

  // ── Worktrees ──────────────────────────────────────────────────────
  { id: 'WorktreeCreate', icon: 'GitBranch', defaultColor: 'TEAL', name: 'Worktree Create', group: 'Worktrees' },
  { id: 'WorktreeRemove', icon: 'Trash', defaultColor: 'TEAL', name: 'Worktree Remove', group: 'Worktrees' },

  // ── LLM & cost ─────────────────────────────────────────────────────
  { id: 'LLMGeneration', icon: 'Brain', defaultColor: 'BLUE', name: 'LLM Generation', group: 'LLM' },
  { id: 'CompactionRun', icon: 'Minimize2', defaultColor: 'GRAY', name: 'Compaction Run', group: 'LLM' },
  { id: 'CostUpdate', icon: 'DollarSign', defaultColor: 'GREEN', name: 'Cost Update', group: 'LLM' },
  { id: 'ToolBatch', icon: 'Layers', defaultColor: 'BLUE', name: 'Tool Batch', group: 'LLM' },

  // ── Daemon ─────────────────────────────────────────────────────────
  { id: 'DaemonStart', icon: 'Server', defaultColor: 'ORANGE', name: 'Daemon Start', group: 'Daemon' },
  { id: 'DaemonStop', icon: 'Server', defaultColor: 'RED', name: 'Daemon Stop', group: 'Daemon' },
  { id: 'DaemonHeartbeat', icon: 'Heart', defaultColor: 'ORANGE', name: 'Daemon Heartbeat', group: 'Daemon' },

  // ── Pipes ──────────────────────────────────────────────────────────
  { id: 'PipeRoleAssigned', icon: 'Network', defaultColor: 'TEAL', name: 'Role Assigned', group: 'Pipes' },
  { id: 'PipeAttach', icon: 'Link', defaultColor: 'TEAL', name: 'Pipe Attach', group: 'Pipes' },
  { id: 'PipeDetach', icon: 'Unlink', defaultColor: 'TEAL', name: 'Pipe Detach', group: 'Pipes' },
  { id: 'PipePromptRouted', icon: 'Send', defaultColor: 'TEAL', name: 'Prompt Routed', group: 'Pipes' },
  { id: 'PipePermissionForward', icon: 'ShieldCheck', defaultColor: 'TEAL', name: 'Permission Forward', group: 'Pipes' },
  { id: 'PipeLanPeerDiscovered', icon: 'Wifi', defaultColor: 'TEAL', name: 'LAN Peer Discovered', group: 'Pipes' },

  // ── Coordinator ────────────────────────────────────────────────────
  { id: 'CoordinatorDispatch', icon: 'GitBranch', defaultColor: 'PURPLE', name: 'Dispatch', group: 'Coordinator' },
  { id: 'CoordinatorResult', icon: 'GitMerge', defaultColor: 'PURPLE', name: 'Result', group: 'Coordinator' },

  // ── Bridge ─────────────────────────────────────────────────────────
  { id: 'BridgeConnected', icon: 'Globe', defaultColor: 'CYAN', name: 'Connected', group: 'Bridge' },
  { id: 'BridgeDisconnected', icon: 'Globe', defaultColor: 'RED', name: 'Disconnected', group: 'Bridge' },
  { id: 'BridgeWorkReceived', icon: 'Download', defaultColor: 'CYAN', name: 'Work Received', group: 'Bridge' },

  // ── Super mode ─────────────────────────────────────────────────────
  { id: 'SuperModeToggle', icon: 'Shield', defaultColor: 'YELLOW', name: 'Super Mode Toggle', group: 'System' },

  // ── Legacy / transcript format ─────────────────────────────────────
  { id: 'progress', icon: 'Hourglass', defaultColor: 'AMBER', name: 'Progress', group: 'Legacy' },
  { id: 'agent_progress', icon: 'Bot', defaultColor: 'PURPLE', name: 'Agent Progress', group: 'Legacy' },
  { id: 'system', icon: 'Settings', defaultColor: 'SLATE', name: 'System', group: 'Legacy' },
  { id: 'stop_hook_summary', icon: 'CircleStop', defaultColor: 'YELLOW', name: 'Stop Hook Summary', group: 'Legacy' },
  { id: 'user', icon: 'User', defaultColor: 'GREEN', name: 'User', group: 'Legacy' },
  { id: 'assistant', icon: 'Bot', defaultColor: 'PURPLE', name: 'Assistant', group: 'Legacy' },
]

// ---------------------------------------------------------------------------
// Private lookup map (built once)
// ---------------------------------------------------------------------------

const _entryById = new Map<string, EventIconEntry>(
  EVENT_ICON_REGISTRY.map((e) => [e.id, e]),
)

// ---------------------------------------------------------------------------
// Resolve functions
// ---------------------------------------------------------------------------

/**
 * Return the PascalCase icon name for `key`, or the fallback icon if the key
 * is not registered.
 *
 * For tool keys (`PreToolUse:Bash`, etc.) the function first tries the exact
 * key, then strips the tool name and tries the generic phase key (e.g.
 * `PreToolUse`), and finally returns the global fallback.
 */
export function resolveEventIcon(key: string): string {
  const entry = _entryById.get(key)
  if (entry) return entry.icon

  // Tool-key fallback chain for "Phase:ToolName":
  //   1. Try "Phase:_MCP" if toolName starts with "mcp__"
  //   2. Try generic Phase key (e.g. "PreToolUse")
  const colon = key.indexOf(':')
  if (colon !== -1) {
    const phase = key.slice(0, colon)
    const toolName = key.slice(colon + 1)

    // MCP tools share the _MCP key
    if (toolName.startsWith('mcp__')) {
      const mcpKey = `${phase}:_MCP`
      const mcpEntry = _entryById.get(mcpKey)
      if (mcpEntry) return mcpEntry.icon
    }

    // Generic phase fallback (e.g. "PreToolUse" → Wrench)
    const generic = _entryById.get(phase)
    if (generic) return generic.icon
  }

  return DEFAULT_ICON
}

/** The icon returned when no registry entry or fallback matches. */
export const DEFAULT_ICON = 'Pin'

/**
 * Return the `ColorPreset` for `key`, or the default colour if the key is
 * not registered.
 *
 * Fallback strategy mirrors `resolveEventIcon`.
 */
export function resolveEventColor(key: string): ColorPreset {
  const entry = _entryById.get(key)
  if (entry) return COLOR_PRESETS[entry.defaultColor] ?? DEFAULT_COLOR_PRESET

  // Tool-key fallback chain (mirrors resolveEventIcon)
  const colon = key.indexOf(':')
  if (colon !== -1) {
    const phase = key.slice(0, colon)
    const toolName = key.slice(colon + 1)

    // MCP tools share the _MCP key
    if (toolName.startsWith('mcp__')) {
      const mcpKey = `${phase}:_MCP`
      const mcpEntry = _entryById.get(mcpKey)
      if (mcpEntry) return COLOR_PRESETS[mcpEntry.defaultColor] ?? DEFAULT_COLOR_PRESET
    }

    // Generic phase fallback
    const generic = _entryById.get(phase)
    if (generic) return COLOR_PRESETS[generic.defaultColor] ?? DEFAULT_COLOR_PRESET
  }

  return DEFAULT_COLOR_PRESET
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a lookup key from an event subtype and optional tool name.
 *
 * Tool events include the tool name after a colon:
 *   `PreToolUse` + `Bash`  →  `PreToolUse:Bash`
 *
 * Non-tool events use the subtype as-is:
 *   `LLMGeneration`  →  `LLMGeneration`
 *
 * MCP tools (prefixed `mcp__`) are collapsed to the shared `_MCP` key.
 */
export function resolveEventKey(subtype: string | null, toolName?: string | null): string {
  if (!subtype) return 'unknown'

  const isTool =
    subtype === 'PreToolUse' || subtype === 'PostToolUse' || subtype === 'PostToolUseFailure'

  if (isTool && toolName) {
    // Collapse all MCP tools to the shared _MCP key
    if (toolName.startsWith('mcp__')) return `${subtype}:_MCP`
    return `${subtype}:${toolName}`
  }

  return subtype
}
