import * as React from 'react'
import { Plus, Home, CornerDownLeft } from 'lucide-react'
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
import { useInstructionsStores, useInstructionsSearch } from '@/hooks/use-instructions'
import { fuzzyRank } from '@/lib/fuzzy'
import type { InstructionsStore } from '@/types/instructions'
import { Badge } from '@/components/ui/badge'
import {
  ROLE_LABEL,
  STORE_KIND_ICON,
  STORE_KIND_LABEL,
  fileCost,
  formatTokens,
  roleBadgeClass,
} from './instructions-lib'
import { InstructionsRoleIcon } from './instructions-role-icon'

interface PaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onNewFile: () => void
  canCreate: boolean
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value)
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export function InstructionsCommandPalette({
  open,
  onOpenChange,
  onNewFile,
  canCreate,
}: PaletteProps) {
  const [query, setQuery] = React.useState('')
  const debounced = useDebounced(query, 140)
  const setStore = useUIStore((s) => s.setInstructionsStore)
  const openFile = useUIStore((s) => s.openInstructionsFile)

  const storesQ = useInstructionsStores()
  const stores = React.useMemo(() => (storesQ.data?.ok ? storesQ.data.stores : []), [storesQ.data])
  const searchQ = useInstructionsSearch(debounced, open)
  const hits = React.useMemo(() => searchQ.data?.hits ?? [], [searchQ.data])

  React.useEffect(() => {
    if (!open) {
      setQuery('')
    }
  }, [open])

  const rankedStores = React.useMemo(
    () =>
      query
        ? fuzzyRank<InstructionsStore>(query, stores, (s) => [
            s.label,
            s.dir,
            STORE_KIND_LABEL[s.kind],
          ]).map((r) => r.item)
        : stores,
    [query, stores],
  )

  // The server already substring-filters hits; fuzzy-rank for ordering when typing.
  const rankedHits = React.useMemo(() => {
    if (!query) {
      return hits.slice(0, 30)
    }
    const ranked = fuzzyRank(query, hits, (h) => [
      h.file.title,
      h.file.relPath,
      h.file.agent?.name ?? '',
      h.storeLabel,
    ]).map((r) => r.item)
    // Content-only matches don't fuzzy-rank on these keys; keep them after.
    const seen = new Set(ranked)
    return [...ranked, ...hits.filter((h) => !seen.has(h))]
  }, [query, hits])

  const close = () => onOpenChange(false)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-0 overflow-hidden">
        <DialogTitle className="sr-only">Instructions command palette</DialogTitle>
        <Command shouldFilter={false} className="[&_[cmdk-input-wrapper]]:border-b">
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search instruction files across all stores, or jump to a store…"
            autoFocus
          />
          <CommandList className="max-h-[60vh]">
            <CommandEmpty>No matches.</CommandEmpty>

            <CommandGroup heading="Actions">
              <CommandItem
                value="__home"
                onSelect={() => {
                  setStore(null)
                  close()
                }}
              >
                <Home className="h-4 w-4" /> Go to Instructions home
              </CommandItem>
              {canCreate && (
                <CommandItem
                  value="__new"
                  onSelect={() => {
                    onNewFile()
                    close()
                  }}
                >
                  <Plus className="h-4 w-4" /> New file in this store
                </CommandItem>
              )}
            </CommandGroup>

            {rankedHits.length > 0 && (
              <CommandGroup heading="Files">
                {rankedHits.map((h) => (
                  <CommandItem
                    key={`${h.storeId}::${h.file.relPath}`}
                    value={`f:${h.storeId}:${h.file.relPath}`}
                    onSelect={() => {
                      openFile(h.storeId, h.file.relPath)
                      close()
                    }}
                    className="gap-2"
                  >
                    <InstructionsRoleIcon
                      role={h.file.role}
                      className="h-4 w-4 shrink-0 text-muted-foreground"
                    />
                    <span className="truncate flex-1">
                      {h.file.role === 'agent' ? h.file.title : h.file.relPath}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn('text-[0.65rem] px-1 py-0', roleBadgeClass(h.file.role))}
                    >
                      {ROLE_LABEL[h.file.role]}
                    </Badge>
                    <span className="font-mono text-[0.65rem] text-muted-foreground">
                      ≈{formatTokens(fileCost(h.file))}
                    </span>
                    <span className="text-xs text-muted-foreground truncate max-w-[35%]">
                      {h.storeLabel}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {rankedStores.length > 0 && (
              <CommandGroup heading="Stores">
                {rankedStores.map((s) => {
                  const Icon = STORE_KIND_ICON[s.kind]
                  return (
                    <CommandItem
                      key={s.id}
                      value={`s:${s.id}`}
                      onSelect={() => {
                        setStore(s.id)
                        close()
                      }}
                      className="gap-2"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate flex-1">{s.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {STORE_KIND_LABEL[s.kind]}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        ≈{formatTokens(s.tokens)}
                      </span>
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
