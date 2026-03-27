export const eventIcons: Record<string, string> = {
  // Session lifecycle
  SessionStart: '🚀',
  SessionEnd: '🏁',
  Stop: '🔴',
  StopFailure: '💥',

  // User input
  UserPromptSubmit: '💬',
  UserPromptSubmitResponse: '🗣️',

  // Tool use
  PreToolUse: '🔧',
  'PreToolUse:Bash': '⚡',
  'PreToolUse:Read': '📖',
  'PreToolUse:Write': '✏️',
  'PreToolUse:Edit': '📝',
  'PreToolUse:Agent': '🤖',
  'PreToolUse:Glob': '🔍',
  'PreToolUse:Grep': '🔎',
  'PreToolUse:WebSearch': '🌐',
  'PreToolUse:WebFetch': '🌐',
  PostToolUse: '✅',
  'PostToolUse:Bash': '⚡',
  'PostToolUse:Agent': '🤖',
  PostToolUseFailure: '❌',

  // Agents & teams
  SubagentStart: '🤖',
  SubagentStop: '🤖',
  TeammateIdle: '💤',

  // Tasks
  TaskCreated: '📋',
  TaskCompleted: '✅',

  // Permissions
  PermissionRequest: '🔐',

  // Notifications
  Notification: '🔔',

  // Config & files
  InstructionsLoaded: '📄',
  ConfigChange: '⚙️',
  CwdChanged: '📂',
  FileChanged: '📝',

  // Compaction
  PreCompact: '🗜️',
  PostCompact: '🗜️',

  // MCP
  Elicitation: '❓',
  ElicitationResult: '💬',

  // Worktrees
  WorktreeCreate: '🌿',
  WorktreeRemove: '🗑️',

  // Legacy / transcript format
  progress: '⏳',
  agent_progress: '🤖',
  system: '⚙️',
  stop_hook_summary: '🔴',
  user: '👤',
  assistant: '🤖',
}

export function getEventIcon(subtype: string | null, toolName?: string | null): string {
  if (subtype && toolName && eventIcons[`${subtype}:${toolName}`]) {
    return eventIcons[`${subtype}:${toolName}`]
  }
  if (subtype && eventIcons[subtype]) {
    return eventIcons[subtype]
  }
  return '📌'
}
