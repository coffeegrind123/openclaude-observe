// Web Storage polyfill for the test environment.
//
// Node >= 22.4 exposes an experimental global `localStorage`/`sessionStorage`
// that is `undefined` unless the process was started with
// `--localstorage-file`. From Node 25 on, in the jsdom test environment that
// undefined global shadows jsdom's Storage, so a bare `localStorage` reference
// reads as undefined. Any module that touches it at import time — e.g. the
// zustand ui-store — then throws during test collection, failing entire
// suites before a single test runs.
//
// Install a minimal in-memory Storage so every test file starts with a
// working localStorage/sessionStorage. This runs as the FIRST setupFile so it
// executes before setup.ts's `@/agents/init` import chain (and thus before any
// store module) is evaluated. vitest gives each test file its own module
// realm, so storage never leaks across files.

function createMemoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value))
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
  }
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  const storage = createMemoryStorage()
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: storage })
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, name, { configurable: true, writable: true, value: storage })
  }
}
