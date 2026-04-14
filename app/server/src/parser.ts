// app/server/src/parser.ts
// Extracts structural fields from raw JSONL events.
// NO formatting, NO truncation, NO summary generation — that's the client's job.

export interface ParsedRawEvent {
  projectName: string | null
  sessionId: string
  slug: string | null
  transcriptPath: string | null
  type: string
  subtype: string | null
  toolName: string | null
  toolUseId: string | null
  timestamp: number
  // The agent this event belongs to (from payload.agent_id — present on subagent hook events)
  ownerAgentId: string | null
  // The subagent being spawned/stopped (from Agent tool response or SubagentStop)
  subAgentId: string | null
  subAgentName: string | null
  subAgentDescription: string | null
  instanceId: string | null
  metadata: Record<string, unknown>
  raw: Record<string, unknown>
}

export function parseRawEvent(raw: Record<string, unknown>): ParsedRawEvent {
  const projectName = (raw.project_name as string) || null
  const sessionId = (raw.session_id as string) || 'unknown'
  const slug = (raw.slug as string) || null
  const transcriptPath = (raw.transcript_path as string) || null
  const meta = raw.meta as Record<string, unknown> | undefined
  const timestamp = parseTimestamp(meta?.timestamp ?? raw.timestamp)
  const toolUseId = (raw.tool_use_id as string) || null
  // agent_id is present on hook events fired from subagents
  const ownerAgentId = (raw.agent_id as string) || null

  let type: string
  let subtype: string | null = null
  let toolName: string | null = null
  let subAgentId: string | null = null
  let subAgentName: string | null = null
  let subAgentDescription: string | null = null

  const hookEventName = raw.hook_event_name as string | undefined
  const hookToolName = raw.tool_name as string | undefined
  const toolInput = raw.tool_input as Record<string, unknown> | undefined

  if (hookEventName) {
    switch (hookEventName) {
      case 'SessionStart':
        type = 'session'
        subtype = 'SessionStart'
        break
      case 'Stop':
        type = 'system'
        subtype = 'Stop'
        break
      case 'UserPromptSubmit':
        type = 'user'
        subtype = 'UserPromptSubmit'
        break
      case 'PreToolUse':
        type = 'tool'
        subtype = 'PreToolUse'
        toolName = hookToolName || null
        if (toolName === 'Agent') {
          subAgentName = (toolInput?.name as string) || null
          subAgentDescription = (toolInput?.description as string) || null
        }
        break
      case 'PostToolUse':
        type = 'tool'
        subtype = 'PostToolUse'
        toolName = hookToolName || null
        if (toolName === 'Agent') {
          const toolResponse = raw.tool_response as Record<string, unknown> | undefined
          if (toolResponse) {
            subAgentId = (toolResponse.agentId as string) || null
            subAgentName = (toolInput?.name as string) || null
            subAgentDescription = (toolInput?.description as string) || null
          }
        }
        break
      case 'PostToolUseFailure':
        type = 'tool'
        subtype = 'PostToolUseFailure'
        toolName = hookToolName || null
        break
      case 'ToolBatch':
        type = 'tool'
        subtype = 'ToolBatch'
        break
      case 'LLMGeneration':
        type = 'llm'
        subtype = 'LLMGeneration'
        break
      case 'CompactionRun':
        type = 'system'
        subtype = 'CompactionRun'
        break
      case 'CostUpdate':
        type = 'system'
        subtype = 'CostUpdate'
        break
      case 'SubagentStart':
        type = 'system'
        subtype = 'SubagentStart'
        subAgentId = (raw.agent_id as string) || null
        break
      case 'SubagentStop':
        type = 'system'
        subtype = 'SubagentStop'
        subAgentId = (raw.agent_id as string) || null
        break
      case 'DaemonStart':
        type = 'daemon'
        subtype = 'DaemonStart'
        break
      case 'DaemonStop':
        type = 'daemon'
        subtype = 'DaemonStop'
        break
      case 'DaemonHeartbeat':
        type = 'daemon'
        subtype = 'DaemonHeartbeat'
        break
      case 'PipeRoleAssigned':
        type = 'pipe'
        subtype = 'PipeRoleAssigned'
        break
      case 'PipeAttach':
        type = 'pipe'
        subtype = 'PipeAttach'
        break
      case 'PipeDetach':
        type = 'pipe'
        subtype = 'PipeDetach'
        break
      case 'PipePromptRouted':
        type = 'pipe'
        subtype = 'PipePromptRouted'
        break
      case 'PipePermissionForward':
        type = 'pipe'
        subtype = 'PipePermissionForward'
        break
      case 'PipeLanPeerDiscovered':
        type = 'pipe'
        subtype = 'PipeLanPeerDiscovered'
        break
      case 'CoordinatorDispatch':
        type = 'coordinator'
        subtype = 'CoordinatorDispatch'
        break
      case 'CoordinatorResult':
        type = 'coordinator'
        subtype = 'CoordinatorResult'
        break
      case 'BridgeConnected':
        type = 'bridge'
        subtype = 'BridgeConnected'
        break
      case 'BridgeDisconnected':
        type = 'bridge'
        subtype = 'BridgeDisconnected'
        break
      case 'BridgeWorkReceived':
        type = 'bridge'
        subtype = 'BridgeWorkReceived'
        break
      case 'SuperModeToggle':
        type = 'system'
        subtype = 'SuperModeToggle'
        break
      case 'Notification':
        type = 'system'
        subtype = 'Notification'
        break
      default:
        type = 'system'
        subtype = hookEventName
        break
    }
  } else {
    type = (raw.type as string) || 'unknown'
    if (raw.subtype) {
      subtype = raw.subtype as string
    }
  }

  const metadata: Record<string, unknown> = {}
  for (const key of [
    'version',
    'gitBranch',
    'cwd',
    'entrypoint',
    'permissionMode',
    'userType',
    'permission_mode',
    'model',
    'provider',
    'input_tokens',
    'output_tokens',
    'cache_read_tokens',
    'cache_creation_tokens',
    'ttft_ms',
    'duration_ms',
    'instance_id',
    'instance_role',
  ]) {
    if (raw[key] !== undefined) metadata[key] = raw[key]
  }

  const instanceId = (raw.instance_id as string) || null

  return {
    projectName,
    sessionId,
    slug,
    transcriptPath,
    type,
    subtype,
    toolName,
    toolUseId,
    timestamp,
    ownerAgentId,
    subAgentId,
    subAgentName,
    subAgentDescription,
    instanceId,
    metadata,
    raw,
  }
}

function parseTimestamp(ts: unknown): number {
  if (typeof ts === 'number') return ts
  if (typeof ts === 'string') {
    const parsed = new Date(ts).getTime()
    return isNaN(parsed) ? Date.now() : parsed
  }
  return Date.now()
}
