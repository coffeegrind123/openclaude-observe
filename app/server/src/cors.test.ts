import { describe, test, expect } from 'vitest'
import { isLoopbackOrigin, isOriginAllowed, isWsOriginAllowed, resolveCorsOrigin } from './cors'

describe('isLoopbackOrigin', () => {
  test('accepts localhost / 127.0.0.1 / ::1 on any port', () => {
    expect(isLoopbackOrigin('http://localhost:5174')).toBe(true)
    expect(isLoopbackOrigin('http://127.0.0.1:4981')).toBe(true)
    expect(isLoopbackOrigin('http://[::1]:4981')).toBe(true)
  })

  test('rejects non-loopback and malformed origins', () => {
    expect(isLoopbackOrigin('https://evil.com')).toBe(false)
    expect(isLoopbackOrigin('http://192.168.1.5:4981')).toBe(false)
    expect(isLoopbackOrigin('')).toBe(false)
    expect(isLoopbackOrigin('not-a-url')).toBe(false)
  })
})

describe('resolveCorsOrigin', () => {
  test('default (empty allowlist) reflects loopback origins only', () => {
    const origin = resolveCorsOrigin([])
    expect(typeof origin).toBe('function')
    const fn = origin as (o: string) => string | null
    expect(fn('http://localhost:5174')).toBe('http://localhost:5174')
    expect(fn('https://evil.com')).toBeNull()
  })

  test('wildcard allows any origin', () => {
    expect(resolveCorsOrigin(['*'])).toBe('*')
  })

  test('explicit allowlist is passed through verbatim', () => {
    expect(resolveCorsOrigin(['https://a.example', 'https://b.example'])).toEqual([
      'https://a.example',
      'https://b.example',
    ])
  })
})

describe('isOriginAllowed', () => {
  test('empty allowlist permits only loopback origins', () => {
    expect(isOriginAllowed('http://localhost:5174', [])).toBe(true)
    expect(isOriginAllowed('http://127.0.0.1:4981', [])).toBe(true)
    expect(isOriginAllowed('https://evil.com', [])).toBe(false)
  })

  test('wildcard permits any origin', () => {
    expect(isOriginAllowed('https://evil.com', ['*'])).toBe(true)
  })

  test('explicit allowlist requires an exact match', () => {
    const list = ['https://a.example']
    expect(isOriginAllowed('https://a.example', list)).toBe(true)
    expect(isOriginAllowed('https://b.example', list)).toBe(false)
    // A loopback origin is NOT implicitly allowed once an allowlist is set.
    expect(isOriginAllowed('http://localhost:5174', list)).toBe(false)
  })
})

describe('isWsOriginAllowed', () => {
  test('allows a missing Origin header (non-browser client)', () => {
    expect(isWsOriginAllowed(undefined, [])).toBe(true)
    expect(isWsOriginAllowed('', [])).toBe(true)
  })

  test('applies the shared origin policy when Origin is present', () => {
    expect(isWsOriginAllowed('http://localhost:5174', [])).toBe(true)
    expect(isWsOriginAllowed('https://evil.com', [])).toBe(false)
    expect(isWsOriginAllowed('https://evil.com', ['*'])).toBe(true)
  })
})
