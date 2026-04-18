import { useMemo } from 'react'
import { Pencil } from 'lucide-react'
import { detectLanguage, getBaseName } from './lang-detect'
import { highlight } from './syntax-highlight'
import './syntax-highlight.css'

interface DiffViewerProps {
  fileName: string
  oldString: string
  newString: string
  maxHeight?: string
}

interface DiffLine {
  type: 'context' | 'added' | 'removed'
  content: string
  oldNo: number | null
  newNo: number | null
}

function lcsDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  const m = oldLines.length
  const n = newLines.length

  // Bail on pathological inputs (unchanged or empty) — LCS on 0×N is trivial.
  if (m === 0)
    return newLines.map((l, i) => ({ type: 'added', content: l, oldNo: null, newNo: i + 1 }))
  if (n === 0)
    return oldLines.map((l, i) => ({ type: 'removed', content: l, oldNo: i + 1, newNo: null }))

  // LCS length matrix
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        oldLines[i - 1] === newLines[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  // Backtrack
  const out: DiffLine[] = []
  let i = m
  let j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      out.push({ type: 'context', content: oldLines[i - 1], oldNo: i, newNo: j })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      out.push({ type: 'added', content: newLines[j - 1], oldNo: null, newNo: j })
      j--
    } else {
      out.push({ type: 'removed', content: oldLines[i - 1], oldNo: i, newNo: null })
      i--
    }
  }
  return out.reverse()
}

export function DiffViewer({
  fileName,
  oldString,
  newString,
  maxHeight = 'max-h-96',
}: DiffViewerProps) {
  const diff = useMemo(
    () => lcsDiff(oldString.split('\n'), newString.split('\n')),
    [oldString, newString],
  )
  const language = detectLanguage(fileName)

  const stats = useMemo(() => {
    let added = 0
    let removed = 0
    for (const l of diff) {
      if (l.type === 'added') added++
      else if (l.type === 'removed') removed++
    }
    return { added, removed }
  }, [diff])

  const gutterWidth = useMemo(() => {
    const maxNo = diff.reduce((m, l) => Math.max(m, l.oldNo ?? 0, l.newNo ?? 0), 0)
    return String(maxNo).length + 1
  }, [diff])

  return (
    <div className="overflow-hidden rounded border border-border bg-muted/40">
      <div className="flex items-center gap-2 px-2 py-1 bg-muted/60 border-b border-border">
        <Pencil className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="truncate font-mono text-[11px] text-foreground" title={fileName}>
          {getBaseName(fileName)}
        </span>
        {language && (
          <span className="shrink-0 rounded bg-background/60 px-1 py-[1px] text-[9px] font-medium text-muted-foreground uppercase tracking-wide">
            {language}
          </span>
        )}
        <span className="shrink-0 text-[9px] font-mono">
          {stats.added > 0 && (
            <span className="text-green-600 dark:text-green-400 mr-1">+{stats.added}</span>
          )}
          {stats.removed > 0 && (
            <span className="text-red-600 dark:text-red-400">-{stats.removed}</span>
          )}
          {stats.added === 0 && stats.removed === 0 && (
            <span className="text-muted-foreground">unchanged</span>
          )}
        </span>
      </div>
      <div className={`overflow-auto font-mono text-[11px] leading-[1.45] ${maxHeight}`}>
        <div className="inline-block min-w-full">
          {diff.map((line, idx) => (
            <DiffLineRow key={idx} line={line} language={language} gutterWidth={gutterWidth} />
          ))}
        </div>
      </div>
    </div>
  )
}

function DiffLineRow({
  line,
  language,
  gutterWidth,
}: {
  line: DiffLine
  language: string | null
  gutterWidth: number
}) {
  const isAdded = line.type === 'added'
  const isRemoved = line.type === 'removed'

  const rowClass = isAdded
    ? 'bg-green-500/10 border-l-2 border-l-green-500/60'
    : isRemoved
      ? 'bg-red-500/10 border-l-2 border-l-red-500/60'
      : 'border-l-2 border-l-transparent'

  const textClass = isAdded
    ? 'text-green-700 dark:text-green-300'
    : isRemoved
      ? 'text-red-700 dark:text-red-300'
      : 'text-foreground/80'

  const prefix = isAdded ? '+' : isRemoved ? '-' : ' '

  // Highlight the raw content when present. In diff context the prefix is
  // rendered separately so the highlighter sees clean source.
  const html = line.content ? highlight(line.content, language) : '&nbsp;'

  return (
    <div className={`flex min-w-full ${rowClass}`}>
      <span
        className="shrink-0 select-none px-1.5 py-0 text-right tabular-nums text-muted-foreground/60 bg-muted/20"
        style={{ minWidth: `${gutterWidth}ch` }}
      >
        {line.oldNo ?? ''}
      </span>
      <span
        className="shrink-0 select-none px-1.5 py-0 text-right tabular-nums text-muted-foreground/60 bg-muted/20 border-r border-border/50"
        style={{ minWidth: `${gutterWidth}ch` }}
      >
        {line.newNo ?? ''}
      </span>
      <span className={`shrink-0 select-none px-1 ${textClass}`}>{prefix}</span>
      <span
        className={`flex-1 whitespace-pre pr-2 ${textClass}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
