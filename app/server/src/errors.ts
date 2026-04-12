import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

interface ApiErrorBody {
  message: string
  code?: string
  details?: string
  [key: string]: unknown
}

/**
 * Return a standardized error response: { error: { message, code?, details?, ... } }
 */
export function apiError(
  c: Context,
  status: ContentfulStatusCode,
  message: string,
  extra?: Partial<ApiErrorBody>,
) {
  const body: ApiErrorBody = { message, ...extra }
  return c.json({ error: body }, status)
}
