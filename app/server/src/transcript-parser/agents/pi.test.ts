import { describe, test, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePiSession } from './pi'

// Real pi 0.85.1 session from the instantcoffee stack (paths anonymised): one
// prompt; a turn with read + `echo hi` + a failing `cat`; a turn delegating a
// line count to a general-purpose subagent; a closing answer.
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'pi-session.jsonl')

function tempJsonl(lines: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'pi-transcript-'))
  const path = join(dir, 's.jsonl')
  writeFileSync(path, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n'))
  return path
}

describe('parsePiSession — real session', () => {
  test('counts every request with its usage, attributed to the prompt', async () => {
    const r = await parsePiSession(FIXTURE)

    expect(r.errors).toEqual([])
    expect(r.userPrompts).toBe(1)
    const promptIds = Object.keys(r.prompts)
    expect(promptIds).toHaveLength(1)
    expect(r.prompts[promptIds[0]].text).toMatch(/notes\.txt/)

    expect(r.calls).toHaveLength(3)
    for (const call of r.calls) {
      expect(call.model).toBe('qwen3.8-27b')
      expect(call.promptId).toBe(promptIds[0])
      expect(call.requestId).toMatch(/^chatcmpl-/)
    }
    // Second request reused the first's prefix from llama's cache.
    expect(r.calls[1].usage.cacheReadTokens).toBeGreaterThan(0)
    expect(r.calls[0].toolUseIds).toHaveLength(3)
    expect(r.lastTimestampByPromptId[promptIds[0]]).toBe(r.startedAt! + r.durationMs!)
  })

  test('tool stats use pi tool names and pair calls with results', async () => {
    const r = await parsePiSession(FIXTURE)

    expect(r.toolCalls).toBe(4)
    expect(r.filesRead).toBe(1)
    const bash = r.toolStats.find((t) => t.name === 'bash')!
    expect(bash.count).toBe(2)
    expect(bash.minMs).not.toBeNull()
    expect(r.toolStats.find((t) => t.name === 'Agent')?.count).toBe(1)
  })

  test('the subagent is recovered from the Agent result and its brief', async () => {
    const r = await parsePiSession(FIXTURE)

    expect(r.subagents).toHaveLength(1)
    const s = r.subagents[0]
    expect(s.agentType).toBe('general-purpose')
    expect(s.description).toBe('Count lines in notes.txt')
    expect(s.agentId).toMatch(/^f322fa95/)
    expect(s.toolUseId).toMatch(/^call_/)
    expect(s.requests).toBe(2)
    expect(s.toolCount).toBe(1)
    expect(s.inputTokens).toBeGreaterThan(0)
    expect(s.durationMs).toBeGreaterThan(0)
    expect(s.costCents).toBe(0)
  })
})

describe('parsePiSession — edge cases', () => {
  test('attributes entries on a branch to the prompt they descend from', async () => {
    const path = tempJsonl([
      { type: 'session', version: 3, id: 's', timestamp: '2026-01-01T00:00:00Z', cwd: '/w' },
      { type: 'message', id: 'u1', parentId: null, timestamp: '2026-01-01T00:00:01Z', message: { role: 'user', content: 'first' } },
      { type: 'message', id: 'a1', parentId: 'u1', timestamp: '2026-01-01T00:00:02Z', message: { role: 'assistant', model: 'm', usage: { input: 1, output: 1 }, content: [] } },
      // /tree back to u1 and a second answer on a new branch
      { type: 'message', id: 'a2', parentId: 'u1', timestamp: '2026-01-01T00:00:05Z', message: { role: 'assistant', model: 'm', usage: { input: 2, output: 2 }, content: [] } },
      { type: 'message', id: 'u2', parentId: 'a2', timestamp: '2026-01-01T00:00:06Z', message: { role: 'user', content: [{ type: 'text', text: 'second' }] } },
      { type: 'message', id: 'a3', parentId: 'u2', timestamp: '2026-01-01T00:00:07Z', message: { role: 'assistant', model: 'm', usage: { input: 3, output: 3 }, content: [] } },
    ])
    const r = await parsePiSession(path)

    expect(r.calls.map((c) => c.promptId)).toEqual(['u1', 'u1', 'u2'])
    expect(r.userPrompts).toBe(2)
    expect(r.prompts.u2.text).toBe('second')
  })

  test('skips assistant messages that never reached the provider', async () => {
    const path = tempJsonl([
      { type: 'message', id: 'u', parentId: null, timestamp: 1, message: { role: 'user', content: 'x' } },
      { type: 'message', id: 'a', parentId: 'u', timestamp: 2, message: { role: 'assistant', stopReason: 'aborted', content: [] } },
    ])
    expect((await parsePiSession(path)).calls).toHaveLength(0)
  })

  test('reports unparseable lines instead of failing', async () => {
    const path = tempJsonl(['{not json', { type: 'message', id: 'u', parentId: null, timestamp: 1, message: { role: 'user', content: 'x' } }])
    const r = await parsePiSession(path)

    expect(r.userPrompts).toBe(1)
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0].code).toBe('parse_error')
  })

  test('counts git commits run through bash', async () => {
    const path = tempJsonl([
      {
        type: 'message',
        id: 'a',
        parentId: null,
        timestamp: 1,
        message: {
          role: 'assistant',
          usage: { input: 1 },
          content: [
            { type: 'toolCall', id: 't1', name: 'bash', arguments: { command: 'git -C repo commit -m x' } },
            { type: 'toolCall', id: 't2', name: 'edit', arguments: { path: 'a.ts' } },
            { type: 'toolCall', id: 't3', name: 'write', arguments: { path: 'a.ts' } },
          ],
        },
      },
    ])
    const r = await parsePiSession(path)
    expect(r.gitCommits).toBe(1)
    expect(r.filesEdited).toBe(1)
  })

  test('git commit detection handles global options and ignores look-alikes', async () => {
    const commands = [
      ['git commit -m x', 1],
      ['git -c user.name=a commit', 1],
      ['git --no-pager commit --amend', 1],
      ['git log --grep commit', 0],
      ['echo git commit', 1],
      ['git status', 0],
    ] as const
    for (const [command, expected] of commands) {
      const path = tempJsonl([
        {
          type: 'message',
          id: 'a',
          parentId: null,
          timestamp: 1,
          message: { role: 'assistant', usage: {}, content: [{ type: 'toolCall', id: 't', name: 'bash', arguments: { command } }] },
        },
      ])
      expect((await parsePiSession(path)).gitCommits, command).toBe(expected)
    }
  })
})
