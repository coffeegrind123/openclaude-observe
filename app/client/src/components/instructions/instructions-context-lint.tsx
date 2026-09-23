import * as React from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  EyeOff,
  Gauge,
  Link2Off,
  ListTree,
  ShieldQuestion,
  FileWarning,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useInstructionsContext } from '@/hooks/use-instructions'
import {
  EFFECTIVE_TOKEN_WARN,
  FILE_TOKEN_WARN,
  type ContextPart,
  type InstructionsFileHeader,
  type InstructionsGraph,
  type InstructionsStore,
} from '@/types/instructions'
import { fileCost, formatTokens } from './instructions-lib'

interface InstructionsContextLintProps {
  store: InstructionsStore
  files: InstructionsFileHeader[]
  graph: InstructionsGraph | undefined
  /** Open a file in any store. */
  onOpen: (storeId: string, relPath: string) => void
}

const ORIGIN_LABEL: Record<ContextPart['origin'], string> = {
  home: 'pi home',
  ancestor: 'parent dir',
  project: 'project',
}

const KIND_LABEL: Record<ContextPart['kind'], string> = {
  context: 'context',
  system: 'SYSTEM.md (replaces default prompt)',
  'append-system': 'APPEND_SYSTEM.md',
}

function Row({
  tone,
  icon: Icon,
  children,
}: {
  tone: 'warn' | 'ok' | 'info'
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-md border px-3 py-2 text-xs',
        tone === 'warn'
          ? 'border-amber-500/30 bg-amber-500/5 text-foreground'
          : 'border-border text-muted-foreground',
      )}
    >
      <Icon
        className={cn(
          'h-3.5 w-3.5 mt-0.5 shrink-0',
          tone === 'warn'
            ? 'text-amber-600 dark:text-amber-400'
            : tone === 'ok'
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-muted-foreground',
        )}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function FileChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded border border-border px-1.5 py-0.5 font-mono hover:bg-accent"
    >
      {label}
    </button>
  )
}

/**
 * Standing-cost and health report for a store. Every context file and system
 * prompt is re-sent on every request, so the headline is the effective
 * per-request total (this store + the pi home + parent directories), per pi
 * home since a project may be driven by more than one pi install.
 */
