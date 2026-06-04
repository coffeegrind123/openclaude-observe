import { lazy } from 'react'
import type { LucideIcon } from 'lucide-react'
import dynamicIconImports from 'lucide-react/dynamicIconImports'
import { resolveIconName } from '@/lib/dynamic-icon'
import {
  resolveEventIcon as registryIconName,
  resolveEventColor as registryColor,
  EVENT_ICON_REGISTRY,
  DEFAULT_ICON as REGISTRY_DEFAULT_ICON_NAME,
} from '@/lib/event-icon-registry'
import { getIconCustomization, COLOR_PRESETS } from '@/hooks/use-icon-customizations'

// Cache lazy-loaded icon components so we don't create new ones on every render
const lazyIconCache = new Map<string, LucideIcon>()

function resolveIconComponent(iconName: string): LucideIcon | null {
  const resolved = resolveIconName(iconName)
  if (!resolved) return null
  if (!lazyIconCache.has(resolved)) {
    lazyIconCache.set(resolved, lazy(dynamicIconImports[resolved]) as unknown as LucideIcon)
  }
  return lazyIconCache.get(resolved)!
}

// ---------------------------------------------------------------------------
// Build lookups from the registry (for settings UI compatibility)
// ---------------------------------------------------------------------------

/**
 * Default-icons map: key → LucideIcon component.
 * Derived from the registry for backward compatibility with settings UI.
 */
export const eventIcons: Record<string, LucideIcon> = {}
for (const entry of EVENT_ICON_REGISTRY) {
  const component = resolveIconComponent(entry.icon)
  if (component && !eventIcons[entry.id]) {
    eventIcons[entry.id] = component
  }
}

/**
 * Default-colors map: key → [iconColor, dotColor].
 * Derived from the registry for backward compatibility with settings UI.
 */
export const eventColors: Record<string, [string, string]> = {}
for (const entry of EVENT_ICON_REGISTRY) {
  const preset = registryColor(entry.id)
  if (!eventColors[entry.id]) {
    eventColors[entry.id] = [preset.iconColor, preset.dotColor]
  }
}

/** Fallback icon for settings UI. */
export const defaultEventIcon: LucideIcon =
  resolveIconComponent(REGISTRY_DEFAULT_ICON_NAME) ??
  (lazy(dynamicIconImports['pin']) as unknown as LucideIcon)

// ---------------------------------------------------------------------------
// Key resolver (our format: bare tool names, e.g. "Bash", "_MCP")
// ---------------------------------------------------------------------------

/**
 * Resolve an event to its logical icon/color key.
 * Tool events resolve by toolName (e.g., "Bash", "Edit").
 * Non-tool events resolve by subtype (e.g., "SessionStart").
 */
export function resolveEventKey(subtype: string | null, toolName?: string | null): string {
  const isTool =
    subtype === 'PreToolUse' || subtype === 'PostToolUse' || subtype === 'PostToolUseFailure'
  if (isTool && toolName) {
    // MCP tools share the _MCP icon/color; individual tool names can still be customized
    if (toolName.startsWith('mcp__')) return '_MCP'
    return toolName
  }
  return subtype || 'unknown'
}

// ---------------------------------------------------------------------------
// Icon / color resolvers
// ---------------------------------------------------------------------------

/**
 * Resolve the LucideIcon for an event, applying user customizations first,
 * then falling back to the centralized registry.
 */
export function getEventIcon(subtype: string | null, toolName?: string | null): LucideIcon {
  const key = resolveEventKey(subtype, toolName)

  // 1. User customization
  const custom = getIconCustomization(key)
  if (custom?.iconName) {
    const component = resolveIconComponent(custom.iconName)
    if (component) return component
  }

  // 2. Registry default
  const iconName = registryIconName(key)
  const component = resolveIconComponent(iconName)
  if (component) return component

  // 3. Ultimate fallback
  return (
    resolveIconComponent(REGISTRY_DEFAULT_ICON_NAME) ??
    (lazy(dynamicIconImports['pin']) as unknown as LucideIcon)
  )
}

/**
 * Resolve the color classes for an event, applying user customizations first,
 * then falling back to the centralized registry.
 */
export function getEventColor(
  subtype: string | null,
  toolName?: string | null,
): { iconColor: string; dotColor: string; customHex?: string } {
  const key = resolveEventKey(subtype, toolName)

  // 1. User customization
  const custom = getIconCustomization(key)
  if (custom?.colorName === 'custom' && custom.customHex) {
    return { iconColor: '', dotColor: '', customHex: custom.customHex }
  }
  if (custom?.colorName && COLOR_PRESETS[custom.colorName]) {
    const preset = COLOR_PRESETS[custom.colorName]
    return { iconColor: preset.iconColor, dotColor: preset.dotColor }
  }

  // 2. Registry default
  const color = registryColor(key)
  return { iconColor: color.iconColor, dotColor: color.dotColor }
}
