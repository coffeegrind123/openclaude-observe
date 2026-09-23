// Building blocks shared by every agent class's EventDetail body: labelled
// rows, copyable code/markdown blocks, badges, collapsible long text.

import { useState } from 'react'
import Markdown from 'react-markdown'
import { Copy, Check, FileText, Code, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export function DetailRow({
  label,
  value,
  mono,
  title,
}: {
  label: string
  value?: React.ReactNode
  mono?: boolean
  title?: string
}) {
  if (value == null || value === '' || value === false) {
    return null
  }
  return (
    <div className="flex gap-2">
      <span className="w-24 shrink-0 text-right text-muted-foreground">{label}:</span>
      <span className={cn('min-w-0 truncate', mono && 'font-mono')} title={title}>
        {value}
      </span>
    </div>
  )
}

const BADGE_TONES = {
  accent: 'bg-primary/15 text-primary',
  info: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  purple: 'bg-purple-500/15 text-purple-700 dark:text-purple-400',
  ok: 'bg-green-500/15 text-green-700 dark:text-green-400',
  warn: 'bg-amber-500/20 text-amber-700 dark:text-amber-400',
  fail: 'bg-red-500/15 text-red-700 dark:text-red-400',
  muted: 'bg-muted text-muted-foreground',
} as const

export type BadgeTone = keyof typeof BADGE_TONES

export function Badge({
  children,
  tone = 'muted',
  title,
}: {
  children: React.ReactNode
  tone?: BadgeTone
  title?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium',
        BADGE_TONES[tone],
      )}
      title={title}
    >
      {children}
    </span>
  )
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  )
}

// react-markdown builds an AST several times the source size and React holds
// it until the row collapses; past this size render as plain text instead.
const MAX_MARKDOWN_SIZE = 50_000

/** Heuristic: does the text carry enough markdown signals to be worth rendering? */
export function looksLikeMarkdown(s: string): boolean {
  if (s.length > MAX_MARKDOWN_SIZE) {
    return false
  }
  const trimmed = s.trimStart()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return false
  }
  const markers = [
    /^#{1,6}\s/m,
    /\*\*.+?\*\*/,
    /^[-*]\s/m,
    /^\d+\.\s/m,
    /```/,
    /`[^`]+`/,
    /\[.+?\]\(.+?\)/,
    /^\s*>/m,
  ]
  let hits = 0
  for (const re of markers) {
    if (re.test(s)) {
      hits++
    }
    if (hits >= 2) {
      return true
    }
  }
  return false
}

const mdComponents = {
  h1: ({ children, ...props }: React.ComponentProps<'h1'>) => (
    <h1 className="mb-1.5 mt-3 text-xs font-bold text-foreground first:mt-0" {...props}>
      {children}
    </h1>
  ),
  h2: ({ children, ...props }: React.ComponentProps<'h2'>) => (
    <h2 className="mb-1.5 mt-3 text-xs font-bold text-foreground first:mt-0" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }: React.ComponentProps<'h3'>) => (
    <h3 className="mb-1 mt-2 text-[11px] font-semibold first:mt-0" {...props}>
      {children}
    </h3>
  ),
  p: ({ children, ...props }: React.ComponentProps<'p'>) => (
    <p className="mb-1.5 leading-relaxed last:mb-0" {...props}>
      {children}
    </p>
  ),
  ul: ({ children, ...props }: React.ComponentProps<'ul'>) => (
    <ul className="mb-1.5 list-disc space-y-1 pl-4" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }: React.ComponentProps<'ol'>) => (
    <ol className="mb-1.5 list-decimal space-y-1 pl-4" {...props}>
      {children}
    </ol>
  ),
  code: ({ children, className, ...props }: React.ComponentProps<'code'>) => {
    if (className?.includes('language-')) {
      return (
        <code
          className="my-1.5 block overflow-x-auto rounded border border-border/50 bg-black/20 p-1.5 font-mono text-[10px] leading-relaxed dark:bg-white/10"
          {...props}
        >
          {children}
        </code>
      )
    }
    return (
      <code
        className="rounded border border-border/40 bg-black/10 px-1 py-0.5 font-mono text-[10px] text-amber-700 dark:bg-white/10 dark:text-amber-400"
        {...props}
      >
        {children}
      </code>
    )
  },
  a: ({ children, ...props }: React.ComponentProps<'a'>) => (
    <a
      className="text-blue-600 underline underline-offset-2 dark:text-blue-400"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      {children}
    </a>
  ),
}

