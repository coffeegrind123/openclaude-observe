import { describe, test, expect, vi } from 'vitest'
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

describe('config.dataDir', () => {
  test("follows the DB's directory, not the compose-only DATA_DIR", async () => {
    // `just dev` loads .env, where INSTANTCOFFEE_OBSERVE_DATA_DIR is the host
    // directory compose bind-mounts to /data (often a //c/... Docker Desktop
    // path). The server must not treat it as a local path.
    const saved = {
      dataDir: process.env.INSTANTCOFFEE_OBSERVE_DATA_DIR,
      dbPath: process.env.INSTANTCOFFEE_OBSERVE_DB_PATH,
    }
    process.env.INSTANTCOFFEE_OBSERVE_DATA_DIR = '//c/users/me/observe-data'
    process.env.INSTANTCOFFEE_OBSERVE_DB_PATH = '/tmp/observe-cfg/observe.db'
    try {
      vi.resetModules()
      const { config } = await import('./config')
      expect(config.dataDir).toBe('/tmp/observe-cfg')
    } finally {
      for (const [key, value] of [
        ['INSTANTCOFFEE_OBSERVE_DATA_DIR', saved.dataDir],
        ['INSTANTCOFFEE_OBSERVE_DB_PATH', saved.dbPath],
      ] as const) {
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
    }
  })
})
