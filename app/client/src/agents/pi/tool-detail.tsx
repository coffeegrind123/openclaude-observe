// Detail bodies for pi tool calls. Input comes from the PreToolUse
// `tool_input`; the result from the PostToolUse / PostToolUseFailure
// `tool_response: { content, details }` (see tools.ts for the shapes).

import { FolderSearch, FolderOpen } from 'lucide-react'
import type { ParsedEvent } from '@/types'
import type { EventDetailProps } from '../types'
import {
  asText,
  bool,
  formatMs,
  formatTokens,
  num,
  obj,
  relPath,
  str,
  type Payload,
} from '../payload'
import {
  editsOf,
  mcpArgs,
  mcpCallSummary,
  parseBashOutput,
  piToolKind,
  splitNotice,
  splitReadOutput,
  toolResult,
  truncationOf,
  type PiToolResult,
  type PiTruncation,
} from './tools'
import { AgentLink } from '../agent-link'
import { Badge, DetailCode, DetailRow } from '@/components/event-stream/detail-parts'
import { ReadToolViewer } from '@/components/event-stream/viewers/read-tool-viewer'
import { EditToolViewer } from '@/components/event-stream/viewers/edit-tool-viewer'
import { WriteToolViewer } from '@/components/event-stream/viewers/write-tool-viewer'
import { BashToolViewer } from '@/components/event-stream/viewers/bash-tool-viewer'
import { GrepToolViewer } from '@/components/event-stream/viewers/grep-tool-viewer'
import { PathListViewer } from '@/components/event-stream/viewers/path-list-viewer'

interface ToolCall {
  toolName: string | null
  input: Payload
  /** Null while the call is still running. */
  result: PiToolResult | null
  isError: boolean
  error: string | null
  durationMs: number | undefined
  cwd: string | undefined
}

/** Merge the Pre / Post halves of a tool row into one view of the call. */
function toolCallOf(event: ParsedEvent, paired: EventDetailProps['pairedPayloads']): ToolCall {
  const pre = paired?.pre.payload as Payload | undefined
  const post = (paired?.post?.payload ??
    (event.subtype !== 'PreToolUse' ? event.payload : null)) as Payload | null
  // A merged row's own payload is the Post's; a pending row's is the Pre's.
  const own = event.payload as Payload
  const input = obj(pre?.tool_input) ?? obj(post?.tool_input) ?? obj(own.tool_input) ?? {}
  const isError =
    post?.is_error === true ||
    paired?.post?.subtype === 'PostToolUseFailure' ||
    event.subtype === 'PostToolUseFailure'
  return {
    toolName: event.toolName ?? str(own.tool_name) ?? null,
    input,
    result: post ? toolResult(post) : null,
    isError,
    error: str(post?.error) ?? null,
    durationMs: num(post?.duration_ms),
    cwd: str(own.cwd) ?? str(pre?.cwd),
  }
}

function truncationNote(t: PiTruncation | null): string | null {
  if (!t) {
    return null
  }
  const shown =
    t.outputLines != null && t.totalLines != null
      ? `${t.outputLines} of ${t.totalLines} lines`
      : null
  return `Output truncated${t.truncatedBy ? ` by ${t.truncatedBy}` : ''}${shown ? ` (${shown})` : ''}`
}

export function PiToolDetail(props: EventDetailProps) {
  const call = toolCallOf(props.event, props.pairedPayloads)
  const kind = piToolKind(call.toolName)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="info">{call.toolName ?? 'tool'}</Badge>
        {call.result == null ? (
          <Badge tone="warn">running</Badge>
        ) : call.isError ? (
          <Badge tone="fail">failed</Badge>
        ) : (
          <Badge tone="ok">ok</Badge>
        )}
        {call.durationMs != null && <Badge>{formatMs(call.durationMs)}</Badge>}
      </div>
      <ToolBody call={call} kind={kind} props={props} />
    </div>
  )
}