export function InstructionsContextLint({
  store,
  files,
  graph,
  onOpen,
}: InstructionsContextLintProps) {
  const showsContext = store.kind !== 'home-agents'
  const contextQ = useInstructionsContext(showsContext ? store.id : null)

  const lint = React.useMemo(() => {
    const existing = files.filter((f) => f.exists)
    const heavy = existing.filter((f) => !f.shadowedBy && fileCost(f) > FILE_TOKEN_WARN)
    const shadowed = existing.filter((f) => f.shadowedBy)
    const contextWithFrontmatter = existing.filter((f) => f.role !== 'agent' && f.hasFrontmatter)
    const unnamedAgents = existing.filter((f) => f.role === 'agent' && !f.agent?.name)
    const nameCounts = new Map<string, InstructionsFileHeader[]>()
    for (const f of existing) {
      const n = f.agent?.name
      if (f.role !== 'agent' || !n) {
        continue
      }
      nameCounts.set(n, [...(nameCounts.get(n) ?? []), f])
    }
    const duplicateAgents = [...nameCounts.entries()].filter(([, fs]) => fs.length > 1)
    const broken = (graph?.nodes ?? [])
      .filter((n) => n.storeId === store.id && n.broken.length > 0)
      .map((n) => ({ relPath: n.relPath, name: n.name, broken: n.broken }))
    const trustGated = existing.filter(
      (f) => store.kind === 'project' && (f.role === 'system' || f.role === 'append-system'),
    )
    return {
      heavy,
      shadowed,
      contextWithFrontmatter,
      unnamedAgents,
      duplicateAgents,
      broken,
      trustGated,
    }
  }, [files, graph, store.id, store.kind])

  const agents = files.filter((f) => f.exists && f.role === 'agent')
  const clean =
    lint.heavy.length === 0 &&
    lint.shadowed.length === 0 &&
    lint.contextWithFrontmatter.length === 0 &&
    lint.unnamedAgents.length === 0 &&
    lint.duplicateAgents.length === 0 &&
    lint.broken.length === 0

  return (
    <div className="space-y-5">
      {showsContext && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Gauge className="h-3.5 w-3.5" /> Per-request context
          </div>
          <p className="text-[0.7rem] text-muted-foreground">
            What pi sends with every request for{' '}
            {store.kind === 'project' ? 'a session in this directory' : 'this home'} — tokens are
            estimated as characters ÷ 4. Warns above {formatTokens(EFFECTIVE_TOKEN_WARN)} total or{' '}
            {formatTokens(FILE_TOKEN_WARN)} per file.
          </p>
          {contextQ.isLoading && <p className="text-xs text-muted-foreground">Measuring…</p>}
          {contextQ.isError && (
            <p className="text-xs text-destructive">Failed to compute the effective context.</p>
          )}
          {contextQ.data?.homes.map((h) => {
            const over = h.totalTokens > EFFECTIVE_TOKEN_WARN
            return (
              <div key={h.homeIndex} className="rounded-md border border-border">
                <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
                  <span className="font-mono truncate flex-1" title={h.homePath}>
                    via {h.homePath}
                  </span>
                  {h.likely && contextQ.data!.homes.length > 1 && (
                    <span className="rounded bg-primary/10 px-1 text-[0.65rem] text-primary">
                      likely
                    </span>
                  )}
                  <span
                    className={cn(
                      'font-mono font-medium',
                      over ? 'text-amber-600 dark:text-amber-400' : 'text-foreground',
                    )}
                  >
                    ≈{formatTokens(h.totalTokens)} tokens
                  </span>
                  {over && <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                </div>
                {h.parts.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">
                    No instruction files — pi uses its built-in prompt only.
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {h.parts.map((p) => {
                      const heavy = p.tokens > FILE_TOKEN_WARN
                      const share = h.totalTokens ? (p.tokens / h.totalTokens) * 100 : 0
                      return (
                        <li key={p.absPath} className="px-3 py-1.5 text-xs">
                          <div className="flex items-center gap-2">
                            {p.storeId && p.relPath ? (
                              <button
                                onClick={() => onOpen(p.storeId!, p.relPath!)}
                                className="font-mono truncate text-left text-primary hover:underline"
                                title={p.absPath}
                              >
                                {p.absPath}
                              </button>
                            ) : (
                              <span className="font-mono truncate" title={p.absPath}>
                                {p.absPath}
                              </span>
                            )}
                            <span className="shrink-0 text-muted-foreground">
                              {ORIGIN_LABEL[p.origin]} · {KIND_LABEL[p.kind]}
                            </span>
                            {p.requiresTrust && (
                              <span
                                className="shrink-0"
                                title="pi only reads a project's SYSTEM.md / APPEND_SYSTEM.md when the project is trusted"
                              >
                                <ShieldQuestion className="h-3 w-3 text-muted-foreground" />
                              </span>
                            )}
                            <span className="flex-1" />
                            <span
                              className={cn(
                                'shrink-0 font-mono',
                                heavy && 'text-amber-600 dark:text-amber-400',
                              )}
                            >
                              ≈{formatTokens(p.tokens)}
                            </span>
                          </div>
                          <div className="mt-1 h-1 rounded-full bg-muted overflow-hidden">
                            <div
                              className={cn('h-full', heavy ? 'bg-amber-500' : 'bg-primary/60')}
                              style={{ width: `${share}%` }}
                            />
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      )}

      {agents.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Gauge className="h-3.5 w-3.5" /> Subagent prompts
          </div>
          <p className="text-[0.7rem] text-muted-foreground">
            Each definition's body is that subagent's system prompt, paid every time it runs.
          </p>
          <ul className="rounded-md border border-border divide-y divide-border">
            {agents.map((f) => {
              const heavy = f.bodyTokens > FILE_TOKEN_WARN
              return (
                <li key={f.relPath} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                  <button
                    onClick={() => onOpen(store.id, f.relPath)}
                    className="font-mono truncate text-left text-primary hover:underline"
                  >
                    {f.agent?.name ?? f.name}
                  </button>
                  <span className="truncate text-muted-foreground">{f.relPath}</span>
                  <span className="flex-1" />
                  <span className={cn('font-mono', heavy && 'text-amber-600 dark:text-amber-400')}>
                    ≈{formatTokens(f.bodyTokens)}
                  </span>
                  {heavy && <AlertTriangle className="h-3 w-3 text-amber-500" />}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <ListTree className="h-3.5 w-3.5" /> Health
        </div>

        {clean && (
          <Row tone="ok" icon={CheckCircle2}>
            No issues — sizes, links and definitions all look good.
          </Row>
        )}

        {lint.heavy.length > 0 && (
          <Row tone="warn" icon={AlertTriangle}>
            <span className="font-medium">Large files</span> — over {formatTokens(FILE_TOKEN_WARN)}{' '}
            estimated tokens each:
            <div className="mt-1 flex flex-wrap gap-1.5">
              {lint.heavy.map((f) => (
                <FileChip
                  key={f.relPath}
                  label={`${f.relPath} ≈${formatTokens(fileCost(f))}`}
                  onClick={() => onOpen(store.id, f.relPath)}
                />
              ))}
            </div>
          </Row>
        )}

        {lint.shadowed.length > 0 && (
          <Row tone="warn" icon={EyeOff}>
            <span className="font-medium">Ignored by pi</span> — pi loads only the first context
            file per directory (AGENTS.override.md, AGENTS.md, CLAUDE.md):
            <div className="mt-1 space-y-1">
              {lint.shadowed.map((f) => (
                <div key={f.relPath} className="flex items-center gap-1.5 flex-wrap">
                  <FileChip label={f.relPath} onClick={() => onOpen(store.id, f.relPath)} />
                  <span className="text-muted-foreground">shadowed by {f.shadowedBy}</span>
                </div>
              ))}
            </div>
          </Row>
        )}

        {lint.contextWithFrontmatter.length > 0 && (
          <Row tone="warn" icon={FileWarning}>
            <span className="font-medium">Frontmatter in a context file</span> — pi doesn't parse
            it; the YAML is sent to the model verbatim:
            <div className="mt-1 flex flex-wrap gap-1.5">
              {lint.contextWithFrontmatter.map((f) => (
                <FileChip
                  key={f.relPath}
                  label={f.relPath}
                  onClick={() => onOpen(store.id, f.relPath)}
                />
              ))}
            </div>
          </Row>
        )}

        {lint.unnamedAgents.length > 0 && (
          <Row tone="warn" icon={FileWarning}>
            <span className="font-medium">Subagents without a name</span> — pi-subagents-lite skips
            these entirely:
            <div className="mt-1 flex flex-wrap gap-1.5">
              {lint.unnamedAgents.map((f) => (
                <FileChip
                  key={f.relPath}
                  label={f.relPath}
                  onClick={() => onOpen(store.id, f.relPath)}
                />
              ))}
            </div>
          </Row>
        )}

        {lint.duplicateAgents.length > 0 && (
          <Row tone="warn" icon={FileWarning}>
            <span className="font-medium">Duplicate subagent names</span> — the later definition
            silently overrides the earlier one field by field:
            <div className="mt-1 space-y-1">
              {lint.duplicateAgents.map(([name, fs]) => (
                <div key={name} className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-mono">{name}</span>
                  {fs.map((f) => (
                    <FileChip
                      key={f.relPath}
                      label={f.relPath}
                      onClick={() => onOpen(store.id, f.relPath)}
                    />
                  ))}
                </div>
              ))}
            </div>
          </Row>
        )}

        {lint.broken.length > 0 && (
          <Row tone="warn" icon={Link2Off}>
            <span className="font-medium">Broken links</span> — targets that match no instruction
            file in any store:
            <div className="mt-1 space-y-1">
              {lint.broken.map((b) => (
                <div key={b.relPath} className="flex items-center gap-1.5 flex-wrap">
                  <FileChip label={b.relPath} onClick={() => onOpen(store.id, b.relPath)} />
                  <span className="font-mono text-muted-foreground">→ {b.broken.join(', ')}</span>
                </div>
              ))}
            </div>
          </Row>
        )}

        {lint.trustGated.length > 0 && (
          <Row tone="info" icon={ShieldQuestion}>
            {lint.trustGated.map((f) => f.relPath).join(', ')} only take effect when pi trusts this
            project, and then replace the pi home's file of the same name.
          </Row>
        )}
      </div>
    </div>
  )
}
