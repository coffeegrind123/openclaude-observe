import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { readFileSync } from 'fs'
import { execSync } from 'child_process'

const rootPkg = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'))
const gitHash = (() => {
  // Try GIT_HASH file first (Docker builds), then env var, then git command (dev)
  for (const p of ['/GIT_HASH', path.resolve(__dirname, '../../GIT_HASH')]) {
    try { const v = readFileSync(p, 'utf8').trim(); if (v && v !== 'unknown') return v } catch {}
  }
  if (process.env.GIT_HASH && process.env.GIT_HASH !== 'unknown') return process.env.GIT_HASH
  try { return execSync('git rev-parse --short HEAD', { cwd: path.resolve(__dirname, '../..') }).toString().trim() } catch { return 'unknown' }
})()

const serverPort = Number(process.env.AGENTS_OBSERVE_SERVER_PORT || '4981')
const clientPort = Number(process.env.AGENTS_OBSERVE_DEV_CLIENT_PORT || '5174')

const customBanner = {
  name: 'custom-banner',
  configureServer(server) {
    const { printUrls } = server
    server.printUrls = () => {
      console.log(`\n  🚀 Dashboard: http://localhost:${clientPort}\n`)
      printUrls()
    }
  },
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version),
    __APP_GIT_HASH__: JSON.stringify(gitHash),
    __GITHUB_REPO_URL__: JSON.stringify(process.env.AGENTS_OBSERVE_GITHUB_REPO_URL || rootPkg.repository || ''),
  },
  plugins: [react(), tailwindcss(), customBanner],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: clientPort,
    proxy: {
      '/api': {
        target: `http://localhost:${serverPort}`,
        ws: true,
      },
    },
  },
})
