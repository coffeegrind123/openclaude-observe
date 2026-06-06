import * as React from 'react'
import Markdown from 'react-markdown'
import { cn } from '@/lib/utils'

interface MemoryMarkdownProps {
  body: string
  /** Called when a [[wikilink]] is clicked, with the link's target stem. */
  onNavigate?: (stem: string) => void
  /** Stems that resolve to an existing file — rendered as live links. */
  knownStems?: Set<string>
  className?: string
}

const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g

/**
 * Rewrite `[[target|label]]` into a markdown link with a `wikilink:` scheme so
 * react-markdown renders it; the custom `a` renderer turns those into buttons.
 * Escapes parens in the target to keep the generated markdown well-formed.
 */
function rewriteWikilinks(body: string): string {
  return body.replace(WIKILINK_RE, (_m, target: string, label?: string) => {
    const stem = target.trim()
    const text = (label ?? stem).trim()
    const enc = encodeURIComponent(stem)
    return `[${text}](wikilink:${enc})`
  })
}

const mdComponents = (
  onNavigate?: (stem: string) => void,
  knownStems?: Set<string>,
): React.ComponentProps<typeof Markdown>['components'] => ({
  h1: ({ children, ...props }) => (
    <h1 className="text-xl font-semibold mt-5 first:mt-0 mb-2" {...props}>
      {children}
    </h1>
  ),
  h2: ({ children, ...props }) => (
    <h2 className="text-lg font-semibold mt-5 first:mt-0 mb-2" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }) => (
    <h3 className="text-base font-semibold mt-4 mb-1.5" {...props}>
      {children}
    </h3>
  ),
  p: ({ children, ...props }) => (
    <p className="text-sm leading-relaxed mb-3 text-foreground/90" {...props}>
      {children}
    </p>
  ),
  ul: ({ children, ...props }) => (
    <ul className="list-disc pl-5 space-y-1 mb-3 text-sm" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol className="list-decimal pl-5 space-y-1 mb-3 text-sm" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li className="text-sm leading-relaxed" {...props}>
      {children}
    </li>
  ),
  code: ({ children, className, ...props }) => (
    <code
      className={cn(
        'rounded bg-muted px-1 py-0.5 font-mono text-[0.8125rem] text-foreground',
        className,
      )}
      {...props}
    >
      {children}
    </code>
  ),
  pre: ({ children, ...props }) => (
    <pre
      className="rounded-md bg-muted p-3 overflow-x-auto text-[0.8125rem] mb-3 font-mono"
      {...props}
    >
      {children}
    </pre>
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote
      className="border-l-2 border-border pl-3 italic text-muted-foreground mb-3"
      {...props}
    >
      {children}
    </blockquote>
  ),
  hr: (props) => <hr className="my-4 border-border" {...props} />,
  a: ({ href, children, ...props }) => {
    if (href?.startsWith('wikilink:')) {
      const stem = decodeURIComponent(href.slice('wikilink:'.length))
      const known = knownStems?.has(stem.toLowerCase())
      return (
        <button
          type="button"
          onClick={() => onNavigate?.(stem)}
          className={cn(
            'inline rounded px-1 -mx-0.5 font-medium transition-colors',
            known
              ? 'text-primary hover:bg-primary/10'
              : 'text-amber-600 dark:text-amber-400 hover:bg-amber-500/10',
          )}
          title={known ? `Go to ${stem}` : `${stem} (no matching file)`}
        >
          {children}
        </button>
      )
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-primary underline underline-offset-2 hover:opacity-80"
        {...props}
      >
        {children}
      </a>
    )
  },
})

export function MemoryMarkdown({ body, onNavigate, knownStems, className }: MemoryMarkdownProps) {
  const rewritten = React.useMemo(() => rewriteWikilinks(body), [body])
  const components = React.useMemo(
    () => mdComponents(onNavigate, knownStems),
    [onNavigate, knownStems],
  )
  return (
    <div className={cn('max-w-none', className)}>
      <Markdown components={components}>{rewritten}</Markdown>
    </div>
  )
}
