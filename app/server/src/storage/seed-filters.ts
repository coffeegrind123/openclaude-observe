// Seed definitions for default filters. The `id` field is the stable
// primary key — never change an existing one or you'll create an
// orphan row. To rename or restructure a default filter, edit the
// fields in place and record the previous patterns in
// SUPERSEDED_SEED_PATTERNS: existing installs whose row still holds an old
// version are upgraded on the next start; edited rows are left alone.

import type { FilterPattern, FilterDisplay, FilterCombinator } from '../types'

export interface SeedFilter {
  id: string
  name: string
  pillName: string
  display: FilterDisplay
  combinator: FilterCombinator
  patterns: FilterPattern[]
  /** Optional per-filter config bag (color, etc.). Defaults to {}. */
  config?: Record<string, unknown>
}

// Default filters retired with the move from Claude Code/OpenClaude hooks to
// pi: they key on hooks and tools pi never emits (TaskCreate, PermissionRequest,
// InstructionsLoaded, ...). Existing installs delete these rows on startup;
// user-created filters are never touched.
export const OBSOLETE_DEFAULT_FILTER_IDS = [
  'default-tasks',
  'default-permissions',
  'default-config',
]

// Earlier pattern sets of a default filter, keyed by id. A row whose
// patterns still equal one of these was never edited, so startup replaces
// them with the current seed's.
export const SUPERSEDED_SEED_PATTERNS: Record<string, FilterPattern[][]> = {
  'default-errors': [
    [
      { target: 'hook', regex: '^(PostToolUseFailure|CompactionFailed)$' },
      { target: 'payload', regex: '"stop_reason":\\s*"error"' },
      { target: 'payload', regex: '"error_message":\\s*"[^"]+' },
    ],
  ],
}

// pi's tool names (docs/pi-protocol.md): built-ins are lowercase (read, bash,
// edit, write, grep, find, ls); delegation is Agent (top level) and SubAgent
// (inside a subagent); MCP servers go through the adapter's `mcp` tool and the
// browser stack registers browser_* tools.
const SPAWN_TOOLS = '^(Agent|SubAgent|StopAgent|AgentStatus)$'
const TOOL_HOOKS = '^(PreToolUse|PostToolUse|PostToolUseFailure)$'

export const SEED_FILTERS: SeedFilter[] = [
  {
    id: 'default-all',
    name: 'All',
    pillName: 'All',
    display: 'primary',
    combinator: 'and',
    // The system prompt dump is thousands of tokens of text that only changes
    // when the prompt does; it stays reachable under Session.
    patterns: [{ target: 'hook', regex: '^SystemPrompt$', negate: true }],
    config: { role: 'all-exclusions' },
  },
  {
    id: 'default-dynamic-tool-name',
    name: 'Dynamic tool name',
    pillName: '{toolName}',
    display: 'secondary',
    combinator: 'and',
    patterns: [{ target: 'hook', regex: TOOL_HOOKS }],
    config: { color: '#475569' }, // slate
  },
  {
    id: 'default-prompts',
    name: 'Prompts',
    pillName: 'Prompts',
    display: 'primary',
    combinator: 'and',
    patterns: [{ target: 'hook', regex: '^(UserPromptSubmit|UserBash)$' }],
    config: { color: '#059669' }, // emerald
  },
  {
    id: 'default-llm',
    name: 'LLM',
    pillName: 'LLM',
    display: 'primary',
    combinator: 'and',
    patterns: [{ target: 'hook', regex: '^LLMGeneration$' }],
    config: { color: '#0d9488' }, // teal
  },
  {
    id: 'default-tools',
    name: 'Tools',
    pillName: 'Tools',
    display: 'primary',
    combinator: 'and',
    // Tool hooks with a tool name, minus delegation (Agents) and MCP/browser
    // (their own pill). RE2 has no lookahead, hence the negated pattern.
    patterns: [
      { target: 'hook', regex: TOOL_HOOKS },
      { target: 'tool', regex: '^.+' },
      {
        target: 'tool',
        regex: '^(Agent|SubAgent|StopAgent|AgentStatus|mcp|browser_.*)$',
        negate: true,
      },
    ],
    config: { color: '#2563eb' }, // blue
  },
  {
    id: 'default-agents',
    name: 'Agents',
    pillName: 'Agents',
    display: 'primary',
    combinator: 'or',
    patterns: [
      { target: 'hook', regex: '^(SubagentStart|SubagentStop)$' },
      { target: 'tool', regex: SPAWN_TOOLS },
    ],
    config: { color: '#7c3aed' }, // violet
  },
  {
    id: 'default-mcp',
    name: 'MCP & browser',
    pillName: 'MCP',
    display: 'primary',
    combinator: 'and',
    patterns: [
      { target: 'hook', regex: TOOL_HOOKS },
      { target: 'tool', regex: '^(mcp|browser_.*)$' },
    ],
    config: { color: '#2563eb' }, // blue
  },
  {
    id: 'default-session',
    name: 'Session',
    pillName: 'Session',
    display: 'primary',
    combinator: 'and',
    patterns: [
      {
        target: 'hook',
        regex:
          '^(SessionStart|SessionEnd|SessionRename|SessionTree|SystemPrompt|ModelChange|ThinkingLevelChange)$',
      },
    ],
    config: { color: '#6b7280' }, // gray
  },
  {
    id: 'default-notifications',
    name: 'Notifications',
    pillName: 'Notifications',
    display: 'primary',
    combinator: 'or',
    patterns: [
      { target: 'hook', regex: '^Notification$' },
      { target: 'payload', regex: '"custom_type":\\s*"subagent-result"' },
    ],
    config: { color: '#0891b2' }, // cyan
  },
  {
    id: 'default-stop',
    name: 'Stop',
    pillName: 'Stop',
    display: 'primary',
    combinator: 'and',
    patterns: [{ target: 'hook', regex: '^(Stop|SubagentStop)$' }],
    config: { color: '#6b7280' }, // gray
  },
  {
    id: 'default-compaction',
    name: 'Compaction',
    pillName: 'Compact',
    display: 'primary',
    combinator: 'and',
    patterns: [{ target: 'hook', regex: '^(PreCompact|PostCompact|CompactionFailed)$' }],
    config: { color: '#6b7280' }, // gray
  },
  {
    id: 'default-errors',
    name: 'Errors',
    pillName: 'Errors',
    display: 'primary',
    combinator: 'or',
    patterns: [
      { target: 'hook', regex: '^(PostToolUseFailure|CompactionFailed)$' },
      // A merged tool row keeps its PreToolUse hook name and takes the
      // failure's payload, so the hook pattern alone misses it.
      { target: 'payload', regex: '"is_error":\\s*true' },
      { target: 'payload', regex: '"stop_reason":\\s*"error"' },
      { target: 'payload', regex: '"error_message":\\s*"[^"]+' },
    ],
    config: { color: '#e11d48' }, // rose
  },
]
