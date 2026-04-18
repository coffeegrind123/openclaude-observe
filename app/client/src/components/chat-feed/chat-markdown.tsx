import Markdown from 'react-markdown'
import type { Components } from 'react-markdown'

const components: Components = {
  h1: ({ children, ...props }) => (
    <h1 className="text-sm font-bold mt-2 first:mt-0 mb-1.5 text-foreground" {...props}>
      {children}
    </h1>
  ),
  h2: ({ children, ...props }) => (
    <h2 className="text-sm font-bold mt-2 first:mt-0 mb-1.5 text-foreground" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }) => (
    <h3 className="text-xs font-semibold mt-2 first:mt-0 mb-1 text-foreground" {...props}>
      {children}
    </h3>
  ),
  h4: ({ children, ...props }) => (
    <h4 className="text-xs font-semibold mt-1.5 first:mt-0 mb-1 text-foreground" {...props}>
      {children}
    </h4>
  ),
  p: ({ children, ...props }) => (
    <p className="mb-1.5 last:mb-0 leading-relaxed whitespace-pre-wrap break-words" {...props}>
      {children}
    </p>
  ),
  strong: ({ children, ...props }) => (
    <strong className="font-semibold text-foreground" {...props}>
      {children}
    </strong>
  ),
  em: ({ children, ...props }) => (
    <em className="italic" {...props}>
      {children}
    </em>
  ),
  ul: ({ children, ...props }) => (
    <ul className="list-disc pl-4 space-y-0.5 mb-1.5 last:mb-0" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol className="list-decimal pl-4 space-y-0.5 mb-1.5 last:mb-0" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li className="leading-relaxed" {...props}>
      {children}
    </li>
  ),
  code: ({ children, className, ...props }) => {
    const isBlock = className?.includes('language-')
    if (isBlock) {
      return (
        <code
          className="block bg-black/20 dark:bg-white/10 border border-border/50 rounded p-1.5 font-mono text-[11px] leading-relaxed overflow-x-auto my-1.5 whitespace-pre"
          {...props}
        >
          {children}
        </code>
      )
    }
    return (
      <code
        className="bg-black/10 dark:bg-white/10 border border-border/40 rounded px-1 py-0.5 font-mono text-[11px] text-amber-700 dark:text-amber-400 break-words"
        {...props}
      >
        {children}
      </code>
    )
  },
  pre: ({ children, ...props }) => (
    <pre className="overflow-x-auto my-1.5" {...props}>
      {children}
    </pre>
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote
      className="border-l-2 border-primary/40 pl-2.5 text-muted-foreground italic my-1.5"
      {...props}
    >
      {children}
    </blockquote>
  ),
  a: ({ children, ...props }) => (
    <a
      className="text-blue-600 dark:text-blue-400 underline underline-offset-2 decoration-blue-600/30 dark:decoration-blue-400/30 hover:decoration-blue-600 dark:hover:decoration-blue-400 break-all"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      {children}
    </a>
  ),
  hr: (props) => <hr className="my-2 border-border/50" {...props} />,
  table: ({ children, ...props }) => (
    <div className="overflow-x-auto my-1.5">
      <table className="border-collapse text-[11px]" {...props}>
        {children}
      </table>
    </div>
  ),
  th: ({ children, ...props }) => (
    <th className="border border-border/50 px-1.5 py-0.5 font-semibold text-left" {...props}>
      {children}
    </th>
  ),
  td: ({ children, ...props }) => (
    <td className="border border-border/50 px-1.5 py-0.5 align-top" {...props}>
      {children}
    </td>
  ),
}

export function ChatMarkdown({ text }: { text: string }) {
  return <Markdown components={components}>{text}</Markdown>
}
