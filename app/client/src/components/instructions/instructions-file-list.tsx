import * as React from 'react'
import { Search, Plus, EyeOff, FilePlus2, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { InstructionsFileHeader, InstructionsFileRole } from '@/types/instructions'
import {
  ROLE_LABEL,
  fileCost,
  formatTokens,
  isOverFileBudget,
  relativeTime,
  roleBadgeClass,
  sortHeaders,
} from './instructions-lib'
import { InstructionsRoleIcon } from './instructions-role-icon'

interface InstructionsFileListProps {
  files: InstructionsFileHeader[]
  selectedRelPath: string | null
  onSelect: (relPath: string) => void
  onNew: () => void
  canCreate: boolean
  /** Index of the keyboard-highlighted row (visible/filtered order), or -1. */
  highlightIndex?: number
  /** Reports the current visible/filtered order so the parent can drive keys. */
  onVisibleChange?: (files: InstructionsFileHeader[]) => void
}

export function InstructionsFileList({
  files,
  selectedRelPath,
  onSelect,
  onNew,
  canCreate,
  highlightIndex = -1,
  onVisibleChange,
}: InstructionsFileListProps) {
  const [query, setQuery] = React.useState('')
  const [roleFilter, setRoleFilter] = React.useState<InstructionsFileRole | ''>('')
  const [showMissing, setShowMissing] = React.useState(true)

  const roles = React.useMemo(
    () => [...new Set(files.filter((f) => f.exists).map((f) => f.role))],
    [files],
  )
  const missingCount = React.useMemo(() => files.filter((f) => !f.exists).length, [files])

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return sortHeaders(
      files.filter((f) => {
        if (!f.exists && !showMissing) {
          return false
        }
        if (roleFilter && f.role !== roleFilter) {
          return false
        }
        if (!q) {
          return true
        }
        return (
          f.title.toLowerCase().includes(q) ||
          f.relPath.toLowerCase().includes(q) ||
          (f.description?.toLowerCase().includes(q) ?? false) ||
          (f.agent?.name?.toLowerCase().includes(q) ?? false) ||
          f.snippet.toLowerCase().includes(q)
        )
      }),
    )
  }, [files, query, roleFilter, showMissing])

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
            placeholder="Filter files…"
            className="h-8 pl-7 text-sm"
          />
        </div>
        <div className="flex items-center gap-1.5">
          {roles.length > 1 && (
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as InstructionsFileRole | '')}
              className="h-7 flex-1 min-w-0 rounded-md border border-input bg-transparent dark:bg-input/30 px-2 text-xs outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            >
              <option value="">All kinds</option>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          )}
          {missingCount > 0 && (
            <Button
              type="button"
              variant={showMissing ? 'secondary' : 'outline'}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setShowMissing((s) => !s)}
              title="Show files pi would read but that don't exist yet"
            >
              <FilePlus2 className="h-3.5 w-3.5" /> {missingCount}
            </Button>
          )}
        </div>
        {canCreate && (
          <Button size="sm" variant="outline" className="w-full" onClick={onNew}>
            <Plus className="h-3.5 w-3.5" /> New file
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
        {filtered.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {files.length === 0 ? 'No instruction files here.' : 'No matches.'}
          </p>
        )}
        {filtered.map((f, i) => {
          const active = f.relPath === selectedRelPath
          const highlighted = i === highlightIndex
          const over = f.exists && !f.shadowedBy && isOverFileBudget(f)
          return (
            <button
              key={f.relPath}
              data-sidebar-item
              data-instructions-row={i}
              onClick={() => onSelect(f.relPath)}
              className={cn(
                'w-full text-left rounded-md border px-2.5 py-2 transition-colors',
                active
                  ? 'border-primary/40 bg-primary/5'
                  : highlighted
                    ? 'border-border bg-accent'
                    : 'border-transparent hover:bg-accent hover:border-border',
                !f.exists && 'border-dashed border-border/70 opacity-60',
                f.shadowedBy && 'opacity-60',
              )}
            >
              <div className="flex items-center gap-1.5">
                <InstructionsRoleIcon
                  role={f.role}
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                />
                <span
                  className={cn(
                    'text-sm font-medium truncate flex-1',
                    f.shadowedBy && 'line-through',
                  )}
                >
                  {f.role === 'agent' ? f.title : f.relPath}
                </span>
                {f.shadowedBy && (
                  <span title={`Ignored — pi loads ${f.shadowedBy} instead`} className="shrink-0">
                    <EyeOff className="h-3 w-3 text-muted-foreground" />
                  </span>
                )}
                {f.exists ? (
                  <span
                    className={cn(
                      'shrink-0 font-mono text-[0.65rem]',
                      over ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground',
                    )}
                    title={
                      f.role === 'agent'
                        ? 'Estimated system-prompt tokens (body chars ÷ 4)'
                        : 'Estimated tokens (chars ÷ 4), sent on every request'
                    }
                  >
                    {over && <AlertTriangle className="inline h-3 w-3 mr-0.5 -mt-0.5" />}≈
                    {formatTokens(fileCost(f))}
                  </span>
                ) : (
                  <span className="shrink-0 text-[0.65rem] text-muted-foreground">create</span>
                )}
                <Badge
                  variant="outline"
                  className={cn('text-[0.6rem] px-1 py-0', roleBadgeClass(f.role))}
                >
                  {ROLE_LABEL[f.role]}
                </Badge>
              </div>
              {f.exists && (f.description || f.snippet) && (
                <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                  {f.description || f.snippet}
                </p>
              )}
              <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[0.65rem] text-muted-foreground/70">
                {f.role === 'agent' && <span className="truncate">{f.relPath}</span>}
                {f.agent?.model && <span className="truncate">· {f.agent.model}</span>}
                {f.agent?.thinking && <span>· thinking {f.agent.thinking}</span>}
                {f.agent?.hidden && <span>· hidden</span>}
                {f.exists ? (
                  <span>· {relativeTime(f.mtimeMs)}</span>
                ) : (
                  <span>not created — pi would read it</span>
                )}
              </p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
