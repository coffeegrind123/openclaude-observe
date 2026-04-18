import { useState } from 'react'
import { Terminal, Copy, Check } from 'lucide-react'
import { highlight } from './syntax-highlight'
import './syntax-highlight.css'

interface BashToolViewerProps {
  toolInput: Record<string, unknown>
  toolResponse: Record<string, unknown> | string | undefined
  cwd: string | undefined
  durationMs?: number
}

// Extract stdout/stderr/exit from the Bash tool_response. Shape varies:
//  - { stdout, stderr, exit_code }
//  - { content: string, is_error }
//  - plain string
function extractBashResult(toolResponse: BashToolViewerProps['toolResponse']): {
  stdout: string
  stderr: string
  exitCode: number | null
} {
  if (!toolResponse) return { stdout: '', stderr: '', exitCode: null }
  if (typeof toolResponse === 'string') {
    return { stdout: toolResponse, stderr: '', exitCode: null }
  }
  const r = toolResponse as Record<string, any>
  const stdout = typeof r.stdout === 'string' ? r.stdout : ''
  const stderr = typeof r.stderr === 'string' ? r.stderr : ''
  let exitCode: number | null =
    typeof r.exit_code === 'number'
      ? r.exit_code
      : typeof r.exitCode === 'number'
        ? r.exitCode
        : null
  if (!stdout && !stderr) {
    // Fallback: some responses collapse into a single content blob
    const content = typeof r.content === 'string' ? r.content : ''
    const isError = r.is_error === true || r.isError === true
    if (exitCode == null && isError) exitCode = 1
    if (isError) return { stdout: '', stderr: content, exitCode }
    return { stdout: content, stderr: '', exitCode }
  }
  return { stdout, stderr, exitCode }
}

export function BashToolViewer({ toolInput, toolResponse, cwd, durationMs }: BashToolViewerProps) {
  const command = (toolInput.command as string) || ''
  const description = toolInput.description as string | undefined
  const { stdout, stderr, exitCode } = extractBashResult(toolResponse)

  const [copiedCmd, setCopiedCmd] = useState(false)
  const copyCmd = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopiedCmd(true)
      setTimeout(() => setCopiedCmd(false), 1200)
    } catch {}
  }

  const exitOk = exitCode === 0 || (exitCode == null && !stderr)
  const exitLabel = exitCode != null ? `exit ${exitCode}` : stderr ? 'exit ?' : null

  // Highlight command as bash for nice keyword/string colors
  const cmdHtml = highlight(command, 'bash')

  return (
    <div className="space-y-1.5">
      {description && <div className="text-[10px] text-muted-foreground italic">{description}</div>}
      <div className="overflow-hidden rounded border border-border bg-muted/40">
        <div className="flex items-center gap-2 px-2 py-1 bg-muted/60 border-b border-border">
          <Terminal className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="font-mono text-[11px] text-foreground">bash</span>
          {exitLabel && (
            <span
              className={`shrink-0 rounded px-1 py-[1px] text-[9px] font-medium ${
                exitOk
                  ? 'bg-green-500/15 text-green-700 dark:text-green-400'
                  : 'bg-red-500/15 text-red-700 dark:text-red-400'
              }`}
            >
              {exitLabel}
            </span>
          )}
          {durationMs != null && (
            <span className="shrink-0 text-[9px] text-muted-foreground tabular-nums">
              {(durationMs / 1000).toFixed(2)}s
            </span>
          )}
          {cwd && (
            <span
              className="shrink-0 text-[9px] text-muted-foreground/70 font-mono truncate max-w-[200px]"
              title={cwd}
            >
              {cwd}
            </span>
          )}
          <button
            type="button"
            onClick={copyCmd}
            className="ml-auto flex items-center gap-1 text-[9px] text-muted-foreground/70 hover:text-foreground transition-colors cursor-pointer"
            title="Copy command"
          >
            {copiedCmd ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
          </button>
        </div>

        <div className="font-mono text-[11px] leading-[1.5]">
          <div className="flex items-start gap-2 px-2 py-1 bg-background/30">
            <span className="select-none text-muted-foreground/60 shrink-0">$</span>
            <span
              className="whitespace-pre-wrap break-all flex-1"
              dangerouslySetInnerHTML={{ __html: cmdHtml }}
            />
          </div>

          {stdout && (
            <div className="border-t border-border/60 px-2 py-1 whitespace-pre-wrap break-all max-h-80 overflow-auto">
              <div className="text-[9px] text-muted-foreground/70 mb-0.5 uppercase tracking-wide">
                stdout
              </div>
              {stdout}
            </div>
          )}

          {stderr && (
            <div className="border-t border-border/60 px-2 py-1 whitespace-pre-wrap break-all max-h-80 overflow-auto text-red-700 dark:text-red-400">
              <div className="text-[9px] text-red-600/70 dark:text-red-400/70 mb-0.5 uppercase tracking-wide">
                stderr
              </div>
              {stderr}
            </div>
          )}

          {!stdout && !stderr && (
            <div className="border-t border-border/60 px-2 py-1 text-muted-foreground/70 italic">
              (no output)
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
