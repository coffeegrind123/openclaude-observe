import { describe, test, expect } from 'vitest'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { apiError } from './errors'

const createMockContext = (): Context => {
  return {
    json: (body: unknown, status: number) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  } as unknown as Context
}

describe('apiError', () => {
  test('returns JSON with { error: { message } } structure', async () => {
    const ctx = createMockContext()
    const res = apiError(ctx, 400 as ContentfulStatusCode, 'Bad request')
    expect(res.status).toBe(400)

    const body = await res.json()
    expect(body).toEqual({ error: { message: 'Bad request' } })
  })

  test('status code is set correctly on the response', () => {
    const ctx = createMockContext()
    const res = apiError(ctx, 500 as ContentfulStatusCode, 'Server error')
    expect(res.status).toBe(500)
  })

  test('extra fields are merged into the error body', async () => {
    const ctx = createMockContext()
    const res = apiError(ctx, 404 as ContentfulStatusCode, 'Not found', {
      code: 'NOT_FOUND',
      details: 'The requested resource was not found',
    })
    expect(res.status).toBe(404)

    const body = await res.json()
    expect(body.error).toEqual({
      message: 'Not found',
      code: 'NOT_FOUND',
      details: 'The requested resource was not found',
    })
  })

  test('works with 400 status code', () => {
    const ctx = createMockContext()
    const res = apiError(ctx, 400 as ContentfulStatusCode, 'Bad request')
    expect(res.status).toBe(400)
  })

  test('works with 404 status code', () => {
    const ctx = createMockContext()
    const res = apiError(ctx, 404 as ContentfulStatusCode, 'Not found')
    expect(res.status).toBe(404)
  })

  test('works with 500 status code', () => {
    const ctx = createMockContext()
    const res = apiError(ctx, 500 as ContentfulStatusCode, 'Internal error')
    expect(res.status).toBe(500)
  })

  test('extra fields allow arbitrary keys via the index signature', async () => {
    const ctx = createMockContext()
    const res = apiError(ctx, 422 as ContentfulStatusCode, 'Validation failed', {
      code: 'VALIDATION_ERROR',
      fields: ['name', 'email'],
      retryable: false,
    })
    expect(res.status).toBe(422)

    const body = await res.json()
    expect(body.error.message).toBe('Validation failed')
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(body.error.fields).toEqual(['name', 'email'])
    expect(body.error.retryable).toBe(false)
  })

  test('message is always present even when extra is provided', async () => {
    const ctx = createMockContext()
    const res = apiError(ctx, 503 as ContentfulStatusCode, 'Service unavailable', {
      code: 'DOWN',
    })
    expect(res.status).toBe(503)

    const body = await res.json()
    expect(body.error.message).toBe('Service unavailable')
    expect(body.error.code).toBe('DOWN')
  })
})
