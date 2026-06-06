import { FolderGit2, Globe, Bot, Brain } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'
import { useMemoryStores } from '@/hooks/use-memory'
import type { MemoryStore, MemoryStoreKind } from '@/types/memory'

interface MemoryStoreListProps {
  collapsed: boolean
}

const KIND_ICON: Record<MemoryStoreKind, typeof FolderGit2> = {
  project: FolderGit2,
  global: Globe,
  agent: Bot,
}

const GROUP_ORDER: { kind: MemoryStoreKind; label: string }[] = [
  { kind: 'project', label: 'Projects' },
  { kind: 'global', label: 'Global' },
  { kind: 'agent', label: 'Agents' },
]

export function MemoryStoreList({ collapsed }: MemoryStoreListProps) {
  const selected = useUIStore((s) => s.memorySelectedStoreId)
  const setMemoryStore = useUIStore((s) => s.setMemoryStore)
  const { data, isLoading } = useMemoryStores()

  if (isLoading) {
    return <p className="px-2 py-4 text-xs text-muted-foreground">Loading memory…</p>
  }
  if (!data || !data.ok) {
    if (collapsed) return null
    return (
      <p className="px-2 py-4 text-xs text-muted-foreground">
        {data && !data.ok ? data.message : 'Memory unavailable.'}
      </p>
    )
  }

  const stores = data.stores

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 mt-2">
        <Brain className="h-4 w-4 text-muted-foreground mb-1" />
        {stores.slice(0, 12).map((store) => {
          const Icon = KIND_ICON[store.kind]
          return (
            <button
              key={store.id}
              onClick={() => setMemoryStore(store.id)}
              title={store.label}
              className={cn(
                'flex items-center justify-center h-7 w-7 rounded-md',
                store.id === selected ? 'bg-primary/15 text-primary' : 'hover:bg-accent',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          )
        })}
      </div>
    )
  }

  if (stores.length === 0) {
    return <p className="px-2 py-4 text-xs text-muted-foreground">No memory stores found.</p>
  }

  return (
    <div className="mt-2 space-y-3">
      {GROUP_ORDER.map(({ kind, label }) => {
        const group = stores.filter((s) => s.kind === kind)
        if (group.length === 0) return null
        return (
          <div key={kind}>
            <div className="px-2 mb-1 text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
              {label}
            </div>
            <div className="space-y-0.5">
              {group.map((store) => (
                <StoreRow
                  key={store.id}
                  store={store}
                  active={store.id === selected}
                  onClick={() => setMemoryStore(store.id)}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function StoreRow({
  store,
  active,
  onClick,
}: {
  store: MemoryStore
  active: boolean
  onClick: () => void
}) {
  const Icon = KIND_ICON[store.kind]
  return (
    <button
      data-sidebar-item
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
        active ? 'bg-primary/10 text-primary' : 'hover:bg-accent',
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 truncate text-sm">{store.label}</span>
      <span
        className={cn(
          'shrink-0 text-[0.65rem] rounded-full px-1.5 py-0.5',
          active ? 'bg-primary/15' : 'bg-muted text-muted-foreground',
        )}
      >
        {store.fileCount}
      </span>
    </button>
  )
}
