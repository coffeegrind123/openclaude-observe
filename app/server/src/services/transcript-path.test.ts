import { describe, test, expect, beforeAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolvePiTranscript } from './transcript-path'

// transcript_path arrives in events from whoever can reach POST /api/events,
// and the server reads that file. Only pi session transcripts may be read.
let home: string
let sessionFile: string

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'pi-home-'))
  const dir = join(home, '.pi', 'agent', 'sessions', '--work-proj--')
  mkdirSync(dir, { recursive: true })
  sessionFile = join(dir, '2026-09-23T14-22-42-583Z_01a0cea5.jsonl')
  writeFileSync(sessionFile, '{"type":"session"}\n')
  writeFileSync(join(home, 'secret.jsonl'), '{}\n')
  writeFileSync(join(dir, 'notes.txt'), 'x')
  symlinkSync(join(home, 'secret.jsonl'), join(dir, 'escape.jsonl'))
})

describe('resolvePiTranscript', () => {
  test('accepts a session file under a configured home', async () => {
    expect(await resolvePiTranscript(sessionFile, [home])).toBe(sessionFile)
  })

  test('accepts it under any of several homes', async () => {
    expect(await resolvePiTranscript(sessionFile, ['/nonexistent-home', home])).toBe(sessionFile)
  })

  test('rejects a .jsonl outside the sessions dir', async () => {
    expect(await resolvePiTranscript(join(home, 'secret.jsonl'), [home])).toBeNull()
  })

  test('rejects traversal out of the sessions dir', async () => {
    const sneaky = join(home, '.pi', 'agent', 'sessions', '..', '..', '..', 'secret.jsonl')
    expect(await resolvePiTranscript(sneaky, [home])).toBeNull()
  })

  test('rejects a symlink inside the sessions dir that points out of it', async () => {
    const link = join(home, '.pi', 'agent', 'sessions', '--work-proj--', 'escape.jsonl')
    expect(await resolvePiTranscript(link, [home])).toBeNull()
  })

  test('rejects non-.jsonl files, relative paths and unknown homes', async () => {
    expect(
      await resolvePiTranscript(
        join(home, '.pi', 'agent', 'sessions', '--work-proj--', 'notes.txt'),
        [home],
      ),
    ).toBeNull()
    expect(await resolvePiTranscript('.pi/agent/sessions/x.jsonl', [home])).toBeNull()
    expect(await resolvePiTranscript(sessionFile, ['/somewhere/else'])).toBeNull()
  })

  test('a missing file under the sessions dir resolves to its path (the route reports 404)', async () => {
    const missing = join(home, '.pi', 'agent', 'sessions', '--work-proj--', 'gone.jsonl')
    expect(await resolvePiTranscript(missing, [home])).toBe(missing)
  })
})