function ToolBody({
  call,
  kind,
  props,
}: {
  call: ToolCall
  kind: ReturnType<typeof piToolKind>
  props: EventDetailProps
}) {
  const { input, result, cwd } = call
  const path = str(input.path)
  const display = (p: string | undefined) => relPath(p, cwd)

  switch (kind) {
    case 'read': {
      const split = result && !call.isError ? splitReadOutput(result.content) : null
      return (
        <>
          <ReadToolViewer
            path={path ?? ''}
            displayPath={display(path)}
            offset={num(input.offset)}
            limit={num(input.limit)}
            content={split ? split.content : null}
            notice={split?.notice ?? truncationNote(truncationOf(result?.details ?? null))}
          />
          {call.isError && (
            <DetailCode label="Error" value={call.error ?? result?.content} tone="fail" />
          )}
        </>
      )
    }

    case 'bash': {
      const parsed = result ? parseBashOutput(result.content, call.isError) : null
      const details = result?.details ?? null
      return (
        <BashToolViewer
          command={str(input.command) ?? ''}
          timeoutSec={num(input.timeout)}
          output={parsed ? parsed.output : null}
          exitCode={parsed?.exitCode ?? null}
          status={parsed ? parsed.status : 'pending'}
          statusLine={parsed?.statusLine}
          durationMs={call.durationMs}
          cwd={cwd}
          fullOutputPath={str(details?.fullOutputPath)}
          truncationNote={truncationNote(truncationOf(details))}
        />
      )
    }

    case 'edit': {
      const details = result?.details ?? null
      return (
        <>
          <EditToolViewer
            path={path ?? ''}
            displayPath={display(path)}
            edits={editsOf(input)}
            resultDiff={str(details?.diff)}
            firstChangedLine={num(details?.firstChangedLine)}
          />
          {result && (
            <DetailCode
              label={call.isError ? 'Error' : 'Result'}
              value={result.content}
              tone={call.isError ? 'fail' : undefined}
            />
          )}
        </>
      )
    }

    case 'write':
      return (
        <>
          <WriteToolViewer
            path={path ?? ''}
            displayPath={display(path)}
            content={typeof input.content === 'string' ? input.content : null}
            resultText={call.isError ? null : result?.content}
          />
          {call.isError && (
            <DetailCode label="Error" value={call.error ?? result?.content} tone="fail" />
          )}
        </>
      )

    case 'grep': {
      const split = result ? splitNotice(result.content) : null
      const details = result?.details ?? null
      const limitHit = num(details?.matchLimitReached)
      return (
        <>
          <GrepToolViewer
            pattern={str(input.pattern) ?? ''}
            path={path ? display(path) : undefined}
            glob={str(input.glob)}
            ignoreCase={bool(input.ignoreCase)}
            literal={bool(input.literal)}
            context={num(input.context)}
            limit={num(input.limit)}
            output={call.isError ? null : (split?.content ?? null)}
            notice={
              split?.notice ?? (limitHit != null ? `${limitHit} matches limit reached` : null)
            }
          />
          {details?.linesTruncated === true && (
            <div className="text-[10px] text-muted-foreground">Some long lines were truncated.</div>
          )}
          {call.isError && (
            <DetailCode label="Error" value={call.error ?? result?.content} tone="fail" />
          )}
        </>
      )
    }

    case 'find':
    case 'ls': {
      const split = result ? splitNotice(result.content) : null
      const where = path ? display(path) : '.'
      const title = kind === 'find' ? `${str(input.pattern) ?? ''} in ${where}` : where
      return (
        <>
          <PathListViewer
            title={title + (num(input.limit) != null ? ` (limit ${num(input.limit)})` : '')}
            icon={
              kind === 'find' ? (
                <FolderSearch className="h-3 w-3 shrink-0 text-muted-foreground" />
              ) : (
                <FolderOpen className="h-3 w-3 shrink-0 text-muted-foreground" />
              )
            }
            output={call.isError ? null : (split?.content ?? null)}
            emptyText={kind === 'find' ? 'No files found matching pattern' : '(empty directory)'}
            notice={split?.notice}
          />
          {call.isError && (
            <DetailCode label="Error" value={call.error ?? result?.content} tone="fail" />
          )}
        </>
      )
    }

    case 'spawn':
      return <SpawnToolBody call={call} props={props} />

    case 'stop-agent':
      return (
        <div className="space-y-1.5">
          <DetailRow label="Agent ID" value={str(input.agent_id)} mono />
          <DetailCode
            label={call.isError ? 'Error' : 'Result'}
            value={result?.content}
            tone={call.isError ? 'fail' : undefined}
          />
        </div>
      )

    case 'agent-status':
      return <DetailCode label="Status" value={result?.content} />

    case 'mcp': {
      const args = mcpArgs(input)
      const details = result?.details ?? null
      return (
        <div className="space-y-1.5">
          <DetailRow label="Call" value={mcpCallSummary(input)} mono />
          <DetailRow label="Server" value={str(input.server)} />
          {args && <DetailCode label="Args" value={asText(args)} />}
          {input.regex === true && <DetailRow label="Regex" value="yes" />}
          <DetailRow label="Limit" value={num(input.limit)?.toString()} />
          <DetailRow label="Offset" value={num(input.offset)?.toString()} />
          <DetailRow label="Mode" value={str(details?.mode)} />
          <DetailRow label="Error code" value={str(details?.error)} />
          <DetailCode
            label={call.isError ? 'Error' : 'Result'}
            value={result?.content}
            tone={call.isError ? 'fail' : undefined}
            maxHeight="max-h-80"
          />
        </div>
      )
    }

    case 'mcp-script': {
      const details = result?.details ?? null
      return (
        <div className="space-y-1.5">
          <DetailCode label="Script" value={str(input.code)} maxHeight="max-h-80" />
          <DetailRow
            label="Timeout"
            value={num(input.timeoutMs) != null ? `${num(input.timeoutMs)}ms` : undefined}
          />
          <DetailRow label="Error code" value={str(details?.error)} />
          <DetailCode
            label={call.isError ? 'Error' : 'Output'}
            value={result?.content}
            tone={call.isError ? 'fail' : undefined}
            maxHeight="max-h-80"
          />
        </div>
      )
    }

    case 'browser':
    case 'other': {
      const details = result?.details ?? null
      return (
        <div className="space-y-1.5">
          {kind === 'browser' && (
            <DetailRow label="Server" value={str(details?.server) ?? 'browser'} />
          )}
          <ArgRows input={input} />
          <DetailRow label="Error code" value={str(details?.error)} />
          <DetailCode
            label={call.isError ? 'Error' : 'Result'}
            value={result?.content}
            tone={call.isError ? 'fail' : undefined}
            maxHeight="max-h-80"
          />
          {details && kind === 'other' && <DetailCode label="Details" value={asText(details)} />}
        </div>
      )
    }
  }
}

