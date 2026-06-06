import * as React from 'react'
import { FileText, FolderGit2, Globe, Bot, Plus, Home, CornerDownLeft } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'
import { useMemoryStores, useMemorySearch } from '@/hooks/use-memory'
import { fuzzyRank } from '@/lib/fuzzy'
import type { MemoryStore, MemoryStoreKind } from '@/types/memory'
import { typeBadgeClass } from './memory-lib'
import { Badge } from '@/components/ui/badge'

interface PaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onNewFile: () => void
  canCreate: boolean
}

const KIND_ICON: Record<MemoryStoreKind, typeof FolderGit2> = {
  project: FolderGit2,
  global: Globe,
  agent: Bot,
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value)
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export function MemoryCommandPalette({ open, onOpenChange, onNewFile, canCreate }: PaletteProps) {
  const [query, setQuery] = React.useState('')
  const debounced = useDebounced(query, 140)
  const setMemoryStore = useUIStore((s) => s.setMemoryStore)
  const setMemoryFile = useUIStore((s) => s.setMemoryFile)

  const storesQ = useMemoryStores()
  const stores = storesQ.data?.ok ? storesQ.data.stores : []
  const searchQ = useMemorySearch(debounced, open)
  const hits = searchQ.data?.hits ?? []

  React.useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const rankedStores = React.useMemo(
    () =>
      query
        ? fuzzyRank<MemoryStore>(query, stores, (s) => [
            s.label,
            s.slug ?? '',
            s.agentType ?? '',
          ]).map((r) => r.item)
        : stores,
    [query, stores],
  )

  // Server already substring-filters hits; fuzzy-rank for ordering when typing.
  const rankedHits = React.useMemo(() => {
    if (!query) return hits.slice(0, 30)
    return fuzzyRank(query, hits, (h) => [h.file.title, h.file.name, h.storeLabel]).map(
      (r) => r.item,
    )
  }, [query, hits])

  const go = (storeId: string, relPath?: string) => {
    setMemoryStore(storeId)
    if (relPath) setMemoryFile(relPath)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-0 overflow-hidden">
        <DialogTitle className="sr-only">Memory command palette</DialogTitle>
        <Command shouldFilter={false} className="[&_[cmdk-input-wrapper]]:border-b">
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search memory across all stores, or jump to a store…"
            autoFocus
          />
          <CommandList className="max-h-[60vh]">
            <CommandEmpty>No matches.</CommandEmpty>

            <CommandGroup heading="Actions">
              <CommandItem
                value="__home"
                onSelect={() => {
                  setMemoryStore(null)
                  onOpenChange(false)
                }}
              >
                <Home className="h-4 w-4" /> Go to Memory home
              </CommandItem>
              {canCreate && (
                <CommandItem
                  value="__new"
                  onSelect={() => {
                    onNewFile()
                    onOpenChange(false)
                  }}
                >
                  <Plus className="h-4 w-4" /> New memory in this store
                </CommandItem>
              )}
            </CommandGroup>

            {rankedHits.length > 0 && (
              <CommandGroup heading="Memory files">
                {rankedHits.map((h) => (
                  <CommandItem
                    key={`${h.storeId}::${h.file.relPath}`}
                    value={`f:${h.storeId}:${h.file.relPath}`}
                    onSelect={() => go(h.storeId, h.file.relPath)}
                    className="gap-2"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate flex-1">{h.file.title}</span>
                    {h.file.type && (
                      <Badge
                        variant="outline"
                        className={cn('text-[0.65rem] px-1 py-0', typeBadgeClass(h.file.type))}
                      >
                        {h.file.type}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground truncate max-w-[40%]">
                      {h.storeLabel}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {rankedStores.length > 0 && (
              <CommandGroup heading="Stores">
                {rankedStores.map((s) => {
                  const Icon = KIND_ICON[s.kind]
                  return (
                    <CommandItem
                      key={s.id}
                      value={`s:${s.id}`}
                      onSelect={() => go(s.id)}
                      className="gap-2"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate flex-1">{s.label}</span>
                      <span className="text-xs text-muted-foreground">{s.fileCount}</span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}
          </CommandList>
          <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-[0.65rem] text-muted-foreground">
            <span className="flex items-center gap-1">
              <CornerDownLeft className="h-3 w-3" /> open
            </span>
            <span>↑↓ navigate</span>
            <span>esc close</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
