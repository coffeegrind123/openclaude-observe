import * as React from 'react'
import { AlertTriangle, CheckCircle2, FileWarning, Link2Off, ListTree } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMemoryFile } from '@/hooks/use-memory'
import type { MemoryFileHeader } from '@/types/memory'
import { fileStem, resolveLink } from './memory-lib'

interface MemoryStoreLintProps {
  storeId: string
  files: MemoryFileHeader[]
  onOpen: (relPath: string) => void
}

const MAX_LINES = 200
const MAX_BYTES = 25_000

/** Parse `](target.md)` markdown-link targets out of the MEMORY.md index. */
function parseIndexTargets(content: string): string[] {
  const out: string[] = []
  for (const m of content.matchAll(/\]\(([^)]+?\.md)\)/gi)) {
    out.push(fileStem(m[1]))
  }
  return out
}

function Row({
  tone,
  icon: Icon,
  children,
}: {
  tone: 'warn' | 'ok'
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
            : 'text-emerald-600 dark:text-emerald-400',
        )}
      />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function MemoryStoreLint({ storeId, files, onOpen }: MemoryStoreLintProps) {
  const indexQ = useMemoryFile(storeId, 'MEMORY.md')

  const lint = React.useMemo(() => {
    const nonIndex = files.filter((f) => !f.isIndex)
    const fileStems = new Set(nonIndex.map((f) => fileStem(f.relPath).toLowerCase()))

    // Broken wikilinks: any outgoing link that resolves to no file.
    const brokenLinkFiles = nonIndex
      .map((f) => ({
        file: f,
        broken: f.links.filter((l) => !resolveLink(l, files)),
      }))
      .filter((x) => x.broken.length > 0)

    let orphans: string[] = []
    let unindexed: MemoryFileHeader[] = []
    let lines = 0
    let bytes = 0
    let hasIndex = false

    if (indexQ.data) {
      hasIndex = true
      const content = indexQ.data.content
      lines = content.split('\n').length
      bytes = new TextEncoder().encode(content).length
      const targets = new Set(parseIndexTargets(content).map((t) => t.toLowerCase()))
      orphans = [...targets].filter((t) => !fileStems.has(t))
      unindexed = nonIndex.filter((f) => !targets.has(fileStem(f.relPath).toLowerCase()))
    }

    return { brokenLinkFiles, orphans, unindexed, lines, bytes, hasIndex }
  }, [files, indexQ.data])

  const clean =
    lint.brokenLinkFiles.length === 0 &&
    lint.orphans.length === 0 &&
    lint.unindexed.length === 0 &&
    lint.lines <= MAX_LINES &&
    lint.bytes <= MAX_BYTES

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <ListTree className="h-3.5 w-3.5" /> Health
      </div>

      {clean && (
        <Row tone="ok" icon={CheckCircle2}>
          No issues — index, links, and size all look good.
        </Row>
      )}

      {lint.hasIndex && (lint.lines > MAX_LINES || lint.bytes > MAX_BYTES) && (
        <Row tone="warn" icon={AlertTriangle}>
          MEMORY.md is {lint.lines} lines / {(lint.bytes / 1024).toFixed(1)} KB — over OpenClaude's
          load cap ({MAX_LINES} lines / {MAX_BYTES / 1000} KB). Part of it won't be loaded into
          context.
        </Row>
      )}

      {lint.orphans.length > 0 && (
        <Row tone="warn" icon={FileWarning}>
          <span className="font-medium">Orphaned index entries</span> — MEMORY.md links to{' '}
          {lint.orphans.length} file{lint.orphans.length > 1 ? 's' : ''} that no longer exist:{' '}
          <span className="font-mono">{lint.orphans.join(', ')}</span>
        </Row>
      )}

      {lint.unindexed.length > 0 && (
        <Row tone="warn" icon={FileWarning}>
          <span className="font-medium">Unindexed files</span> — {lint.unindexed.length} memory file
          {lint.unindexed.length > 1 ? 's are' : ' is'} not listed in MEMORY.md:
          <div className="mt-1 flex flex-wrap gap-1.5">
            {lint.unindexed.map((f) => (
              <button
                key={f.relPath}
                onClick={() => onOpen(f.relPath)}
                className="rounded border border-border px-1.5 py-0.5 hover:bg-accent"
              >
                {f.name}
              </button>
            ))}
          </div>
        </Row>
      )}

      {lint.brokenLinkFiles.length > 0 && (
        <Row tone="warn" icon={Link2Off}>
          <span className="font-medium">Broken wikilinks</span> in {lint.brokenLinkFiles.length}{' '}
          file
          {lint.brokenLinkFiles.length > 1 ? 's' : ''}:
          <div className="mt-1 space-y-1">
            {lint.brokenLinkFiles.map(({ file, broken }) => (
              <div key={file.relPath} className="flex items-center gap-1.5 flex-wrap">
                <button
                  onClick={() => onOpen(file.relPath)}
                  className="rounded border border-border px-1.5 py-0.5 hover:bg-accent"
                >
                  {file.name}
                </button>
                <span className="font-mono text-muted-foreground">→ {broken.join(', ')}</span>
              </div>
            ))}
          </div>
        </Row>
      )}
    </div>
  )
}