/** One row per argument: scalars inline, structures as JSON blocks. */
function ArgRows({ input }: { input: Payload }) {
  const entries = Object.entries(input).filter(([k]) => !k.startsWith('_'))
  if (entries.length === 0) {
    return <DetailRow label="Args" value="(none)" />
  }
  return (
    <>
      {entries.map(([k, v]) =>
        v !== null && typeof v === 'object' ? (
          <DetailCode key={k} label={k} value={asText(v)} />
        ) : typeof v === 'string' && v.includes('\n') ? (
          <DetailCode key={k} label={k} value={v} />
        ) : (
          <DetailRow key={k} label={k} value={String(v)} mono />
        ),
      )}
    </>
  )
}

// pi-subagents-lite `Agent` / `SubAgent`. Result details come from
// buildAgentDetails (agents/tool-execution.ts): type, description, and for a
// finished foreground run turnCount, maxTurns, toolUses, input, output,
// contextPercent, durationMs, compactions, modelName, modelId, thinkingLevel,
// cost; background spawns set `background: true` and return at once.
function SpawnToolBody({ call, props }: { call: ToolCall; props: EventDetailProps }) {
  const { input, result } = call
  const d = result?.details ?? null
  const spawnedId = props.spawnedAgentId ?? str((props.event.payload as Payload).spawned_agent_id)
  const spawned = spawnedId ? props.agentMap.get(spawnedId) : undefined
  const verification = str(d?.verification)

  return (
    <div className="space-y-1.5">
      {spawnedId ? (
        <AgentLink
          label="Spawned"
          agentId={spawnedId}
          agent={spawned}
          fallbackName={props.spawnedInfo?.agentName}
          jumpEventId={props.spawnedInfo?.startEventId}
          jumpLabel="start"
        />
      ) : (
        <DetailRow
          label="Spawned"
          value={result ? 'no linked subagent' : 'waiting for SubagentStart…'}
        />
      )}
      <DetailRow
        label="Agent type"
        value={str(input.agent) ?? str(input._resolvedAgent) ?? str(d?.type)}
      />
      <DetailRow label="Task" value={str(input.description) ?? str(d?.description)} />
      <DetailRow label="Model" value={str(input.model) ?? str(d?.modelId)} mono />
      <DetailRow
        label="Background"
        value={input.run_in_background === true || d?.background === true ? 'yes' : undefined}
      />
      <DetailRow label="Worktree" value={str(input.worktree_path) ?? str(d?.worktreePath)} mono />
      <DetailCode label="Prompt" value={str(input.prompt)} />
      {d && <SpawnStats d={d} />}
      {verification && (
        <DetailRow
          label="Verification"
          value={
            <Badge
              tone={
                verification === 'passed' || verification === 'repaired'
                  ? 'ok'
                  : verification === 'failed' || verification === 'errored'
                    ? 'fail'
                    : 'muted'
              }
            >
              {verification}
            </Badge>
          }
        />
      )}
      <DetailCode
        label={call.isError ? 'Error' : 'Answer'}
        value={result?.content}
        tone={call.isError ? 'fail' : undefined}
        maxHeight="max-h-80"
      />
    </div>
  )
}

