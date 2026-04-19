// Client-side summary generation from event payload.
// NO truncation — the UI handles that via CSS.

import type { ParsedEvent } from '@/types'

// Valid binary name: alphanumeric, hyphens, dots, underscores — no shell special chars
const VALID_BINARY_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

/** Extract the binary/command name from a bash command string, skipping env vars, cd, and shell keywords. */
export function extractBashBinary(cmd: string): string | null {
  // Take first line only (multi-line commands)
  const first = cmd.split('\n')[0].trim()
  const tokens = first.split(/\s+/)
  let skipNext = false
  for (const token of tokens) {
    if (skipNext) {
      skipNext = false
      continue
    }
    // Skip env vars (FOO=bar), shell operators, subshell markers
    if (token.includes('=') || token === '&&' || token === ';' || token === '||') continue
    if (token.startsWith('$(') || token.startsWith('`')) continue
    if (token === 'cd') {
      skipNext = true // skip the directory argument
      continue
    }
    // Skip shell keywords that aren't binaries
    if (
      token === 'for' ||
      token === 'do' ||
      token === 'done' ||
      token === 'if' ||
      token === 'then' ||
      token === 'else' ||
      token === 'fi' ||
      token === 'while' ||
      token === 'case' ||
      token === 'esac'
    )
      continue
    // Strip path prefix to get just the binary name
    const bin = token.replace(/^.*\//, '')
    // Validate: must look like a real binary name
    if (bin && VALID_BINARY_RE.test(bin)) return bin
  }
  return null
}

export function getEventSummary(event: ParsedEvent): string {
  const p = event.payload as Record<string, any>
  const cwd = p.cwd as string | undefined

  switch (event.subtype) {
    case 'UserPromptSubmit':
      return oneLine(p.prompt || p.message?.content || '')

    case 'SessionStart':
      return p.source ? `Session ${p.source}` : 'New session'

    case 'SessionEnd':
      return 'Session ended'

    case 'Stop':
      return getStopSummary(event)

    case 'StopFailure': {
      const msg = p.last_assistant_message as string | undefined
      return msg ? `Turn failed: ${oneLine(msg)}` : 'Turn failed'
    }

    case 'SubagentStart':
      return p.agent_name || p.description || 'Subagent started'

    case 'SubagentStop':
      return p.agent_name || 'Subagent stopped'

    case 'Notification':
      return oneLine(p.message || p.title || '')

    case 'PreToolUse':
    case 'PostToolUse':
      return getToolSummary(event.toolName, p.tool_input, cwd)

    case 'PostToolUseFailure':
      return oneLine(p.error || getToolSummary(event.toolName, p.tool_input, cwd) || 'Tool failed')

    case 'PermissionRequest': {
      const tool = p.tool_name as string | undefined
      const desc = p.tool_input?.description as string | undefined
      if (tool && desc) return `${tool}: ${oneLine(desc)}`
      if (tool) return tool
      return 'Permission requested'
    }

    case 'TaskCreated':
      return oneLine(p.description || p.task_description || '')

    case 'TaskCompleted':
      return oneLine(p.description || p.task_description || 'Task done')

    case 'TeammateIdle':
      return p.teammate_name || 'Teammate idle'

    case 'InstructionsLoaded':
      return p.file_path ? relativePath(p.file_path, cwd) : 'Instructions loaded'

    case 'ConfigChange':
      return p.file_path ? relativePath(p.file_path, cwd) : 'Config changed'

    case 'CwdChanged':
      return p.new_cwd || p.cwd || 'Directory changed'

    case 'FileChanged':
      return p.file_path ? relativePath(p.file_path, cwd) : 'File changed'

    case 'PreCompact':
      return 'Compacting context...'

    case 'PostCompact':
      return 'Context compacted'

    case 'Elicitation':
      return oneLine(p.message || p.question || 'MCP input requested')

    case 'ElicitationResult':
      return oneLine(p.response || p.result || 'User responded')

    case 'WorktreeCreate':
      return p.branch || p.path || 'Worktree created'

    case 'WorktreeRemove':
      return p.branch || p.path || 'Worktree removed'

    case 'PermissionDenied': {
      const tool = p.tool_name as string | undefined
      return tool ? `Denied: ${tool}` : 'Permission denied'
    }

    case 'LLMGeneration': {
      // Prefer upstream-reported actual_model when proxies re-route (z.ai,
      // OpenRouter, LiteLLM) so summary text matches what actually ran.
      const model = (p.actual_model as string | undefined) ?? (p.model as string | undefined)
      const inp = p.input_tokens as number | undefined
      const out = p.output_tokens as number | undefined
      if (model && inp != null && out != null) return `${model} | in:${inp} out:${out}`
      return model || 'LLM call'
    }

    case 'SuperModeToggle':
      return p.enabled ? 'Super mode ON' : 'Super mode OFF'

    case 'DaemonStart':
      return `Started: ${p.workerName || 'worker'}`
    case 'DaemonStop':
      return `Stopped: ${p.workerName || 'worker'}`
    case 'DaemonHeartbeat':
      return p.workerName || 'Heartbeat'

    case 'PipeRoleAssigned':
      return `Role: ${p.role || 'unknown'}`
    case 'PipeAttach':
      return `${p.masterName || '?'} ↔ ${p.slaveName || '?'}`
    case 'PipeDetach':
      return `Detached: ${p.slaveName || '?'}`
    case 'PipePromptRouted':
      return oneLine(p.promptPreview || p.targets || '')
    case 'PipePermissionForward':
      return `${p.toolName || 'tool'} → ${p.slaveName || '?'}`
    case 'PipeLanPeerDiscovered':
      return `${p.peerName || 'peer'} at ${p.ip || '?'}`

    case 'CoordinatorDispatch':
      return oneLine(p.taskSummary || p.workerId || 'Dispatched')
    case 'CoordinatorResult':
      return oneLine(p.resultPreview || p.workerId || 'Result')

    case 'BridgeConnected':
      return 'Bridge connected'
    case 'BridgeDisconnected':
      return p.reason ? `Disconnected: ${oneLine(p.reason)}` : 'Bridge disconnected'
    case 'BridgeWorkReceived':
      return p.workId || 'Work received'

    case 'CostUpdate':
      return 'Cost updated'
    case 'CompactionRun':
      return 'Compaction run'

    default:
      return ''
  }
}

function getToolSummary(
  toolName: string | null,
  toolInput: Record<string, any> | undefined,
  cwd: string | undefined,
): string {
  if (!toolInput) return ''

  switch (toolName) {
    case 'Bash': {
      const desc = toolInput.description as string | undefined
      const cmd = toolInput.command as string | undefined
      // Extract the binary name as a prefix to quickly see what's being run
      const bin = cmd ? extractBashBinary(cmd) : null
      const binPrefix = bin ? `[${bin}] ` : ''
      if (desc) return `${binPrefix}${desc}`
      return cmd ? `${binPrefix}${cmd.replace(/\s*\n\s*/g, ' \\n ').trim()}` : ''
    }
    case 'Read':
    case 'Write':
      return relativePath(toolInput.file_path, cwd)
    case 'Edit': {
      const fp = relativePath(toolInput.file_path, cwd)
      // Show what was changed if available
      const oldStr = toolInput.old_string as string | undefined
      if (fp && oldStr) return `${fp}`
      return fp
    }
    case 'Grep': {
      const pattern = toolInput.pattern
      const path = toolInput.path
      const rp = path ? relativePath(path, cwd) : ''
      if (pattern && rp) return `/${pattern}/ in ${rp}`
      if (pattern) return `/${pattern}/`
      return ''
    }
    case 'Glob':
      return toolInput.pattern || ''
    case 'Agent':
      return toolInput.description || toolInput.prompt || ''
    case 'Skill':
      return toolInput.skill || ''
    case 'WebSearch':
    case 'WebFetch':
      return toolInput.query || toolInput.url || ''
    case 'NotebookEdit':
      return relativePath(toolInput.notebook_path, cwd)
    default:
      return toolInput.description || toolInput.command || toolInput.query || ''
  }
}

function getStopSummary(event: ParsedEvent): string {
  const p = event.payload as Record<string, any>
  const lastMsg = p.last_assistant_message as string | undefined

  if (lastMsg) return `Final: "${oneLine(lastMsg)}"`
  return 'Session stopped'
}

// Collapse newlines/whitespace into a single line, strip markdown
function oneLine(s: string): string {
  return s
    .replace(/\*\*(.*?)\*\*/g, '$1') // **bold** → bold
    .replace(/`([^`]+)`/g, '$1') // `code` → code
    .replace(/^[-*] /gm, '') // strip list markers
    .replace(/\s*\n\s*/g, ' ')
    .trim()
}

// Strip cwd prefix to show relative paths
function relativePath(fp: string | undefined, cwd: string | undefined): string {
  if (!fp) return ''
  if (cwd && fp.startsWith(cwd)) {
    const rel = fp.slice(cwd.length)
    // Remove leading slash
    return rel.startsWith('/') ? rel.slice(1) : rel
  }
  return fp
}
