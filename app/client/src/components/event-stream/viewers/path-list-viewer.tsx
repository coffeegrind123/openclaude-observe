import { useState } from 'react'
import { ChevronDown, ChevronRight, Folder, File } from 'lucide-react'

interface PathListViewerProps {
  /** Header text, e.g. "find **\/*.ts in src" or "ls src". */
  title: string
  icon: React.ReactNode
  /** One path per line, as the tool returned them. */
  output: string | null
  /** Result text when there are no entries ("No files found matching pattern", "(empty directory)"). */
  emptyText?: string
  notice?: string | null
}

const ENTRIES_COLLAPSED = 40

/** Renders find / ls results: one entry per line, directories end in "/". */
export function PathListViewer({ title, icon, output, emptyText, notice }: PathListViewerProps) {
  const [expanded, setExpanded] = useState(false)
  const raw = output ?? ''
  const isEmpty = raw.trim() === '' || (emptyText != null && raw.trim() === emptyText)
  const entries = isEmpty ? [] : raw.split('\n').filter((l) => l.trim().length > 0)
  const shown = expanded ? entries : entries.slice(0, ENTRIES_COLLAPSED)

  return (
    <div className="overflow-hidden rounded border border-border bg-muted/40">
      <div className="flex items-center gap-2 border-b border-border bg-muted/60 px-2 py-1">
        {icon}
        <span className="truncate font-mono text-[11px] text-foreground">{title}</span>
        <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {entries.length} entr{entries.length === 1 ? 'y' : 'ies'}
        </span>
      </div>
      <div className="max-h-80 overflow-auto font-mono text-[11px]">
        {shown.map((e, i) => {
          const isDir = e.endsWith('/')
          return (
            <div key={i} className="flex items-center gap-1.5 px-2 py-[1px]">
              {isDir ? (
                <Folder className="h-3 w-3 shrink-0 text-amber-600 dark:text-amber-400" />
              ) : (
                <File className="h-3 w-3 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{e}</span>
            </div>
          )
        })}
        {entries.length > ENTRIES_COLLAPSED && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="flex w-full cursor-pointer items-center gap-1 border-t border-border/50 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
          >
            {expanded ? (
              <ChevronDown className="h-2.5 w-2.5" />
            ) : (
              <ChevronRight className="h-2.5 w-2.5" />
            )}
            {expanded ? 'collapse' : `show ${entries.length - ENTRIES_COLLAPSED} more`}
          </button>
        )}
        {isEmpty && (
          <div className="px-2 py-2 text-[11px] italic text-muted-foreground/70">
            {output == null ? 'No output captured.' : raw.trim() || 'No entries'}
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
