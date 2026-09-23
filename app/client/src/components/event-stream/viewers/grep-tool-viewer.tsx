import { useMemo, useState } from 'react'
import { Search, ChevronDown, ChevronRight } from 'lucide-react'

interface GrepToolViewerProps {
  pattern: string
  path?: string
  glob?: string
  ignoreCase?: boolean
  literal?: boolean
  context?: number
  limit?: number
  /** Tool output with any trailing notice already split off. */
  output: string | null
  notice?: string | null
}

interface GrepLine {
  file: string
  line: number
  content: string
  /** Context lines (`path-N- text`) vs. matches (`path:N: text`). */
  isMatch: boolean
}

// pi's grep prints matches as "path:N: text" and, with `context`, the
// surrounding lines as "path-N- text" (grep.js formatBlock).
const LINE_RE = /^(.+?)([:-])(\d+)\2 ?(.*)$/

function parseGrepOutput(raw: string): { lines: GrepLine[]; remainder: string[] } {
  const lines: GrepLine[] = []
  const remainder: string[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) {
      continue
    }
    const m = LINE_RE.exec(line)
    if (m) {
      lines.push({ file: m[1], line: parseInt(m[3], 10), content: m[4], isMatch: m[2] === ':' })
    } else {
      remainder.push(line)
    }
  }
  return { lines, remainder }
}

const LINES_COLLAPSED = 30

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function GrepToolViewer({
  pattern,
  path,
  glob,
  ignoreCase,
  literal,
  context,
  limit,
  output,
  notice,
}: GrepToolViewerProps) {
  const parsed = useMemo(() => parseGrepOutput(output ?? ''), [output])
  const [expanded, setExpanded] = useState(false)
  const matchCount = parsed.lines.filter((l) => l.isMatch).length
  const shown = expanded ? parsed.lines : parsed.lines.slice(0, LINES_COLLAPSED)
  const canCollapse = parsed.lines.length > LINES_COLLAPSED

  const highlightRe = useMemo(() => {
    if (!pattern) {
      return null
    }
    try {
      return new RegExp(literal ? escapeRegExp(pattern) : pattern, ignoreCase ? 'gi' : 'g')
    } catch {
      return null
    }
  }, [pattern, ignoreCase, literal])

  const noMatches = output?.trim() === 'No matches found'

  return (
    <div className="overflow-hidden rounded border border-border bg-muted/40">
      <div className="flex items-center gap-2 border-b border-border bg-muted/60 px-2 py-1">
        <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="truncate font-mono text-[11px] text-foreground">/{pattern}/</span>
        {ignoreCase && <Flag>ignoreCase</Flag>}
        {literal && <Flag>literal</Flag>}
        <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {matchCount > 0 ? `${matchCount} match${matchCount === 1 ? '' : 'es'}` : 'no matches'}
        </span>
      </div>
      {(path || glob || context != null || limit != null) && (
        <div className="flex gap-3 border-b border-border/60 px-2 py-1 font-mono text-[10px] text-muted-foreground">
          {path && <span>path: {path}</span>}
          {glob && <span>glob: {glob}</span>}
          {context != null && <span>context: {context}</span>}
          {limit != null && <span>limit: {limit}</span>}
        </div>
      )}
      <div className="max-h-96 overflow-auto font-mono text-[11px]">
        {shown.map((l, i) => (
          <GrepRow key={i} line={l} highlightRe={l.isMatch ? highlightRe : null} />
        ))}
        {canCollapse && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="flex w-full cursor-pointer items-center gap-1 border-t border-border/50 px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {expanded ? (
              <ChevronDown className="h-2.5 w-2.5" />
            ) : (
              <ChevronRight className="h-2.5 w-2.5" />
            )}
            {expanded ? 'collapse' : `show ${parsed.lines.length - LINES_COLLAPSED} more`}
          </button>
        )}
        {parsed.remainder.length > 0 && !noMatches && (
          <div className="whitespace-pre-wrap border-t border-border/50 px-2 py-1 text-muted-foreground/80">
            {parsed.remainder.join('\n')}
          </div>
        )}
        {(output == null ||
          noMatches ||
          (output && parsed.lines.length === 0 && !parsed.remainder.length)) && (
          <div className="px-2 py-2 text-[11px] italic text-muted-foreground/70">
            {output == null ? 'No output captured.' : 'No matches found'}
          </div>
        )}
      </div>
      {notice && (
        <div className="border-t border-border/60 px-2 py-1 font-mono text-[10px] text-muted-foreground">
          {notice}
        </div>
      )}
    </div>
  )
}

function Flag({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 rounded bg-background/60 px-1 py-[1px] text-[9px] text-muted-foreground">
      {children}
    </span>
  )
}

function GrepRow({ line, highlightRe }: { line: GrepLine; highlightRe: RegExp | null }) {
  const parts = useMemo(() => {
    if (!highlightRe) {
      return [{ text: line.content, hit: false }]
    }
    const out: { text: string; hit: boolean }[] = []
    let lastIdx = 0
    const re = new RegExp(highlightRe.source, highlightRe.flags)
    let m: RegExpExecArray | null
    while ((m = re.exec(line.content))) {
      if (m.index > lastIdx) {
        out.push({ text: line.content.slice(lastIdx, m.index), hit: false })
      }
      out.push({ text: m[0], hit: true })
      lastIdx = m.index + m[0].length
      if (m[0].length === 0) {
        re.lastIndex++
      }
    }
    if (lastIdx < line.content.length) {
      out.push({ text: line.content.slice(lastIdx), hit: false })
    }
    return out
  }, [line.content, highlightRe])

  return (
    <div
      className={`flex gap-2 border-b border-border/30 px-2 py-0.5 hover:bg-foreground/[0.03] ${
        line.isMatch ? '' : 'opacity-60'
      }`}
    >
      <span className="max-w-[40%] shrink-0 truncate text-blue-600 dark:text-blue-400">
        {line.file}
      </span>
      <span className="shrink-0 tabular-nums text-muted-foreground/60">:{line.line}</span>
      <span className="min-w-0 flex-1 overflow-hidden whitespace-pre text-foreground/80">
        {parts.map((p, i) =>
          p.hit ? (
            <span key={i} className="rounded bg-yellow-500/30 px-[1px] text-foreground">
              {p.text}
            </span>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
      </span>
    </div>
  )
}
