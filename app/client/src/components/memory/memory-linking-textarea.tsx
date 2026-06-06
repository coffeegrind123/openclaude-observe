import * as React from 'react'
import { cn } from '@/lib/utils'

export interface LinkTarget {
  stem: string
  title: string
}

interface LinkingTextareaProps {
  value: string
  onChange: (next: string) => void
  targets: LinkTarget[]
  placeholder?: string
  className?: string
  spellCheck?: boolean
}

/** Detect an open `[[query` immediately before the caret (no closing ]] yet). */
function activeQuery(value: string, caret: number): { query: string; start: number } | null {
  const before = value.slice(0, caret)
  const open = before.lastIndexOf('[[')
  if (open === -1) return null
  const between = before.slice(open + 2)
  // Abort if the link was already closed or spans lines / contains ].
  if (between.includes(']') || between.includes('\n') || between.includes('[')) return null
  return { query: between, start: open + 2 }
}

/**
 * A textarea with `[[wikilink]]` autocomplete. When the caret sits inside an
 * open `[[…`, a dropdown of matching memory files appears; Enter/Tab inserts
 * `stem]]`. Used for both the structured body editor and the raw editor.
 */
export function LinkingTextarea({
  value,
  onChange,
  targets,
  placeholder,
  className,
  spellCheck,
}: LinkingTextareaProps) {
  const ref = React.useRef<HTMLTextAreaElement>(null)
  const [caret, setCaret] = React.useState(0)
  const [sel, setSel] = React.useState(0)

  const active = React.useMemo(() => activeQuery(value, caret), [value, caret])
  const candidates = React.useMemo(() => {
    if (!active) return []
    const q = active.query.toLowerCase()
    return targets
      .filter((t) => t.stem.toLowerCase().includes(q) || t.title.toLowerCase().includes(q))
      .slice(0, 8)
  }, [active, targets])

  React.useEffect(() => {
    setSel(0)
  }, [active?.query])

  const syncCaret = () => {
    if (ref.current) setCaret(ref.current.selectionStart ?? 0)
  }

  const insert = (stem: string) => {
    if (!active) return
    const next = value.slice(0, active.start) + stem + ']]' + value.slice(caret)
    onChange(next)
    const newCaret = active.start + stem.length + 2
    requestAnimationFrame(() => {
      if (ref.current) {
        ref.current.focus()
        ref.current.setSelectionRange(newCaret, newCaret)
        setCaret(newCaret)
      }
    })
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!active || candidates.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(s + 1, candidates.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      insert(candidates[sel].stem)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setCaret(-1) // collapse the dropdown without moving the caret
    }
  }

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setCaret(e.target.selectionStart ?? 0)
        }}
        onKeyDown={onKeyDown}
        onKeyUp={syncCaret}
        onClick={syncCaret}
        onSelect={syncCaret}
        spellCheck={spellCheck}
        placeholder={placeholder}
        className={className}
      />
      {active && candidates.length > 0 && (
        <div className="absolute left-2 bottom-2 z-20 w-72 max-h-56 overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
          <div className="px-2 py-1 text-[0.65rem] text-muted-foreground border-b border-border">
            Link to memory — ↵ insert
          </div>
          {candidates.map((c, i) => (
            <button
              key={c.stem}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                insert(c.stem)
              }}
              onMouseEnter={() => setSel(i)}
              className={cn(
                'w-full text-left px-2 py-1.5',
                i === sel ? 'bg-accent' : 'hover:bg-accent/60',
              )}
            >
              <div className="text-xs font-medium truncate">{c.title}</div>
              <div className="font-mono text-[0.65rem] text-muted-foreground truncate">
                {c.stem}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
