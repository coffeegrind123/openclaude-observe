import { useMemo } from 'react'
import { agentClassFor } from '@/agents/registry'
import type { ParsedEvent } from '@/types'

interface EventTickerProps {
  events: ParsedEvent[] | undefined
  loading: boolean
}

const MAX_ROWS = 14
const MAX_SUMMARY_CHARS = 90

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/**
 * The row's label and one-liner come from the event's agent class, the same
 * text the stream shows (pi: tool name + its real arguments, LLM tokens,
 * prompts), rather than guessing at payload fields here.
 */
function describe(e: ParsedEvent): { tool: string; summary: string } {
  const cls = agentClassFor(e)
  const tool = cls.toolLabel(e) ?? cls.label(e)
  const summary = cls.summary(e) || e.subtype || e.type
  return { tool, summary: summary.replace(/\s+/g, ' ').slice(0, MAX_SUMMARY_CHARS) }
}

/** Live-ish event feed for the focused session (newest at the bottom). */
export function EventTicker({ events, loading }: EventTickerProps) {
  // Newest first → with column-reverse layout the latest row sits at the bottom.
  const rows = useMemo(() => {
    if (!events) {
      return []
    }
    return [...events].sort((a, b) => b.timestamp - a.timestamp).slice(0, MAX_ROWS)
  }, [events])

  return (
    <div className="cst-panel cst-ticker">
      <div className="cst-ticker-h">
        <b>recent events</b>
        <span className="cst-ticker-live">live</span>
      </div>
      <div className="cst-ticker-feed">
        {rows.length === 0 ? (
          <div className="cst-ticker-empty">{loading ? 'Loading events…' : 'No events yet.'}</div>
        ) : (
          rows.map((e) => {
            const { tool, summary } = describe(e)
            return (
              <div className="cst-ev" key={e.id}>
                <span className="cst-ev-ts">{fmtTime(e.timestamp)}</span>
                <span className="cst-ev-sum">{summary}</span>
                <span className="cst-ev-tool">{tool}</span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
