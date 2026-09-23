import { ScrollText, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'
import { useInstructionsStores } from '@/hooks/use-instructions'
import type { InstructionsStore } from '@/types/instructions'
import { STORE_KIND_ICON, formatTokens, storeOverBudget, storeSubtitle } from './instructions-lib'

interface InstructionsStoreListProps {
  collapsed: boolean
}

export function InstructionsStoreList({ collapsed }: InstructionsStoreListProps) {
  const selected = useUIStore((s) => s.instructionsSelectedStoreId)
  const setStore = useUIStore((s) => s.setInstructionsStore)
  const { data, isLoading } = useInstructionsStores()

  if (isLoading) {
    return <p className="px-2 py-4 text-xs text-muted-foreground">Loading instructions…</p>
  }
  if (!data || !data.ok) {
    if (collapsed) {
      return null
    }
    return (
      <p className="px-2 py-4 text-xs text-muted-foreground">
        {data && !data.ok ? data.message : 'Instructions unavailable.'}
      </p>
    )
  }

  const stores = data.stores

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 mt-2">
        <ScrollText className="h-4 w-4 text-muted-foreground mb-1" />
        {stores.slice(0, 12).map((store) => {
          const Icon = STORE_KIND_ICON[store.kind]
          return (
            <button
              key={store.id}
              onClick={() => setStore(store.id)}
              title={`${store.label} — ${storeSubtitle(store)}`}
              className={cn(
                'flex items-center justify-center h-7 w-7 rounded-md',
                store.id === selected ? 'bg-primary/15 text-primary' : 'hover:bg-accent',
                !store.available && 'opacity-50',
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
    return (
      <p className="px-2 py-4 text-xs text-muted-foreground">
        No pi homes configured and no projects with a known cwd.
      </p>
    )
  }

  const homeStores = stores.filter((s) => s.kind !== 'project')
  const projectStores = stores.filter((s) => s.kind === 'project')

  return (
    <div className="mt-2 space-y-3">
      {homeStores.length > 0 && (
        <div>
          <div className="px-2 mb-1 text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
            pi homes
          </div>
          <div className="space-y-0.5">
            {homeStores.map((store) => (
              <StoreRow
                key={store.id}
                store={store}
                active={store.id === selected}
                onClick={() => setStore(store.id)}
              />
            ))}
          </div>
        </div>
      )}
      {projectStores.length > 0 && (
        <div>
          <div className="px-2 mb-1 text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
            Projects
          </div>
          <div className="space-y-0.5">
            {projectStores.map((store) => (
              <StoreRow
                key={store.id}
                store={store}
                active={store.id === selected}
                onClick={() => setStore(store.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StoreRow({
  store,
  active,
  onClick,
}: {
  store: InstructionsStore
  active: boolean
  onClick: () => void
}) {
  const Icon = STORE_KIND_ICON[store.kind]
  const over = storeOverBudget(store)
  return (
    <button
      data-sidebar-item
      onClick={onClick}
      title={`${store.dir}${store.available ? '' : ' (not found)'}`}
      className={cn(
        'w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
        active ? 'bg-primary/10 text-primary' : 'hover:bg-accent',
        !store.available && 'opacity-50',
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 min-w-0">
        <span className="block truncate text-sm">
          {store.kind === 'home-agents' ? 'subagents' : store.label}
        </span>
        {store.kind === 'home' && (
          <span className="block truncate font-mono text-[0.6rem] text-muted-foreground">
            {storeSubtitle(store)}
          </span>
        )}
      </span>
      {over && <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" />}
      <span
        className={cn(
          'shrink-0 text-[0.65rem] rounded-full px-1.5 py-0.5 font-mono',
          active ? 'bg-primary/15' : 'bg-muted text-muted-foreground',
        )}
        title={`${store.fileCount} files · ≈${store.tokens} tokens (chars/4 estimate)`}
      >
        ≈{formatTokens(store.tokens)}
      </span>
    </button>
  )
}
