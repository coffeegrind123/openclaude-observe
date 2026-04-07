import { lazy } from 'react'
import type { LucideIcon } from 'lucide-react'
import dynamicIconImports from 'lucide-react/dynamicIconImports'
import { resolveIconName } from '@/lib/dynamic-icon'
import {
  Rocket,
  Flag,
  CircleStop,
  Bomb,
  MessageSquare,
  MessageSquareReply,
  Wrench,
  Zap,
  BookOpen,
  Pencil,
  FilePen,
  Bot,
  Search,
  SearchCode,
  Globe,
  CircleCheck,
  CircleX,
  Moon,
  ClipboardList,
  Lock,
  Bell,
  FileText,
  Settings,
  FolderOpen,
  Minimize,
  CircleHelp,
  GitBranch,
  Trash,
  Hourglass,
  User,
  Pin,
} from 'lucide-react'
import { getIconCustomization, COLOR_PRESETS } from '@/hooks/use-icon-customizations'

// Cache lazy-loaded icon components so we don't create new ones on every render
const lazyIconCache = new Map<string, LucideIcon>()

export const eventIcons: Record<string, LucideIcon> = {
  // Session lifecycle
  SessionStart: Rocket,
  SessionEnd: Flag,
  Stop: CircleStop,
  StopFailure: Bomb,

  // User input
  UserPromptSubmit: MessageSquare,
  UserPromptSubmitResponse: MessageSquareReply,

  // Tool use — logical keys by tool name
  Bash: Zap,
  Read: BookOpen,
  Write: Pencil,
  Edit: FilePen,
  Agent: Bot,
  Glob: Search,
  Grep: SearchCode,
  WebSearch: Globe,
  WebFetch: Globe,

  // Generic tool fallbacks
  _ToolDefault: Wrench,
  _ToolSuccess: CircleCheck,
  _ToolFailure: CircleX,

  // Agents & teams
  SubagentStart: Bot,
  SubagentStop: Bot,
  TeammateIdle: Moon,

  // Tasks
  TaskCreated: ClipboardList,
  TaskCompleted: CircleCheck,

  // Permissions
  PermissionRequest: Lock,

  // Notifications
  Notification: Bell,

  // Config & files
  InstructionsLoaded: FileText,
  ConfigChange: Settings,
  CwdChanged: FolderOpen,
  FileChanged: FilePen,

  // Compaction
  PreCompact: Minimize,
  PostCompact: Minimize,

  // MCP
  Elicitation: CircleHelp,
  ElicitationResult: MessageSquare,

  // Worktrees
  WorktreeCreate: GitBranch,
  WorktreeRemove: Trash,

  // Legacy / transcript format
  progress: Hourglass,
  agent_progress: Bot,
  system: Settings,
  stop_hook_summary: CircleStop,
  user: User,
  assistant: Bot,
}

export const defaultEventIcon: LucideIcon = Pin

