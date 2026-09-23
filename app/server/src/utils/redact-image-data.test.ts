import { describe, test, expect } from 'vitest'
import { redactImageData, REDACTED_PREFIX } from './redact-image-data'

const B64 = (n: number) => 'A'.repeat(n)

describe('redactImageData', () => {
  test('replaces a long data URI inside a prompt and keeps the surrounding text', () => {
    const payload = {
      hook_event_name: 'UserPromptSubmit',
      prompt: `look at this data:image/png;base64,${B64(5000)} and tell me`,
    }
    expect(redactImageData(payload, 1000)).toBe(1)
    expect(payload.prompt).toBe(
      `look at this data:image/png;base64,${REDACTED_PREFIX} 5000 chars] and tell me`,
    )
  })

  test('stops at the extension truncation marker', () => {
    const payload = {
      text: `data:image/jpeg;base64,${B64(64000)}…[truncated 36000 of 100000 chars]`,
    }
    expect(redactImageData(payload, 1000)).toBe(1)
    expect(payload.text).toBe(
      `data:image/jpeg;base64,${REDACTED_PREFIX} 64000 chars]…[truncated 36000 of 100000 chars]`,
    )
  })

  test('keeps mime parameters', () => {
    const payload = { s: `data:image/svg+xml;charset=utf-8;base64,${B64(2000)}` }
    redactImageData(payload, 1000)
    expect(payload.s).toBe(`data:image/svg+xml;charset=utf-8;base64,${REDACTED_PREFIX} 2000 chars]`)
  })

  test('leaves short data URIs (inline icons) alone', () => {
    const payload = { s: `icon data:image/png;base64,${B64(200)}` }
    expect(redactImageData(payload, 1000)).toBe(0)
    expect(payload.s).toBe(`icon data:image/png;base64,${B64(200)}`)
  })

  test('redacts pi-ai image blocks in tool details, nested in arrays', () => {
    const payload = {
      hook_event_name: 'PostToolUse',
      tool_response: {
        content: '[image image/png]',
        details: { images: [{ type: 'image', data: B64(3000), mimeType: 'image/png' }] },
      },
    }
    expect(redactImageData(payload, 1000)).toBe(1)
    const block = payload.tool_response.details.images[0]
    expect(block.data).toBe(`${REDACTED_PREFIX} 3000 chars]`)
    expect(block.mimeType).toBe('image/png')
    // Text summary untouched
    expect(payload.tool_response.content).toBe('[image image/png]')
  })

  test('redacts Anthropic base64 source blocks', () => {
    const payload = {
      content: [
        { type: 'text', text: 'hi' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: B64(4000) } },
      ],
    }
    expect(redactImageData(payload, 1000)).toBe(1)
    expect((payload.content[1] as any).source.data).toBe(`${REDACTED_PREFIX} 4000 chars]`)
  })

  test('counts every blob and handles several URIs in one string', () => {
    const payload = {
      a: `data:image/png;base64,${B64(2000)} data:image/gif;base64,${B64(3000)}`,
      b: [{ type: 'image', data: B64(2000) }],
    }
    expect(redactImageData(payload, 1000)).toBe(3)
  })

  test('maxChars <= 0 disables redaction', () => {
    const payload = { s: `data:image/png;base64,${B64(5000)}` }
    expect(redactImageData(payload, 0)).toBe(0)
    expect(payload.s).toBe(`data:image/png;base64,${B64(5000)}`)
  })

  test('non-image base64 and ordinary text pass through', () => {
    const payload = {
      tool_input: { command: 'base64 file.bin' },
      tool_response: { content: B64(5000), details: null },
      n: 5,
      b: true,
      z: null,
    }
    expect(redactImageData(payload, 1000)).toBe(0)
    expect(payload.tool_response.content).toBe(B64(5000))
  })
})
