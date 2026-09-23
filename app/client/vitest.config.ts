import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Client tests replay the server's captured pi envelopes
  // (app/server/src/routes/__fixtures__) — one fixture, both sides.
  server: {
    fs: {
      allow: [path.resolve(__dirname, '..')],
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    // polyfill-storage must run first: it installs localStorage before
    // setup.ts's import chain (and any store module) is evaluated.
    setupFiles: ['./src/test/polyfill-storage.ts', './src/test/setup.ts'],
    css: false,
  },
})
