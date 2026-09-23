import { useState, useMemo } from 'react'
import type { LucideIcon } from 'lucide-react'
import { DynamicIcon, resolveIconName } from '@/lib/dynamic-icon'
import { eventIcons, eventColors, defaultEventIcon } from '@/config/event-icons'
import { EVENT_ICON_REGISTRY } from '@/lib/event-icon-registry'
import { useIconCustomizations, COLOR_PRESETS } from '@/hooks/use-icon-customizations'
import { IconPicker } from './icon-picker'
import { ColorPicker } from './color-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'

// Determine default color key for each event type by matching its CSS classes
// against our COLOR_PRESETS.
function resolveDefaultColorKey(iconColor: string): string | undefined {
  for (const [key, preset] of Object.entries(COLOR_PRESETS)) {
    if (preset.iconColor === iconColor) return key
  }
  return undefined
}

/** Resolve the PascalCase name of a LucideIcon component */
function getIconComponentName(icon: LucideIcon): string {
  return (icon as { displayName?: string }).displayName || icon.name || 'Pin'
}

interface EventEntry {
  key: string // icon id (what AgentClass.iconId returns, e.g. "bash", "SessionStart")
  label: string // human-readable label
  category: string // grouping header
}

// Every customisable key is an icon registry entry, so the settings list and
// the icons actually rendered can't drift apart.
const CURATED_EVENTS: EventEntry[] = EVENT_ICON_REGISTRY.map((e) => ({
  key: e.id,
  label: e.name,
  category: e.group,
}))

const DEFAULT_EVENT_COLOR: [string, string] = [
  'text-muted-foreground',
  'bg-muted-foreground dark:bg-muted-foreground',
]

// Build resolved event list with defaults from event-icons.ts
interface ResolvedEventEntry extends EventEntry {
  defaultIconName: string
  defaultColorKey: string | undefined
  defaultIconColorClass: string
  defaultDotColorClass: string
}

const EVENT_LIST: ResolvedEventEntry[] = CURATED_EVENTS.map((entry) => {
  const icon = eventIcons[entry.key] || defaultEventIcon
  const [iconColor, dotColor] = eventColors[entry.key] || DEFAULT_EVENT_COLOR
  return {
    ...entry,
    defaultIconName: getIconComponentName(icon),
    defaultColorKey: resolveDefaultColorKey(iconColor),
    defaultIconColorClass: iconColor,
    defaultDotColorClass: dotColor,
  }
})

