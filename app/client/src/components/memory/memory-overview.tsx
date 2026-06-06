import { Brain, FolderGit2, Globe, Bot, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatBytes } from '@/lib/format-bytes'
import type { MemoryStore, MemoryStoreKind } from '@/types/memory'
import { relativeTime } from './memory-lib'

interface MemoryOverviewProps {
  stores: MemoryStore[]
  onSelect: (storeId: string) => void
}

const GROUPS: { kind: MemoryStoreKind; label: string; icon: typeof FolderGit2 }[] = [
  { kind: 'project', label: 'Project memory', icon: FolderGit2 },
  { kind: 'global', label: 'Global', icon: Globe },
  { kind: 'agent', label: 'Agent memory', icon: Bot },
]

export function MemoryOverview({ stores, onSelect }: MemoryOverviewProps) {
  const totalFiles = stores.reduce((n, s) => n + s.fileCount, 0)

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-1">
          <Brain className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-semibold">OpenClaude Memory</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-6">
          Browse and edit OpenClaude's persistent memory — {totalFiles} files across {stores.length}{' '}
          stores. Changes write straight to disk; OpenClaude reads them on its next turn.
        </p>

        {stores.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-10 text-center">
            <FileText className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              No memory files found under the mounted Claude config directory yet.
            </p>
          </div>
        )}

        <div className="space-y-7">
          {GROUPS.map(({ kind, label, icon: GroupIcon }) => {
            const group = stores.filter((s) => s.kind === kind)
            if (group.length === 0) return null
            return (
              <section key={kind}>
                <div className="flex items-center gap-2 mb-2.5">
                  <GroupIcon className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold">{label}</h2>
                  <span className="text-xs text-muted-foreground">({group.length})</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {group.map((store) => (
                    <button
                      key={store.id}
                      onClick={() => onSelect(store.id)}
                      className={cn(
                        'text-left rounded-lg border border-border p-3.5 transition-all',
                        'hover:border-primary/40 hover:bg-accent/50 hover:shadow-sm',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium text-sm truncate">{store.label}</span>
                        <span className="shrink-0 rounded-full bg-primary/10 text-primary text-xs px-2 py-0.5">
                          {store.fileCount}
                        </span>
                      </div>
                      {store.kind === 'project' && store.slug && (
                        <p className="mt-0.5 font-mono text-[0.65rem] text-muted-foreground truncate">
                          {store.slug}
                        </p>
                      )}
                      <p className="mt-2 text-xs text-muted-foreground">
                        {formatBytes(store.totalBytes)} · {relativeTime(store.lastModifiedMs)}
                      </p>
                    </button>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
