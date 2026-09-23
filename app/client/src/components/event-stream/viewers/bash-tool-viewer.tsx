import { useState } from 'react'
import { Terminal, Copy, Check } from 'lucide-react'
import { highlight } from './syntax-highlight'
import './syntax-highlight.css'

// 'unknown': the event carries the command but no result (a user `!cmd`).
export type BashStatus = 'ok' | 'exit' | 'timeout' | 'aborted' | 'error' | 'pending' | 'unknown'

interface BashToolViewerProps {
  command: string
  /** Timeout argument in seconds, when given. */
  timeoutSec?: number
  /** Combined stdout+stderr as the tool returned it (pi merges both streams). */
  output: string | null
  exitCode: number | null
  status: BashStatus
  /** The tool's status line ("Command exited with code 1", …). */
  statusLine?: string | null
  durationMs?: number
  cwd?: string
  /** Where the tool saved the untruncated output (details.fullOutputPath). */
  fullOutputPath?: string | null
  truncationNote?: string | null
  /** Header label, e.g. "bash" or "!bash" for a user shell escape. */
  shellLabel?: string
}

export function BashToolViewer({
  command,
  timeoutSec,
  output,
  exitCode,
  status,
  statusLine,
  durationMs,
  cwd,
  fullOutputPath,
  truncationNote,
  shellLabel = 'bash',
}: BashToolViewerProps) {
  const [copiedCmd, setCopiedCmd] = useState(false)
  const copyCmd = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopiedCmd(true)
      setTimeout(() => setCopiedCmd(false), 1200)
    } catch {
      // Clipboard can be unavailable (insecure context); the command is still selectable.
    }
  }

  const failed = status !== 'ok' && status !== 'pending' && status !== 'unknown'
  const statusLabel =
    status === 'ok'
      ? 'exit 0'
      : status === 'exit'
        ? `exit ${exitCode}`
        : status === 'timeout'
          ? 'timed out'
          : status === 'aborted'
            ? 'aborted'
            : status === 'error'
              ? 'failed'
              : status === 'unknown'
                ? 'result not captured'
                : 'running'

  return (
    <div className="space-y-1.5">
      <div className="overflow-hidden rounded border border-border bg-muted/40">
        <div className="flex items-center gap-2 border-b border-border bg-muted/60 px-2 py-1">
          <Terminal className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="font-mono text-[11px] text-foreground">{shellLabel}</span>
          <span
            className={`shrink-0 rounded px-1 py-[1px] text-[9px] font-medium ${
              failed
                ? 'bg-red-500/15 text-red-700 dark:text-red-400'
                : status === 'unknown'
                  ? 'bg-muted text-muted-foreground'
                  : status === 'pending'
                    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                    : 'bg-green-500/15 text-green-700 dark:text-green-400'
            }`}
            data-testid="bash-status"
          >
            {statusLabel}
          </span>
          {durationMs != null && (
            <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground">
              {(durationMs / 1000).toFixed(2)}s
            </span>
          )}
          {timeoutSec != null && (
            <span className="shrink-0 text-[9px] text-muted-foreground">timeout {timeoutSec}s</span>
          )}
          {cwd && (
            <span
              className="max-w-[200px] shrink-0 truncate font-mono text-[9px] text-muted-foreground/70"
              title={cwd}
            >
              {cwd}
            </span>
          )}
          <button
            type="button"
            onClick={copyCmd}
            className="ml-auto flex cursor-pointer items-center gap-1 text-[9px] text-muted-foreground/70 transition-colors hover:text-foreground"
            title="Copy command"
          >
            {copiedCmd ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
          </button>
        </div>

        <div className="font-mono text-[11px] leading-[1.5]">
          <div className="flex items-start gap-2 bg-background/30 px-2 py-1">
            <span className="shrink-0 select-none text-muted-foreground/60">$</span>
            <span
              className="flex-1 whitespace-pre-wrap break-all"
              dangerouslySetInnerHTML={{ __html: highlight(command, 'bash') }}
            />
          </div>

          {output ? (
            <div
              className={`max-h-80 overflow-auto whitespace-pre-wrap break-all border-t border-border/60 px-2 py-1 ${
                failed ? 'text-red-700 dark:text-red-400' : ''
              }`}
            >
              {output}
            </div>
          ) : (
            status !== 'pending' &&
            status !== 'unknown' && (
              <div className="border-t border-border/60 px-2 py-1 italic text-muted-foreground/70">
                (no output)
              </div>
            )
          )}

          {statusLine && (
            <div className="border-t border-border/60 px-2 py-1 text-[10px] text-red-700 dark:text-red-400">
              {statusLine}
            </div>
          )}
        </div>
      </div>
      {truncationNote && (
        <div className="text-[10px] text-muted-foreground">
          {truncationNote}
          {fullOutputPath && (
            <>
              {' '}
              · full output: <span className="font-mono">{fullOutputPath}</span>
            </>
          )}
        </div>
      )}
    </div>
  )
}
