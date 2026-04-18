export type ContextCategory =
  | 'claude-md'
  | 'mentioned-file'
  | 'tool-output'
  | 'thinking-text'
  | 'team-coordination'
  | 'user-message'
  | 'skills'

export const CONTEXT_CATEGORIES: ContextCategory[] = [
  'claude-md',
  'mentioned-file',
  'tool-output',
  'thinking-text',
  'team-coordination',
  'user-message',
  'skills',
]

export interface ContextSource {
  eventId: number
  description: string
  tokens: number
  scope?: string
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
  turns: TurnAttribution[]
  aggregates: Record<ContextCategory, { tokens: number; count: number }>
  peakInputTokens: number
}

export const CATEGORY_LABELS: Record<ContextCategory, string> = {
  'claude-md': 'CLAUDE.md',
  'mentioned-file': 'Mentioned',
  'tool-output': 'Tool output',
  'thinking-text': 'Thinking',
  'team-coordination': 'Team coord',
  'user-message': 'User msg',
  skills: 'Skills',
}

export const CATEGORY_COLORS: Record<ContextCategory, string> = {
  'claude-md': 'bg-blue-500',
  'mentioned-file': 'bg-cyan-500',
  'tool-output': 'bg-emerald-500',
  'thinking-text': 'bg-purple-500',
  'team-coordination': 'bg-pink-500',
  'user-message': 'bg-amber-500',
  skills: 'bg-indigo-500',
}

export const CATEGORY_TEXT_COLORS: Record<ContextCategory, string> = {
  'claude-md': 'text-blue-600 dark:text-blue-400',
  'mentioned-file': 'text-cyan-600 dark:text-cyan-400',
  'tool-output': 'text-emerald-600 dark:text-emerald-400',
  'thinking-text': 'text-purple-600 dark:text-purple-400',
  'team-coordination': 'text-pink-600 dark:text-pink-400',
  'user-message': 'text-amber-600 dark:text-amber-400',
  skills: 'text-indigo-600 dark:text-indigo-400',
}