/** Renders unified-diff-ish text with coloured +/- lines. */
export function DiffPre({ value, maxHeight = 'max-h-60' }: { value: string; maxHeight?: string }) {
  return (
    <pre
      className={cn(
        'overflow-auto rounded bg-muted/50 p-1.5 font-mono text-[10px] leading-relaxed',
        maxHeight,
      )}
    >
      {value.split('\n').map((line, i) => {
        let cls = ''
        if (line.startsWith('+') && !line.startsWith('+++')) {
          cls = 'bg-green-500/10 text-green-600 dark:text-green-400'
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          cls = 'bg-red-500/10 text-red-600 dark:text-red-400'
        } else if (line.startsWith('@@')) {
          cls = 'text-blue-600 dark:text-blue-400'
        }
        return (
          <div key={i} className={cls}>
            {line || ' '}
          </div>
        )
      })}
    </pre>
  )
}

export function CopyButton({ text, label = true }: { text: string; label?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="flex cursor-pointer items-center gap-1 text-[9px] text-muted-foreground/70 transition-colors hover:text-muted-foreground"
      onClick={(e) => {
        e.stopPropagation()
        void navigator.clipboard?.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? (
        <>
          {label && 'Copied'} <Check className="h-2.5 w-2.5 text-green-500" />
        </>
      ) : (
        <>
          {label && 'Copy'} <Copy className="h-2.5 w-2.5" />
        </>
      )}
    </button>
  )
}

/** Labelled, copyable block; markdown-looking text renders as markdown with a raw toggle. */
export function DetailCode({
  label,
  value,
  tone,
  maxHeight = 'max-h-40',
}: {
  label: string
  value?: string | null
  tone?: 'fail'
  maxHeight?: string
}) {
  const hasMd = !!value && looksLikeMarkdown(value)
  const [showRaw, setShowRaw] = useState(!hasMd)
  if (!value) {
    return null
  }
  return (
    <div className="flex gap-2">
      <span className="w-24 shrink-0 text-right text-muted-foreground">{label}:</span>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center gap-1">
          {hasMd && (
            <button
              type="button"
              className="flex cursor-pointer items-center gap-1 text-[9px] text-muted-foreground/70 transition-colors hover:text-muted-foreground"
              onClick={() => setShowRaw(!showRaw)}
            >
              {showRaw ? <Code className="h-2.5 w-2.5" /> : <FileText className="h-2.5 w-2.5" />}
              {showRaw ? 'raw' : 'markdown'}
            </button>
          )}
          <span className="ml-auto">
            <CopyButton text={value} />
          </span>
        </div>
        {showRaw ? (
          <pre
            className={cn(
              'overflow-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-1.5 font-mono text-[10px] leading-relaxed',
              maxHeight,
              tone === 'fail' && 'text-red-700 dark:text-red-400',
            )}
          >
            {value}
          </pre>
        ) : (
          <div
            className={cn(
              'overflow-y-auto rounded bg-muted/50 p-1.5 text-[11px] leading-relaxed',
              maxHeight,
            )}
          >
            <Markdown components={mdComponents}>{value}</Markdown>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Long text that stays collapsed until asked for — a header with size
 * figures, expanding to the full copyable text.
 */
export function CollapsibleText({
  title,
  text,
  meta,
  defaultOpen = false,
  note,
}: {
  title: string
  text: string
  meta?: React.ReactNode
  defaultOpen?: boolean
  note?: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="overflow-hidden rounded border border-border bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-2 px-2 py-1 text-left hover:bg-muted/50"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <span className="shrink-0 text-[11px] font-medium">{title}</span>
        {meta && <span className="shrink-0 text-[10px] text-muted-foreground">{meta}</span>}
        <span className="ml-auto">
          <CopyButton text={text} label={false} />
        </span>
      </button>
      {open && (
        <div className="border-t border-border">
          {note && <div className="px-2 pt-1 text-[10px] text-muted-foreground">{note}</div>}
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-[10px] leading-relaxed">
            {text}
          </pre>
        </div>
      )}
    </div>
  )
}

/** Horizontal stacked bar for token breakdowns. */
export function StackedBar({
  parts,
}: {
  parts: { label: string; value: number; className: string }[]
}) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1
  return (
    <div className="space-y-1">
      <div className="flex h-2.5 overflow-hidden rounded bg-muted/50">
        {parts.map((p) => (
          <div
            key={p.label}
            className={p.className}
            style={{ width: `${(p.value / total) * 100}%` }}
            title={`${p.label}: ${p.value.toLocaleString()}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-3 text-[9px] text-muted-foreground">
        {parts.map((p) => (
          <span key={p.label}>
            <span className={cn('mr-0.5 inline-block h-2 w-2 rounded-sm', p.className)} />
            {p.label}
          </span>
        ))}
      </div>
    </div>
  )
}
