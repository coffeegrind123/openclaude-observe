// Detail bodies for every pi event in docs/pi-protocol.md.

import type { EventDetailProps } from '../types'
import {
  asText,
  estimateTokens,
  formatMs,
  formatTokens,
  isToolSubtype,
  num,
  obj,
  str,
  type Payload,
} from '../payload'
import { PiToolDetail } from './tool-detail'
import {
  cacheHitPct,
  isBurstResponse,
  isSubagentEvent,
  llmFailed,
  tokensPerSecond,
} from './describe'
import { AgentLink } from '../agent-link'
import {
  Badge,
  CollapsibleText,
  DetailCode,
  DetailRow,
  SectionLabel,
  StackedBar,
} from '@/components/event-stream/detail-parts'
import { ThinkingBlock } from '@/components/event-stream/thinking-block'
import { BashToolViewer } from '@/components/event-stream/viewers/bash-tool-viewer'

export function PiEventDetail(props: EventDetailProps) {
  const { event } = props
  const p = event.payload as Payload

  if (isToolSubtype(event.subtype)) {
    return <PiToolDetail {...props} />
  }

  switch (event.subtype) {
    case 'SessionStart':
      return (
        <div className="space-y-1">
          <DetailRow label="Source" value={str(p.source)} />
          <DetailRow label="Model" value={str(p.model)} mono />
          <DetailRow label="Provider" value={str(p.provider)} />
          <DetailRow label="Thinking" value={str(p.thinking_level) ?? 'default'} />
          <DetailRow
            label="Context window"
            value={
              num(p.context_window) != null ? num(p.context_window)!.toLocaleString() : undefined
            }
          />
          <DetailRow label="Mode" value={str(p.pi_mode)} />
          <DetailRow label="Working dir" value={str(p.cwd)} mono />
          <DetailRow
            label="Session file"
            value={str(p.transcript_path)}
            mono
            title={str(p.transcript_path)}
          />
          <DetailRow label="Previous" value={str(p.previous_session_file)} mono />
        </div>
      )

    case 'SessionEnd':
      return (
        <div className="space-y-1">
          <DetailRow label="Reason" value={str(p.reason) ?? 'unknown'} />
          <DetailRow label="Next session" value={str(p.target_session_file)} mono />
        </div>
      )

    case 'SessionRename':
      return <DetailRow label="Name" value={str(p.name) ?? '(cleared)'} />

    case 'SessionTree':
      return (
        <div className="space-y-1">
          <DetailRow label="From leaf" value={str(p.old_leaf_id)} mono />
          <DetailRow label="To leaf" value={str(p.new_leaf_id)} mono />
        </div>
      )

    case 'SystemPrompt': {
      const text = str(p.system_prompt) ?? ''
      const chars = num(p.system_prompt_chars) ?? text.length
      const clipped = text.length > 0 && text.length < chars
      return (
        <div className="space-y-1.5">
          <CollapsibleText
            title="System prompt"
            text={text}
            meta={`${chars.toLocaleString()} chars · ~${formatTokens(estimateTokens(chars))} tok (estimate)`}
            note={
              clipped
                ? `Clipped by the extension: ${text.length.toLocaleString()} of ${chars.toLocaleString()} chars captured.`
                : undefined
            }
          />
          {isSubagentEvent(p) && <DetailRow label="Agent" value={str(p.agent_name)} />}
        </div>
      )
    }

    case 'UserPromptSubmit': {
      const subagent = isSubagentEvent(p)
      const images = num(p.images) ?? 0
      return (
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={p.source === 'extension' ? 'warn' : 'muted'}>
              source: {str(p.source) ?? 'unknown'}
            </Badge>
            {p.source === 'extension' && (
              <Badge tone="warn" title="Sent by an extension, not typed by the user">
                injected
              </Badge>
            )}
            {subagent && <Badge tone="purple">task prompt for {str(p.agent_name)}</Badge>}
            {images > 0 && (
              <Badge>
                {images} image{images === 1 ? '' : 's'}
              </Badge>
            )}
          </div>
          <DetailCode
            label={subagent ? 'Task' : 'Prompt'}
            value={str(p.prompt)}
            maxHeight="max-h-80"
          />
        </div>
      )
    }

    case 'UserBash':
      return (
        <div className="space-y-1.5">
          <BashToolViewer
            command={str(p.command) ?? ''}
            output={null}
            exitCode={null}
            status="unknown"
            cwd={str(p.cwd)}
            shellLabel="!bash (user)"
          />
          <DetailRow
            label="In context"
            value={p.exclude_from_context === true ? 'no (!! — excluded)' : 'yes'}
          />
          <div className="text-[10px] text-muted-foreground">
            pi reports the command only; its output is not part of this event.
          </div>
        </div>
      )

    case 'LLMGeneration':
      return <LlmDetail p={p} />

    case 'Stop': {
      const ctx = obj(p.context)
      return (
        <div className="space-y-1">
          <DetailRow label="Status" value="Agent settled — turn complete" />
          <ContextRows
            tokens={num(ctx?.tokens)}
            window={num(ctx?.contextWindow)}
            percent={num(ctx?.percent)}
          />
        </div>
      )
    }

    case 'SubagentStart':
      return <SubagentDetail {...props} />

    case 'SubagentStop':
      return (
        <div className="space-y-1">
          <SubagentDetail {...props} />
          <DetailRow label="Turns" value={num(p.turn_count)?.toString()} />
          <DetailRow label="Tool uses" value={num(p.tool_uses)?.toString()} />
          <DetailRow label="Input tokens" value={num(p.input_tokens)?.toLocaleString()} />
          <DetailRow label="Output tokens" value={num(p.output_tokens)?.toLocaleString()} />
          <DetailRow
            label="Duration"
            value={num(p.duration_ms) != null ? formatMs(num(p.duration_ms)) : undefined}
          />
        </div>
      )

    case 'PreCompact': {
      const ctx = obj(p.context)
      return (
        <div className="space-y-1">
          <DetailRow label="Trigger" value={str(p.trigger)} />
          <DetailRow label="Will retry" value={p.will_retry === true ? 'yes' : 'no'} />
          <ContextRows
            tokens={num(ctx?.tokens)}
            window={num(ctx?.contextWindow)}
            percent={num(ctx?.percent)}
          />
          <DetailCode label="Instructions" value={str(p.custom_instructions)} />
        </div>
      )
    }

    case 'PostCompact': {
      const ctx = obj(p.context)
      const summary = str(p.summary)
      return (
        <div className="space-y-1.5">
          <DetailRow label="Trigger" value={str(p.trigger)} />
          <DetailRow label="Tokens before" value={num(p.tokens_before)?.toLocaleString()} />
          <ContextRows
            tokens={num(ctx?.tokens)}
            window={num(ctx?.contextWindow)}
            percent={num(ctx?.percent)}
            label="Context after"
          />
          <DetailRow label="By extension" value={p.from_extension === true ? 'yes' : undefined} />
          <DetailRow label="Will retry" value={p.will_retry === true ? 'yes' : undefined} />
          {summary && (
            <CollapsibleText
              title="Summary"
              text={summary}
              meta={`${summary.length.toLocaleString()} chars · ~${formatTokens(estimateTokens(summary.length))} tok`}
            />
          )}
        </div>
      )
    }

    case 'CompactionFailed':
      return (
        <div className="space-y-1">
          <DetailRow label="Trigger" value={str(p.trigger)} />
          <DetailRow label="Aborted" value={p.aborted === true ? 'yes' : 'no'} />
          <DetailRow label="Will retry" value={p.will_retry === true ? 'yes' : 'no'} />
          <DetailCode label="Error" value={str(p.error)} tone="fail" />
        </div>
      )

    case 'ModelChange':
      return (
        <div className="space-y-1">
          <DetailRow label="From" value={str(p.previous_model) ?? '—'} mono />
          <DetailRow label="To" value={str(p.model)} mono />
          <DetailRow label="Provider" value={str(p.provider)} />
          <DetailRow label="Source" value={str(p.source)} />
        </div>
      )

    case 'ThinkingLevelChange':
      return (
        <div className="space-y-1">
          <DetailRow label="From" value={str(p.previous_level) ?? '—'} />
          <DetailRow label="To" value={str(p.level)} />
        </div>
      )

    case 'Notification':
      return (
        <div className="space-y-1">
          <DetailRow label="Waiting on" value={str(p.notification_type) ?? 'dialog'} />
          <DetailCode label="Message" value={str(p.message)} />
        </div>
      )

    case 'CustomMessage': {
      const type = str(p.custom_type)
      const isResult = type === 'subagent-result'
      return (
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={isResult ? 'accent' : 'muted'}>{type ?? 'custom'}</Badge>
            {p.display === false && <Badge>hidden in pi</Badge>}
          </div>
          <DetailCode
            label={isResult ? 'Result' : 'Text'}
            value={str(p.text)}
            maxHeight="max-h-80"
          />
        </div>
      )
    }

    default:
      return <DetailCode label="Payload" value={asText(p)} />
  }
}