// Color classes for event icons: [stream icon color, solid bg for timeline dots]
// Using semantic colors to group related event types
export const eventColors: Record<string, [string, string]> = {
  // Session lifecycle — yellow
  SessionStart: ['text-yellow-600 dark:text-yellow-400', 'bg-yellow-600 dark:bg-yellow-500'],
  SessionEnd: ['text-yellow-600 dark:text-yellow-400', 'bg-yellow-600 dark:bg-yellow-500'],
  Stop: ['text-yellow-600 dark:text-yellow-400', 'bg-yellow-600 dark:bg-yellow-500'],
  StopFailure: ['text-red-600 dark:text-red-400', 'bg-red-600 dark:bg-red-500'],
  stop_hook_summary: ['text-yellow-600 dark:text-yellow-400', 'bg-yellow-600 dark:bg-yellow-500'],

  // User input — green
  UserPromptSubmit: ['text-green-600 dark:text-green-400', 'bg-green-600 dark:bg-green-500'],
  UserPromptSubmitResponse: [
    'text-green-600 dark:text-green-400',
    'bg-green-600 dark:bg-green-500',
  ],
  user: ['text-green-600 dark:text-green-400', 'bg-green-600 dark:bg-green-500'],

  // Tool use — blue (by tool name)
  Bash: ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  Read: ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  Write: ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  Edit: ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  Glob: ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  Grep: ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  WebSearch: ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  WebFetch: ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],

  // Generic tool fallbacks
  _ToolDefault: ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  _ToolSuccess: ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  _ToolFailure: ['text-red-600 dark:text-red-400', 'bg-red-600 dark:bg-red-500'],

  // Agents — purple
  Agent: ['text-purple-600 dark:text-purple-400', 'bg-purple-600 dark:bg-purple-500'],
  SubagentStart: ['text-purple-600 dark:text-purple-400', 'bg-purple-600 dark:bg-purple-500'],
  SubagentStop: ['text-purple-600 dark:text-purple-400', 'bg-purple-600 dark:bg-purple-500'],
  TeammateIdle: ['text-purple-600 dark:text-purple-400', 'bg-purple-600 dark:bg-purple-500'],
  assistant: ['text-purple-600 dark:text-purple-400', 'bg-purple-600 dark:bg-purple-500'],
  agent_progress: ['text-purple-600 dark:text-purple-400', 'bg-purple-600 dark:bg-purple-500'],

  // Tasks — cyan
  TaskCreated: ['text-cyan-600 dark:text-cyan-400', 'bg-cyan-600 dark:bg-cyan-500'],
  TaskCompleted: ['text-cyan-600 dark:text-cyan-400', 'bg-cyan-600 dark:bg-cyan-500'],

  // Permissions — rose
  PermissionRequest: ['text-rose-600 dark:text-rose-400', 'bg-rose-600 dark:bg-rose-500'],

  // Notifications — sky
  Notification: ['text-sky-600 dark:text-sky-400', 'bg-sky-600 dark:bg-sky-500'],

  // Config & files — slate/gray
  InstructionsLoaded: ['text-slate-600 dark:text-slate-400', 'bg-slate-600 dark:bg-slate-500'],
  ConfigChange: ['text-slate-600 dark:text-slate-400', 'bg-slate-600 dark:bg-slate-500'],
  CwdChanged: ['text-slate-600 dark:text-slate-400', 'bg-slate-600 dark:bg-slate-500'],
  FileChanged: ['text-slate-600 dark:text-slate-400', 'bg-slate-600 dark:bg-slate-500'],
  system: ['text-slate-600 dark:text-slate-400', 'bg-slate-600 dark:bg-slate-500'],

  // Compaction — gray
  PreCompact: ['text-gray-500 dark:text-gray-400', 'bg-gray-500 dark:bg-gray-400'],
  PostCompact: ['text-gray-500 dark:text-gray-400', 'bg-gray-500 dark:bg-gray-400'],

  // MCP — indigo
  Elicitation: ['text-indigo-600 dark:text-indigo-400', 'bg-indigo-600 dark:bg-indigo-500'],
  ElicitationResult: ['text-indigo-600 dark:text-indigo-400', 'bg-indigo-600 dark:bg-indigo-500'],

  // Worktrees — teal
  WorktreeCreate: ['text-teal-600 dark:text-teal-400', 'bg-teal-600 dark:bg-teal-500'],
  WorktreeRemove: ['text-teal-600 dark:text-teal-400', 'bg-teal-600 dark:bg-teal-500'],

  // Progress — amber
  progress: ['text-amber-600 dark:text-amber-400', 'bg-amber-600 dark:bg-amber-500'],
}

const defaultEventColor: [string, string] = [
  'text-muted-foreground',
  'bg-muted-foreground dark:bg-muted-foreground',
]

/**
 * Resolve an event to its logical icon/color key.
 * Tool events resolve by toolName (e.g., "Bash", "Edit").
 * Non-tool events resolve by subtype (e.g., "SessionStart").
 */
export function resolveEventKey(subtype: string | null, toolName?: string | null): string {
  const isTool =
    subtype === 'PreToolUse' || subtype === 'PostToolUse' || subtype === 'PostToolUseFailure'
  if (isTool && toolName) return toolName
  return subtype || 'unknown'
}

/**
 * Determine the tool fallback key based on the event subtype.
 */
function toolFallbackKey(subtype: string | null): string {
  if (subtype === 'PostToolUseFailure') return '_ToolFailure'
  if (subtype === 'PostToolUse') return '_ToolSuccess'
  return '_ToolDefault'
}

export function getEventColor(
  subtype: string | null,
  toolName?: string | null,
): { iconColor: string; dotColor: string; customHex?: string } {
  const key = resolveEventKey(subtype, toolName)
  const isTool =
    subtype === 'PreToolUse' || subtype === 'PostToolUse' || subtype === 'PostToolUseFailure'

  // Check user customizations first
  const custom = getIconCustomization(key)
  if (custom?.colorName === 'custom' && custom.customHex) {
    return { iconColor: '', dotColor: '', customHex: custom.customHex }
  }
  if (custom?.colorName && COLOR_PRESETS[custom.colorName]) {
    const preset = COLOR_PRESETS[custom.colorName]
    return { iconColor: preset.iconColor, dotColor: preset.dotColor }
  }

  // Fall back to defaults
  let color = eventColors[key]
  if (!color && isTool) {
    color = eventColors[toolFallbackKey(subtype)]
  }
  const [iconColor, dotColor] = color || defaultEventColor
  return { iconColor, dotColor }
}

export function getEventIcon(subtype: string | null, toolName?: string | null): LucideIcon {
  const key = resolveEventKey(subtype, toolName)
  const isTool =
    subtype === 'PreToolUse' || subtype === 'PostToolUse' || subtype === 'PostToolUseFailure'

  // Check user customizations first
  const custom = getIconCustomization(key)
  if (custom?.iconName) {
    const resolved = resolveIconName(custom.iconName)
    if (resolved) {
      if (!lazyIconCache.has(resolved)) {
        lazyIconCache.set(resolved, lazy(dynamicIconImports[resolved]) as unknown as LucideIcon)
      }
      return lazyIconCache.get(resolved)!
    }
  }

  // Fall back to defaults
  if (eventIcons[key]) {
    return eventIcons[key]
  }
  if (isTool) {
    return eventIcons[toolFallbackKey(subtype)] || defaultEventIcon
  }
  return defaultEventIcon
}
