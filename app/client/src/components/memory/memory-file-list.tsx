import * as React from 'react'
import { Search, FileText, BookMarked, Plus, Archive, Sprout, Star, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { MemoryFileHeader } from '@/types/memory'
import {
  relativeTime,
  typeBadgeClass,
  statusBadgeClass,
  isArchivedStatus,
  statusRank,
  isStale,
} from './memory-lib'
import { MemoryTypeIcon } from './memory-type-icon'

interface MemoryFileListProps {
  files: MemoryFileHeader[]
  selectedRelPath: string | null
  onSelect: (relPath: string) => void
  onNew: () => void
  canCreate: boolean
  /** Index of the keyboard-highlighted row (visible/filtered order), or -1. */
  highlightIndex?: number
  /** Reports the current visible/filtered order so the parent can drive keys. */
  onVisibleChange?: (files: MemoryFileHeader[]) => void
}

const STATUS_ICON: Record<string, typeof Sprout> = {
  seedling: Sprout,
  current: Star,
  superseded: Archive,
  outdated: Clock,
}

export function MemoryFileList({
  files,
  selectedRelPath,
  onSelect,
  onNew,
  canCreate,
  highlightIndex = -1,
  onVisibleChange,
}: MemoryFileListProps) {
  const [query, setQuery] = React.useState('')
  const [typeFilter, setTypeFilter] = React.useState('')
  const [showArchived, setShowArchived] = React.useState(false)

  const types = React.useMemo(
    () => [...new Set(files.map((f) => f.type).filter(Boolean))] as string[],
    [files],
  )
  const archivedCount = React.useMemo(
    () => files.filter((f) => isArchivedStatus(f.status)).length,
    [files],
  )

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    const out = files.filter((f) => {
      if (!showArchived && isArchivedStatus(f.status) && !f.isIndex) return false
      if (typeFilter && f.type !== typeFilter) return false
      if (!q) return true
      return (
        f.title.toLowerCase().includes(q) ||
        f.name.toLowerCase().includes(q) ||
        (f.description?.toLowerCase().includes(q) ?? false) ||
        f.snippet.toLowerCase().includes(q) ||
        (f.type?.toLowerCase().includes(q) ?? false)
      )
    })
    out.sort((a, b) => {
      if (a.isIndex !== b.isIndex) return a.isIndex ? -1 : 1
      const sr = statusRank(a.status) - statusRank(b.status)
      if (sr !== 0) return sr
      return b.mtimeMs - a.mtimeMs
    })
    return out
  }, [files, query, typeFilter, showArchived])

  React.useEffect(() => {
    onVisibleChange?.(filtered)
  }, [filtered, onVisibleChange])

  return (
    <div className="flex flex-col h-full min-h-0 w-[340px] shrink-0 border-r border-border">
      <div className="shrink-0 p-2 space-y-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search memory…"
            className="h-8 pl-7 text-sm"
          />
        </div>
        <div className="flex items-center gap-1.5">
          {types.length > 0 && (
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="h-7 flex-1 min-w-0 rounded-md border border-input bg-transparent dark:bg-input/30 px-2 text-xs outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            >
              <option value="">All types</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
          {archivedCount > 0 && (
            <Button
              type="button"
              variant={showArchived ? 'secondary' : 'outline'}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setShowArchived((s) => !s)}
              title="Show superseded / outdated memories"
            >
              <Archive className="h-3.5 w-3.5" /> {archivedCount}
            </Button>
          )}
        </div>
        {canCreate && (
          <Button size="sm" variant="outline" className="w-full" onClick={onNew}>
            <Plus className="h-3.5 w-3.5" /> New memory
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
        {filtered.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {files.length === 0 ? 'No memory files yet.' : 'No matches.'}
          </p>
        )}
        {filtered.map((f, i) => {
          const active = f.relPath === selectedRelPath
          const highlighted = i === highlightIndex
          const archived = isArchivedStatus(f.status)
          const StatusIcon = f.status ? STATUS_ICON[f.status] : undefined
          return (
            <button
              key={f.relPath}
              data-sidebar-item
              data-memory-row={i}
              onClick={() => onSelect(f.relPath)}
              className={cn(
                'w-full text-left rounded-md border px-2.5 py-2 transition-colors',
                active
                  ? 'border-primary/40 bg-primary/5'
                  : highlighted
                    ? 'border-border bg-accent'
                    : 'border-transparent hover:bg-accent hover:border-border',
                archived && 'opacity-60',
              )}
            >
              <div className="flex items-center gap-1.5">
                {f.isIndex ? (
                  <BookMarked className="h-3.5 w-3.5 shrink-0 text-primary" />
                ) : (
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <span
                  className={cn('text-sm font-medium truncate flex-1', archived && 'line-through')}
                >
                  {f.title}
                </span>
                {StatusIcon && (
                  <span title={f.status} className="shrink-0">
                    <StatusIcon className="h-3 w-3 text-muted-foreground" />
                  </span>
                )}
                {f.type && (
                  <Badge
                    variant="outline"
                    className={cn('text-[0.65rem] px-1 py-0 gap-0.5', typeBadgeClass(f.type))}
                  >
                    <MemoryTypeIcon type={f.type} className="h-2.5 w-2.5" />
                    {f.type}
                  </Badge>
                )}
              </div>
              {(f.description || f.snippet) && (
                <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                  {f.description || f.snippet}
                </p>
              )}
              <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[0.65rem] text-muted-foreground/70">
                <span className="truncate">{f.relPath}</span>
                <span>· {relativeTime(f.mtimeMs)}</span>
                {isStale(f.mtimeMs, f.status) && (
                  <span
                    className="rounded bg-amber-500/15 px-1 text-amber-600 dark:text-amber-400"
                    title="Not updated in 90+ days"
                  >
                    stale
                  </span>
                )}
                {f.status && (
                  <span className={cn('rounded border px-1', statusBadgeClass(f.status))}>
                    {f.status}
                  </span>
                )}
              </p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
