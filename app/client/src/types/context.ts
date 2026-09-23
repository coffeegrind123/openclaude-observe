// Mirrors app/server/src/context.ts. Bucket tokens are cumulative (what is in
// the window at that call); bucket sources are what that turn added.
export type ContextCategory =
  | 'system-prompt'
  | 'compaction-summary'
  | 'user-message'
  | 'mentioned-file'
  | 'tool-output'
  | 'delegation'
  | 'injected'
  | 'assistant-output'

export const CONTEXT_CATEGORIES: ContextCategory[] = [
  'system-prompt',
  'compaction-summary',
  'user-message',
  'mentioned-file',
  'tool-output',
  'delegation',
  'injected',
  'assistant-output',
]

export interface ContextSource {
  eventId: number
  description: string
  tokens: number
}

export interface ContextBucket {
  category: ContextCategory
  tokens: number
  sources: ContextSource[]
}

export interface TurnAttribution {
  llmEventId: number
  timestamp: number
  inputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  estimatedTokens: number
  buckets: ContextBucket[]
}

export interface SessionContextBreakdown {
  sessionId: string
  agentId: string
  turns: TurnAttribution[]
  aggregates: Record<ContextCategory, { tokens: number; count: number }>
  peakInputTokens: number
}

export const CATEGORY_LABELS: Record<ContextCategory, string> = {
  'system-prompt': 'System prompt',
  'compaction-summary': 'Compaction',
  'user-message': 'User msg',
  'mentioned-file': 'Mentioned',
  'tool-output': 'Tool output',
  delegation: 'Subagents',
  injected: 'Injected',
  'assistant-output': 'Assistant',
}

export const CATEGORY_COLORS: Record<ContextCategory, string> = {
  'system-prompt': 'bg-blue-500',
  'compaction-summary': 'bg-slate-500',
  'user-message': 'bg-amber-500',
  'mentioned-file': 'bg-cyan-500',
  'tool-output': 'bg-emerald-500',
  delegation: 'bg-pink-500',
  injected: 'bg-indigo-500',
  'assistant-output': 'bg-purple-500',
}

export const CATEGORY_TEXT_COLORS: Record<ContextCategory, string> = {
  'system-prompt': 'text-blue-600 dark:text-blue-400',
  'compaction-summary': 'text-slate-600 dark:text-slate-400',
  'user-message': 'text-amber-600 dark:text-amber-400',
  'mentioned-file': 'text-cyan-600 dark:text-cyan-400',
  'tool-output': 'text-emerald-600 dark:text-emerald-400',
  delegation: 'text-pink-600 dark:text-pink-400',
  injected: 'text-indigo-600 dark:text-indigo-400',
  'assistant-output': 'text-purple-600 dark:text-purple-400',
}