function ContextRows({
  tokens,
  window,
  percent,
  label = 'Context',
}: {
  tokens?: number
  window?: number
  percent?: number
  label?: string
}) {
  if (tokens == null) {
    return null
  }
  const pct = percent ?? (window ? (tokens / window) * 100 : undefined)
  return (
    <DetailRow
      label={label}
      value={`${tokens.toLocaleString()}${window != null ? ` / ${window.toLocaleString()}` : ''}${
        pct != null ? ` (${pct.toFixed(1)}%)` : ''
      }`}
    />
  )
}

function SubagentDetail({ event, agentMap, spawnInfo }: EventDetailProps) {
  const p = event.payload as Payload
  const agentId = str(p.agent_id) ?? event.agentId
  const parentAgentId = str(p.parent_agent_id)
  return (
    <div className="space-y-1">
      <AgentLink
        label="Agent"
        agentId={agentId}
        agent={agentMap.get(agentId)}
        fallbackName={str(p.agent_name)}
        jumpEventId={spawnInfo?.spawnEventId}
        jumpLabel="spawning call"
      />
      <DetailRow label="Type" value={str(p.agent_type)} />
      <DetailRow label="Task" value={str(p.agent_description)} />
      {event.subtype === 'SubagentStart' && (
        <DetailRow label="Background" value={p.background === true ? 'yes' : 'no'} />
      )}
      <DetailRow label="Spawned by" value={str(p.parent_tool_use_id)} mono />
      {parentAgentId && (
        <AgentLink
          label="Parent agent"
          agentId={parentAgentId}
          agent={agentMap.get(parentAgentId)}
        />
      )}
      {event.subtype === 'SubagentStart' && <DetailCode label="Prompt" value={spawnInfo?.prompt} />}
    </div>
  )
}

