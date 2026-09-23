import { describe, test, expect } from 'vitest'
import { resolve } from 'path'
import { resolveHostDbPath } from './config'

describe('resolveHostDbPath', () => {
  test('passes a Windows / Docker Desktop host path through verbatim', () => {
    // resolve() inside the Linux container would treat these as relative and
    // prefix the container cwd (/app/server/C:\...).
    const win = 'C:\\Users\\me\\instantcoffee-observe\\data\\observe.db'
    expect(resolveHostDbPath(win, '/data/observe.db')).toBe(win)
    const dd = '//c/users/me/instantcoffee-observe/data/observe.db'
    expect(resolveHostDbPath(dd, '/data/observe.db')).toBe(dd)
  })

  test('passes a POSIX host path through verbatim', () => {
    const host = '/home/me/instantcoffee-observe/data/observe.db'
    expect(resolveHostDbPath(host, '/data/observe.db')).toBe(host)
  })

  test('falls back to the resolved DB path when no host path is set (local mode)', () => {
    expect(resolveHostDbPath('', '/home/me/data/observe.db')).toBe('/home/me/data/observe.db')
    expect(resolveHostDbPath(undefined, '/home/me/data/observe.db')).toBe(
      '/home/me/data/observe.db',
    )
    expect(resolveHostDbPath('  ', 'data/observe.db')).toBe(resolve('data/observe.db'))
  })
})