export function IconSettings() {
  const { customizations, setCustomization, resetCustomization, resetAll } = useIconCustomizations()
  const [filter, setFilter] = useState('')

  const hasAnyCustomizations = Object.keys(customizations).length > 0

  const filteredEvents = useMemo(() => {
    if (!filter) return EVENT_LIST
    const lower = filter.toLowerCase()
    return EVENT_LIST.filter(
      (e) =>
        e.label.toLowerCase().includes(lower) ||
        e.key.toLowerCase().includes(lower) ||
        e.category.toLowerCase().includes(lower),
    )
  }, [filter])

  // Group filtered entries by category in order of first appearance. A Map
  // aggregates categories whose entries are split across the list into one
  // section, which also keeps the section React keys unique.
  const grouped = useMemo(() => {
    const buckets = new Map<string, ResolvedEventEntry[]>()
    for (const entry of filteredEvents) {
      let bucket = buckets.get(entry.category)
      if (!bucket) {
        bucket = []
        buckets.set(entry.category, bucket)
      }
      bucket.push(entry)
    }
    return Array.from(buckets, ([category, entries]) => ({ category, entries }))
  }, [filteredEvents])

  return (
    <div className="flex flex-col gap-3 h-full max-h-full">
      <div className="flex items-center gap-2">
        <Input
          placeholder="Filter event types..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-8 text-sm"
        />
        {hasAnyCustomizations && (
          <Button
            variant="ghost"
            size="xs"
            onClick={resetAll}
            className="shrink-0 text-muted-foreground"
            title="Reset all customizations"
          >
            <RotateCcw className="h-3 w-3" />
            Reset all
          </Button>
        )}
      </div>

      <ScrollArea className="-mx-1" style={{ height: 'calc(80vh - 220px)' }}>
        <div className="space-y-0.5 px-1">
          {grouped.map((group) => (
            <div key={group.category}>
              <div className="px-2 pt-3 pb-1 first:pt-0">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {group.category}
                </span>
              </div>
              {group.entries.map((entry) => (
                <EventRow
                  key={entry.key}
                  entry={entry}
                  customization={customizations[entry.key]}
                  onChangeIcon={(iconName) => setCustomization(entry.key, { iconName })}
                  onChangeColor={(colorName, customHex) =>
                    setCustomization(entry.key, { colorName, customHex })
                  }
                  onReset={() => resetCustomization(entry.key)}
                />
              ))}
            </div>
          ))}
          {filteredEvents.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No event types match your filter.
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

interface EventRowProps {
  entry: ResolvedEventEntry
  customization: { iconName?: string; colorName?: string; customHex?: string } | undefined
  onChangeIcon: (iconName: string) => void
  onChangeColor: (colorName: string, customHex?: string) => void
  onReset: () => void
}

function EventRow({ entry, customization, onChangeIcon, onChangeColor, onReset }: EventRowProps) {
  const hasCustom = !!customization
  const activeIconName = customization?.iconName || entry.defaultIconName
  const activeColorKey = customization?.colorName || entry.defaultColorKey
  const activeCustomHex = customization?.customHex

  // Resolve whether to use dynamic or default icon for preview
  const useDynamic = !!resolveIconName(activeIconName)
  const FallbackIcon = defaultEventIcon

  // Resolve active color class or custom hex
  const isCustomColor = activeColorKey === 'custom' && activeCustomHex
  const activeIconColorClass = isCustomColor
    ? ''
    : activeColorKey && COLOR_PRESETS[activeColorKey]
      ? COLOR_PRESETS[activeColorKey].iconColor
      : entry.defaultIconColorClass

  // Default swatch for color picker
  const defaultSwatch = entry.defaultColorKey
    ? COLOR_PRESETS[entry.defaultColorKey]?.swatch
    : '#6b7280'

  return (
    <div
      className={cn(
        'group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent/50',
        hasCustom && 'bg-accent/30',
      )}
    >
      {/* Preview icon */}
      {useDynamic ? (
        <DynamicIcon
          name={activeIconName}
          className={cn('h-4 w-4 shrink-0', !isCustomColor && activeIconColorClass)}
          style={isCustomColor ? { color: activeCustomHex } : undefined}
        />
      ) : (
        <FallbackIcon
          className={cn('h-4 w-4 shrink-0', !isCustomColor && activeIconColorClass)}
          style={isCustomColor ? { color: activeCustomHex } : undefined}
        />
      )}

      {/* Event name: label + key */}
      <div className="flex-1 min-w-0">
        <span className="truncate text-xs">{entry.label}</span>
        {entry.label !== entry.key && (
          <span className="ml-1.5 truncate font-mono text-[10px] text-muted-foreground/60">
            {entry.key}
          </span>
        )}
      </div>

      {/* Reset button to the left of icon/color pickers */}
      {hasCustom && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onReset}
          className="h-5 w-5 shrink-0 text-muted-foreground"
          title="Reset to default"
        >
          <RotateCcw className="h-3 w-3" />
        </Button>
      )}

      {/* Icon picker */}
      <IconPicker
        currentIconName={activeIconName}
        iconColorClass={isCustomColor ? '' : activeIconColorClass}
        iconStyle={isCustomColor ? { color: activeCustomHex } : undefined}
        onSelect={onChangeIcon}
      />

      {/* Color picker */}
      <ColorPicker
        currentColor={activeColorKey}
        customHex={activeCustomHex}
        onSelect={onChangeColor}
        defaultSwatch={defaultSwatch}
      />
    </div>
  )
}
