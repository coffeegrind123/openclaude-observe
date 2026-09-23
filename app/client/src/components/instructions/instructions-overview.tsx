import type { ReactNode } from 'react'
import { ScrollText, FolderGit2, Home, FileText, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatBytes } from '@/lib/format-bytes'
import { EFFECTIVE_TOKEN_WARN, type InstructionsStore } from '@/types/instructions'
import {
  STORE_KIND_ICON,
  STORE_KIND_LABEL,
  formatTokens,
  relativeTime,
  storeOverBudget,
  storeSubtitle,
} from './instructions-lib'

interface InstructionsOverviewProps {
  homes: string[]
  stores: InstructionsStore[]
  onSelect: (storeId: string) => void
}

export function InstructionsOverview({ homes, stores, onSelect }: InstructionsOverviewProps) {
  const totalFiles = stores.reduce((n, s) => n + s.fileCount, 0)
  const homeStores = stores.filter((s) => s.kind !== 'project')
  const projectStores = stores.filter((s) => s.kind === 'project')

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-1">
          <ScrollText className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-semibold">pi instructions</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-2">
          Context files (AGENTS.md, CLAUDE.md, AGENTS.override.md), SYSTEM.md / APPEND_SYSTEM.md and
          subagent definitions — {totalFiles} files across {stores.length} stores. Changes write
          straight to disk; pi reads them on its next session.
        </p>
        <p className="text-xs text-muted-foreground mb-6">
          Token counts are estimates (characters ÷ 4). Context files and system prompts are sent
          with every request, so they are flagged above {formatTokens(EFFECTIVE_TOKEN_WARN)} tokens
          per store.
        </p>

        {stores.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-10 text-center">
            <FileText className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              {homes.length === 0
                ? 'No pi homes configured (INSTANTCOFFEE_OBSERVE_PI_HOMES) and no projects with a known cwd yet.'
                : 'No stores found.'}
            </p>
          </div>
        )}

        <div className="space-y-7">
          {homeStores.length > 0 && (
            <Section icon={Home} label="pi homes" count={homeStores.length}>
              {homeStores.map((s) => (
                <StoreCard key={s.id} store={s} onSelect={onSelect} />
              ))}
            </Section>
          )}
          {projectStores.length > 0 && (
            <Section icon={FolderGit2} label="Projects" count={projectStores.length}>
              {projectStores.map((s) => (
                <StoreCard key={s.id} store={s} onSelect={onSelect} />
              ))}
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({
  icon: Icon,
  label,
  count,
  children,
}: {
  icon: typeof Home
  label: string
  count: number
  children: ReactNode
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-2.5">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{label}</h2>
        <span className="text-xs text-muted-foreground">({count})</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{children}</div>
    </section>
  )
}

function StoreCard({
  store,
  onSelect,
}: {
  store: InstructionsStore
  onSelect: (storeId: string) => void
}) {
  const Icon = STORE_KIND_ICON[store.kind]
  const over = storeOverBudget(store)
  return (
    <button
      onClick={() => onSelect(store.id)}
      className={cn(
        'text-left rounded-lg border border-border p-3.5 transition-all',
        'hover:border-primary/40 hover:bg-accent/50 hover:shadow-sm',
        !store.available && 'opacity-60',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-1.5 min-w-0">
          <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="font-medium text-sm truncate">{store.label}</span>
        </span>
        <span
          className={cn(
            'shrink-0 rounded-full text-xs px-2 py-0.5 font-mono',
            over
              ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
              : 'bg-primary/10 text-primary',
          )}
          title="Estimated tokens (chars/4)"
        >
          ≈{formatTokens(store.tokens)}
        </span>
      </div>
      <p className="mt-0.5 font-mono text-[0.65rem] text-muted-foreground truncate">
        {STORE_KIND_LABEL[store.kind]} · {storeSubtitle(store)}
      </p>
      {store.available ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {store.fileCount} file{store.fileCount === 1 ? '' : 's'}
          {store.missingCount > 0 && ` · ${store.missingCount} creatable`} ·{' '}
          {formatBytes(store.totalBytes)} · {relativeTime(store.lastModifiedMs)}
        </p>
      ) : (
        <p className="mt-2 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-3 w-3" /> directory not found — not mounted?
        </p>
      )}
    </button>
  )
}
