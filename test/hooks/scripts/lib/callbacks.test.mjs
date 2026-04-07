// test/callbacks.test.mjs
import { describe, it, expect, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'

import { handleCallbackRequests, ALL_CALLBACK_HANDLERS } from '../../../../hooks/scripts/lib/callbacks.mjs'

function makeLog() {
  return {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  }
}

function startTestServer(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      resolve({ server, port, baseOrigin: `http://127.0.0.1:${port}` })
    })
  })
}

describe('ALL_CALLBACK_HANDLERS', () => {
  it('includes getSessionSlug', () => {
    expect(ALL_CALLBACK_HANDLERS).toContain('getSessionSlug')
  })
})

describe('handleCallbackRequests', () => {
  it('warns on non-array requests', async () => {
    const log = makeLog()
    const config = { allowedCallbacks: new Set(ALL_CALLBACK_HANDLERS), baseOrigin: '' }
    await handleCallbackRequests('not an array', { config, log })
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('must be an array'))
  })

  it('skips handlers not in allowedCallbacks', async () => {
    const log = makeLog()
    const config = { allowedCallbacks: new Set(), baseOrigin: '' }
    await handleCallbackRequests(
      [{ cmd: 'getSessionSlug', args: {} }],
      { config, log },
    )
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Blocked callback'))
  })

  it('warns on unknown handler', async () => {
    const log = makeLog()
    const config = { allowedCallbacks: new Set(['nonexistent']), baseOrigin: '' }
    await handleCallbackRequests(
      [{ cmd: 'nonexistent', args: {} }],
      { config, log },
    )
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('No handler'))
  })

  it('handles empty requests array', async () => {
    const log = makeLog()
    const config = { allowedCallbacks: new Set(ALL_CALLBACK_HANDLERS), baseOrigin: '' }
    await handleCallbackRequests([], { config, log })
    expect(log.debug).toHaveBeenCalledWith('Processing 0 callback request(s)')
  })
})

describe('getSessionSlug callback', () => {
  let testDir

  function setup() {
    testDir = join(tmpdir(), `callbacks-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
    return testDir
  }

  function cleanup() {
    if (testDir) rmSync(testDir, { recursive: true, force: true })
  }

  it('extracts slug from transcript file', async () => {
    setup()
    const transcriptPath = join(testDir, 'transcript.jsonl')
    writeFileSync(transcriptPath, '{"type":"system"}\n{"slug":"my-session-slug"}\n')

    const log = makeLog()
    const { server, baseOrigin } = await startTestServer((req, res) => {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      })
    })

    const config = {
      allowedCallbacks: new Set(ALL_CALLBACK_HANDLERS),
      baseOrigin,
    }

    await handleCallbackRequests(
      [{ cmd: 'getSessionSlug', callback: '/api/sessions/123/metadata', args: { transcript_path: transcriptPath } }],
      { config, log },
    )

    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('my-session-slug'))
    server.close()
    cleanup()
  })

  it('returns null when transcript_path is missing', async () => {
    const log = makeLog()
    const config = {
      allowedCallbacks: new Set(ALL_CALLBACK_HANDLERS),
      baseOrigin: 'http://localhost',
    }

    await handleCallbackRequests(
      [{ cmd: 'getSessionSlug', args: {} }],
      { config, log },
    )

    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('no transcript_path'))
  })

  it('returns null when transcript file does not exist', async () => {
    const log = makeLog()
    const config = {
      allowedCallbacks: new Set(ALL_CALLBACK_HANDLERS),
      baseOrigin: 'http://localhost',
    }

    await handleCallbackRequests(
      [{ cmd: 'getSessionSlug', args: { transcript_path: '/nonexistent/file.jsonl' } }],
      { config, log },
    )

    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('cannot read transcript'))
  })

  it('returns null when transcript has no slug', async () => {
    setup()
    const transcriptPath = join(testDir, 'transcript.jsonl')
    writeFileSync(transcriptPath, '{"type":"system"}\n{"type":"message"}\n')

    const log = makeLog()
    const config = {
      allowedCallbacks: new Set(ALL_CALLBACK_HANDLERS),
      baseOrigin: 'http://localhost',
    }

    await handleCallbackRequests(
      [{ cmd: 'getSessionSlug', args: { transcript_path: transcriptPath } }],
      { config, log },
    )

    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('no slug found'))
    cleanup()
  })
})
