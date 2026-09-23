import { describe, test, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

const PRICING = {
  'claude-sonnet-4-5': {
    inputPerM: 3,
    outputPerM: 15,
    cacheReadPerM: 0.3,
    cacheCreate5mPerM: 3.75,
    cacheCreate1hPerM: 3.75,
  },
  'gpt-5.5': {
    inputPerM: 1,
    outputPerM: 8,
    cacheReadPerM: 0.1,
    cacheCreate5mPerM: 0,
    cacheCreate1hPerM: 0,
  },
}

const getModelsPricing = vi.fn(async (): Promise<Record<string, unknown>> => PRICING)
vi.mock('../transcript-parser/models-pricing', () => ({ getModelsPricing }))

const { default: modelsRouter, normalizeModelId } = await import('./models')

function makeApp() {
  const app = new Hono()
  app.route('/api', modelsRouter)
  return app
}

describe('normalizeModelId', () => {
  test('strips provider / router prefixes', () => {
    expect(normalizeModelId('openrouter/openai/gpt-5.5')).toBe('gpt-5.5')
    expect(normalizeModelId('anthropic/claude-sonnet-4-5')).toBe('claude-sonnet-4-5')
  })

  test('strips a trailing release date', () => {
    expect(normalizeModelId('claude-sonnet-4-5-20250929')).toBe('claude-sonnet-4-5')
    expect(normalizeModelId('claude-sonnet-4-5@20250929')).toBe('claude-sonnet-4-5')
  })

  test('leaves bare ids alone', () => {
    expect(normalizeModelId('qwen3.8-27b')).toBe('qwen3.8-27b')
  })
})

describe('GET /api/models/pricing', () => {
  beforeEach(() => {
    getModelsPricing.mockClear()
  })

  test('returns pricing for exactly the requested ids, null when unknown', async () => {
    const res = await makeApp().request(
      '/api/models/pricing?ids=gpt-5.5,anthropic/claude-sonnet-4-5-20250929,qwen3.8-27b',
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pricing).toEqual({
      'gpt-5.5': PRICING['gpt-5.5'],
      // Keyed by the id as sent, resolved through normalization.
      'anthropic/claude-sonnet-4-5-20250929': PRICING['claude-sonnet-4-5'],
      'qwen3.8-27b': null,
    })
  })

  test('an exact id match wins over the normalized form', async () => {
    getModelsPricing.mockResolvedValueOnce({
      ...PRICING,
      'openai/gpt-5.5': { ...PRICING['gpt-5.5'], inputPerM: 99 },
    })
    const body = await (await makeApp().request('/api/models/pricing?ids=openai/gpt-5.5')).json()
    expect(body.pricing['openai/gpt-5.5'].inputPerM).toBe(99)
  })

  test('without ids returns the whole map', async () => {
    const body = await (await makeApp().request('/api/models/pricing')).json()
    expect(body.pricing).toEqual(PRICING)
  })

  test('caps the id list so one request cannot fan out unboundedly', async () => {
    const ids = Array.from({ length: 500 }, (_, i) => `m${i}`).join(',')
    const res = await makeApp().request(`/api/models/pricing?ids=${ids}`)
    expect(res.status).toBe(400)
    expect(getModelsPricing).not.toHaveBeenCalled()
  })
})