function SpawnStats({ d }: { d: Payload }) {
  const turns = num(d.turnCount)
  const maxTurns = num(d.maxTurns)
  const ctxPct = num(d.contextPercent)
  const cost = num(d.cost)
  const verifyIn = num(d.verifyInput)
  return (
    <div className="space-y-1">
      <DetailRow
        label="Turns"
        value={turns != null ? `${turns}${maxTurns != null ? ` / ${maxTurns}` : ''}` : undefined}
      />
      <DetailRow label="Tool uses" value={num(d.toolUses)?.toString()} />
      <DetailRow
        label="Tokens"
        value={
          num(d.input) != null || num(d.output) != null
            ? `in ${formatTokens(num(d.input))} · out ${formatTokens(num(d.output))}`
            : undefined
        }
      />
      <DetailRow label="Context" value={ctxPct != null ? `${ctxPct.toFixed(1)}%` : undefined} />
      <DetailRow
        label="Duration"
        value={num(d.durationMs) != null ? formatMs(num(d.durationMs)) : undefined}
      />
      <DetailRow label="Compactions" value={num(d.compactions)?.toString()} />
      <DetailRow label="Ran on" value={str(d.modelName) ?? str(d.modelId)} title={str(d.modelId)} />
      <DetailRow label="Thinking" value={str(d.thinkingLevel)} />
      <DetailRow
        label="Cost"
        value={cost != null && cost > 0 ? `$${cost.toFixed(4)}` : undefined}
      />
      <DetailRow label="Status" value={str(d.status)} />
      <DetailRow label="Stop reason" value={str(d.stopReason)} />
      <DetailRow
        label="Verify cost"
        value={
          verifyIn != null
            ? `in ${formatTokens(verifyIn)} · out ${formatTokens(num(d.verifyOutput))}${num(d.verifyCost) ? ` · $${num(d.verifyCost)!.toFixed(4)}` : ''}`
            : undefined
        }
      />
    </div>
  )
}
