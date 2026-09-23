# pi → instantcoffee-observe event protocol

The contract between the pi extension in instantcoffee
(`.pi/extensions/observe/`) and this server's `POST /api/events`. The extension
is the only producer. Change both sides together.

Every shape the extension reads from pi was taken from a capture of pi 0.85.1 on
the live stack, not from pi's documentation. The replay test in
`.pi/extensions/observe/tests/replay.test.ts` pins that capture.

## Transport

```
POST /api/events
Content-Type: application/json

{ "hook_payload": { ...envelope... },
  "meta": { "env": { "INSTANTCOFFEE_OBSERVE_PROJECT_SLUG": "<slug>" } } }   // meta optional
```

- **Delivery.** Events arrive in order from one sequential sender per pi process.
- **Server errors and outages.** A 5xx or transport failure makes the sender drop that event and back off for 10 s. Events emitted during the backoff are discarded, not queued.
- **4xx.** A 4xx drops that event only. The server answers 400 when `hook_payload` lacks a non-empty `hook_event_name` or `session_id`.
- **Queue.** The queue is bounded at 2000.
- **Field size.** Free-text fields are clipped to `OBSERVE_MAX_FIELD_CHARS` (default 64 000). A clipped field ends in `…[truncated N of M chars]`.

## Envelope: fields on every event

| Field | Type | Meaning |
|---|---|---|
| `hook_event_name` | string | Event type (table below) |
| `agent_class` | `"pi"` | Producer |
| `session_id` | string | The **top-level** pi session id. Subagent events carry their parent's session id. |
| `timestamp` | number | Epoch ms when the extension saw the event |
| `cwd` | string | Working directory |
| `transcript_path` | string? | The top-level session's JSONL file (`~/.pi/agent/sessions/--<cwd>--/<ts>_<id>.jsonl`). Absent for `--no-session`. |
| `slug` | string? | pi session name, when one is set |
| `model`, `provider` | string? | Active model, e.g. `qwen3.8-27b` / `forge` |

### Subagent fields

These are present only on events from a subagent's in-memory session:

| Field | Meaning |
|---|---|
| `agent_id` | The child's pi session id, stable for its lifetime |
| `agent_type` | e.g. `general-purpose`, `explorer` |
| `agent_name` | pi-subagents-lite's session name, `<type>#<id8>` |
| `agent_description` | The `description` passed to the spawning call |
| `parent_tool_use_id` | `tool_use_id` of the `Agent`/`SubAgent` call that spawned it |
| `parent_agent_id` | Set when a **subagent** spawned it through `SubAgent` (nested delegation, `SUBAGENT_MAX_DEPTH=2`). Absent when the top-level session did. |

The extension resolves this linkage because pi exposes no link. Children run
in-process on `SessionManager.inMemory` with no parent reference. Children are
matched to pending spawn calls first-in-first-out within an agent type. A
background call's `Agent ID: …` result corrects the match exactly. See
`src/linker.ts` for the full reasoning.

## Events

| `hook_event_name` | pi source | Extra fields |
|---|---|---|
| `SessionStart` | `session_start` (top-level) | `source` (`startup`\|`reload`\|`new`\|`resume`\|`fork`), `previous_session_file`, `thinking_level`, `context_window`, `pi_mode` |
| `SessionEnd` | `session_shutdown` | `reason` (`quit`\|`reload`\|`new`\|`resume`\|`fork`), `target_session_file` |
| `SessionRename` | `session_info_changed` (top-level) | `name` |
| `SystemPrompt` | `before_agent_start`, only when the prompt's length changed | `system_prompt`, `system_prompt_chars` |
| `UserPromptSubmit` | `input` | `prompt`, `source` (`interactive`\|`rpc`\|`extension`), `images` (count). For a subagent this is its task prompt. |
| `PreToolUse` | `tool_call` (input after other extensions' mutations) | `tool_name`, `tool_use_id`, `tool_input` |
| `PostToolUse` / `PostToolUseFailure` | `tool_execution_end` (`isError`) | `tool_name`, `tool_use_id`, `tool_input`, `tool_response: {content, details}`, `is_error`, `duration_ms`, `error` (failures only), `spawned_agent_id` (background `Agent` only) |
| `LLMGeneration` | `message_end` with role `assistant` | See below |
| `Stop` | `agent_settled` (top-level) | `context` (`{tokens, contextWindow, percent}`) |
| `SubagentStart` | the child's `session_start` | `background` |
| `SubagentStop` | the child's `agent_settled` | `turn_count`, `tool_uses`, `input_tokens`, `output_tokens`, `duration_ms` |
| `PreCompact` | `session_before_compact` | `trigger` (`manual`\|`threshold`\|`overflow`), `will_retry`, `custom_instructions`, `context` |
| `PostCompact` | `session_compact` | `trigger`, `tokens_before`, `summary`, `from_extension`, `will_retry`, `context` |
| `CompactionFailed` | `session_compact_failed` | `trigger`, `error`, `aborted`, `will_retry` |
| `ModelChange` | `model_select` | `previous_model`, `source` (`set`\|`cycle`\|`restore`) |
| `ThinkingLevelChange` | `thinking_level_select` | `level`, `previous_level` |
| `UserBash` | `user_bash` (`!cmd`) | `command`, `exclude_from_context` |
| `Notification` | `ui_prompt_start` (pi is blocked on a dialog) | `message`, `notification_type` |
| `SessionTree` | `session_tree` (`/tree` navigation) | `new_leaf_id`, `old_leaf_id` |
| `CustomMessage` | `message_end` with role `custom` | `custom_type` (e.g. `subagent-result`), `text`, `display` |

### LLMGeneration

| Field | Source |
|---|---|
| `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `reasoning_tokens`, `total_tokens` | `message.usage` |
| `cost_usd` | `message.usage.cost.total`. Always 0 on forge; real for remote subagent models. |
| `stop_reason` | `toolUse`\|`stop`\|`length`\|`error`\|`aborted` |
| `tool_calls` | `[{id, name}]` requested by this generation |
| `text`, `thinking` | The assistant's text and reasoning blocks |
| `response_id`, `actual_model`, `error_message`, `http_status`, `turn_index` | Present when known |
| `duration_ms` | `message_end` − `before_provider_request` |
| `ttft_ms` | First streamed update (including a thinking token) − `before_provider_request`. Absent when there was no streamed update. **Through forge this is not a time to first token:** forge calls llama with `stream=False` and replays the finished response as SSE, so the first update lands a few ms before the end (captured: 9,269 of 9,277 ms). It measures generation time; only a provider that really streams makes it a TTFT. |
| `context_tokens`, `context_window` | `ctx.getContextUsage()` after the generation |

pi does not see llama.cpp's per-request `timings` (forge drops them). So
decode speed and draft acceptance come from the server's own poll of
llama-server `/metrics` (`GET /api/stack`), not from these events.

## Ordering facts the server can rely on

Observed on pi 0.85.1:

1. With parallel tool calls every `PreToolUse` of a turn precedes its results, but results arrive in completion order, not call order.
2. A foreground subagent's `SubagentStop` precedes the parent's `PostToolUse` for the spawning `Agent` call.
3. A subagent never produces `SessionStart` or `SessionEnd`.
4. `SessionEnd` with `reason` other than `quit` is followed by a `SessionStart` for the replacement session.
