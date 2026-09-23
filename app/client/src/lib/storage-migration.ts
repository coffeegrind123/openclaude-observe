// One-shot rename of persisted UI state across the project's rebrands
// (agents-observe → openclaude-observe → instantcoffee-observe). Must run
// before any store reads localStorage, so main.tsx imports it first.
//
// Newest legacy prefix wins, and an existing current key is never overwritten.
// Legacy keys are removed once copied so the migration is idempotent.

export const STORAGE_PREFIX = 'instantcoffee-observe-'

// Ordered newest → oldest.
const LEGACY_PREFIXES = ['openclaude-observe-', 'agents-observe-']

export function migrateStorageKeys(storage: Storage): number {
  const keys: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (key) {
      keys.push(key)
    }
  }

  let copied = 0
  for (const prefix of LEGACY_PREFIXES) {
    for (const key of keys) {
      if (!key.startsWith(prefix)) {
        continue
      }

      const target = STORAGE_PREFIX + key.slice(prefix.length)
      const value = storage.getItem(key)
      if (value !== null && storage.getItem(target) === null) {
        storage.setItem(target, value)
        copied++
      }
      storage.removeItem(key)
    }
  }
  return copied
}

try {
  migrateStorageKeys(localStorage)
} catch {
  // Storage unavailable (private mode, blocked site data) — nothing to migrate.
}