function LlmDetail({ p }: { p: Payload }) {
  const input = num(p.input_tokens) ?? 0
  const output = num(p.output_tokens) ?? 0
  const cacheRead = num(p.cache_read_tokens) ?? 0
  const cacheWrite = num(p.cache_creation_tokens) ?? 0
  const reasoning = num(p.reasoning_tokens) ?? 0
  const ttft = num(p.ttft_ms)
  const duration = num(p.duration_ms)
  const tps = tokensPerSecond(p)
  const hit = cacheHitPct(p)
  const cost = num(p.cost_usd)
  const httpStatus = num(p.http_status)
  const toolCalls = Array.isArray(p.tool_calls)
    ? p.tool_calls.map((c) => obj(c)).filter((c): c is Payload => c != null)
    : []
  const failed = llmFailed(p)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {str(p.model) && <Badge tone="info">{str(p.model)}</Badge>}
        {str(p.actual_model) && (
          <Badge tone="info" title="Model reported by the provider's response">
            served by {str(p.actual_model)}
          </Badge>
        )}
        {str(p.provider) && <Badge tone="purple">{str(p.provider)}</Badge>}
        {str(p.stop_reason) && (
          <Badge
            tone={
              failed
                ? 'fail'
                : p.stop_reason === 'length' || p.stop_reason === 'aborted'
                  ? 'warn'
                  : 'muted'
            }
          >
            stop: {str(p.stop_reason)}
          </Badge>
        )}
        {httpStatus != null && (
          <Badge tone={httpStatus >= 400 ? 'fail' : 'ok'}>HTTP {httpStatus}</Badge>
        )}
      </div>

      <DetailCode label="Error" value={str(p.error_message)} tone="fail" />

      <div className="space-y-1">
        <DetailRow label="Input" value={input.toLocaleString()} />
        <DetailRow label="Output" value={output.toLocaleString()} />
        <DetailRow label="Cache read" value={cacheRead.toLocaleString()} />
        <DetailRow label="Cache write" value={cacheWrite.toLocaleString()} />
        {reasoning > 0 && <DetailRow label="Reasoning" value={reasoning.toLocaleString()} />}
        <DetailRow label="Total" value={num(p.total_tokens)?.toLocaleString()} />
        {hit != null && <DetailRow label="Cache hit" value={`${hit}%`} />}
      </div>
      <StackedBar
        parts={[
          { label: 'Input', value: input, className: 'bg-blue-500/70' },
          { label: 'Cache read', value: cacheRead, className: 'bg-amber-500/70' },
          { label: 'Cache write', value: cacheWrite, className: 'bg-purple-500/70' },
          { label: 'Output', value: output, className: 'bg-green-500/70' },
        ]}
      />

      <div className="space-y-1">
        <DetailRow label="TTFT" value={ttft != null ? `${ttft.toLocaleString()}ms` : undefined} />
        <DetailRow
          label="Duration"
          value={duration != null ? `${(duration / 1000).toFixed(2)}s` : undefined}
        />
        <DetailRow
          label="Tokens/s"
          value={
            tps != null
              ? `${tps.toFixed(1)} (client-derived)`
              : isBurstResponse(p)
                ? `— (response arrived in one burst: ${formatMs((duration ?? 0) - (ttft ?? 0))} after first token)`
                : ttft == null
                  ? '— (no ttft_ms: nothing streamed)'
                  : undefined
          }
          title="output_tokens / (duration_ms − ttft_ms), measured by pi's client — includes network and client overhead, not the server's own decode timing"
        />
        <ContextRows tokens={num(p.context_tokens)} window={num(p.context_window)} />
        <DetailRow
          label="Cost"
          value={cost != null ? `$${cost.toFixed(cost > 0 && cost < 0.01 ? 5 : 4)}` : undefined}
        />
        <DetailRow label="Turn" value={num(p.turn_index)?.toString()} />
        <DetailRow label="Response ID" value={str(p.response_id)} mono />
      </div>

      {toolCalls.length > 0 && (
        <div>
          <SectionLabel>Tool calls requested</SectionLabel>
          <div className="flex flex-wrap gap-1">
            {toolCalls.map((c, i) => (
              <Badge key={i} tone="info" title={str(c.id)}>
                {str(c.name) ?? '?'}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {str(p.thinking) && <ThinkingBlock thinkingText={str(p.thinking)!} />}
      <DetailCode label="Response" value={str(p.text)} maxHeight="max-h-80" />
    </div>
  )
}
