import { createElement, forwardRef, lazy, Suspense } from 'react'
import type { LucideIcon, LucideProps } from 'lucide-react'
import dynamicIconImports from 'lucide-react/dynamicIconImports'
import { resolveIconName, toPascalCase } from '@/lib/dynamic-icon'
import {
  resolveEventIcon as registryIconName,
  resolveEventColor as registryColor,
  EVENT_ICON_REGISTRY,
  DEFAULT_ICON as REGISTRY_DEFAULT_ICON_NAME,
} from '@/lib/event-icon-registry'
import { getIconCustomization, COLOR_PRESETS } from '@/hooks/use-icon-customizations'
import { agentClassFor } from '@/agents/registry'
import type { Agent, ParsedEvent } from '@/types'

// Cache lazy-loaded icon components so we don't create new ones on every render
const lazyIconCache = new Map<string, LucideIcon>()

type IconName = keyof typeof dynamicIconImports

/**
 * Wrap a lazily-imported icon in its own Suspense boundary. Without it, a row
 * rendering an icon whose chunk hasn't loaded suspends up to the nearest
 * boundary, so whole event lists never commit until every icon chunk arrives.
 * The fallback reuses the icon's className/size so layout doesn't shift.
 * displayName carries the PascalCase name for the icon settings UI.
 */
function suspendedIcon(name: IconName): LucideIcon {
  const Lazy = lazy(dynamicIconImports[name])
  const Icon = forwardRef<SVGSVGElement, LucideProps>((props, ref) =>
    createElement(
      Suspense,
      {
        fallback: createElement('span', {
          'aria-hidden': true,
          className: props.className,
          style: { display: 'inline-block', width: props.size, height: props.size },
        }),
      },
      createElement(Lazy, { ...props, ref }),
    ),
  )
  Icon.displayName = toPascalCase(name)
  return Icon as LucideIcon
}

function resolveIconComponent(iconName: string): LucideIcon | null {
  const resolved = resolveIconName(iconName)
  if (!resolved) return null
  if (!lazyIconCache.has(resolved)) {
    lazyIconCache.set(resolved, suspendedIcon(resolved))
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
  resolveIconComponent(REGISTRY_DEFAULT_ICON_NAME) ?? suspendedIcon('pin')

// ---------------------------------------------------------------------------
// Icon / color resolvers
// ---------------------------------------------------------------------------

/** Icon id for an event, chosen by its agent class. */
export function eventIconId(event: ParsedEvent, agent?: Agent | null): string {
  return agentClassFor(event, agent).iconId(event)
}

/**
 * Resolve the LucideIcon for an icon id, applying user customizations first,
 * then falling back to the centralized registry.
 */
export function getEventIcon(iconId: string): LucideIcon {
  const custom = getIconCustomization(iconId)
  if (custom?.iconName) {
    const component = resolveIconComponent(custom.iconName)
    if (component) {
      return component
    }
  }

  const component = resolveIconComponent(registryIconName(iconId))
  if (component) {
    return component
  }

  return resolveIconComponent(REGISTRY_DEFAULT_ICON_NAME) ?? suspendedIcon('pin')
}

/**
 * Resolve the color classes for an icon id, applying user customizations
 * first, then falling back to the centralized registry.
 */
export function getEventColor(iconId: string): {
  iconColor: string
  dotColor: string
  customHex?: string
} {
  const custom = getIconCustomization(iconId)
  if (custom?.colorName === 'custom' && custom.customHex) {
    return { iconColor: '', dotColor: '', customHex: custom.customHex }
  }
  if (custom?.colorName && COLOR_PRESETS[custom.colorName]) {
    const preset = COLOR_PRESETS[custom.colorName]
    return { iconColor: preset.iconColor, dotColor: preset.dotColor }
  }

  const color = registryColor(iconId)
  return { iconColor: color.iconColor, dotColor: color.dotColor }
}
