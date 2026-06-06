// Best-effort advisory lock for memory writes, compatible with OpenClaude's
// memdir lock convention: a lock lives at `<storeDir>/.locks/<relPath>.lock`
// with path separators flattened to `__`. OpenClaude uses proper-lockfile,
// whose default backend is an atomic `mkdir` of `<lockpath>.lock` — we mirror
// that with our own mkdir so the two serialize against each other when both
// touch the same file. If we can't get the lock we proceed anyway (advisory):
// our writes are still atomic (temp-file + rename), so the worst case is a
// last-writer-wins race, never a half-written file.

import { promises as fs } from 'node:fs'
import path from 'node:path'

const LOCKS_DIRNAME = '.locks'
const STALE_MS = 10_000 // match proper-lockfile's default stale window
const MAX_RETRIES = 10
const BASE_BACKOFF_MS = 5
const MAX_BACKOFF_MS = 100

function lockPathFor(storeDir: string, relPath: string): string {
  const flat = relPath.replace(/[\\/]/g, '__')
  return path.join(storeDir, LOCKS_DIRNAME, `${flat}.lock`)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function acquire(lockPath: string): Promise<boolean> {
  await fs.mkdir(path.dirname(lockPath), { recursive: true })
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      await fs.mkdir(lockPath)
      return true
    } catch (err: any) {
      if (err?.code !== 'EEXIST') return false
      // Lock held — break it if stale, else back off and retry.
      try {
        const st = await fs.stat(lockPath)
        if (Date.now() - st.mtimeMs > STALE_MS) {
          await fs.rmdir(lockPath).catch(() => {})
          continue
        }
      } catch {
        // lock vanished between mkdir and stat — retry immediately
        continue
      }
      const backoff = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS)
      await sleep(backoff)
    }
  }
  return false
}

/**
 * Run `fn` while holding the memdir lock for `relPath` under `storeDir`.
 * Acquisition is best-effort; `fn` always runs (lock is advisory).
 */
export async function withMemoryLock<T>(
  storeDir: string,
  relPath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lockPath = lockPathFor(storeDir, relPath)
  const held = await acquire(lockPath)
  try {
    return await fn()
  } finally {
    if (held) await fs.rmdir(lockPath).catch(() => {})
  }
}
