import { describe, it, expect } from 'vitest'
import { migrateIconCustomizations } from './use-icon-customizations'

const icon = (iconName: string) => ({ iconName })

describe('migrateIconCustomizations', () => {
  it('moves Claude Code tool keys onto the pi tool names', () => {
    const out = migrateIconCustomizations({
      Bash: icon('terminal'),
      Glob: icon('search'),
      _MCP: icon('plug'),
    })
    expect(out).toEqual({ bash: icon('terminal'), find: icon('search'), mcp: icon('plug') })
  })

  it('never overwrites a customization already saved under the pi name', () => {
    const out = migrateIconCustomizations({ bash: icon('mine'), Bash: icon('old') })
    expect(out).toEqual({ bash: icon('mine') })
  })

  it('still strips Pre/PostToolUse prefixes and obsolete keys', () => {
    const out = migrateIconCustomizations({ 'PreToolUse:Read': icon('book'), progress: icon('x') })
    expect(out).toEqual({ read: icon('book') })
  })

  it('returns the same object when nothing changes', () => {
    const data = { bash: icon('terminal'), LLMGeneration: icon('brain') }
    expect(migrateIconCustomizations(data)).toBe(data)
  })
})
