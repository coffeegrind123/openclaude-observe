// test/fs.test.mjs
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  validatePath,
  ensureLocalDataDirs,
  resolvePluginDataDir,
  readServerPortFile,
  readVersionFile,
} from '../../../../hooks/scripts/lib/fs.mjs'

let testDir

beforeEach(() => {
  testDir = join(tmpdir(), `fs-test-${Date.now()}`)
  mkdirSync(testDir, { recursive: true })
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('validatePath', () => {
  it('returns null for empty string', () => {
    expect(validatePath('')).toBeNull()
  })

  it('returns null for whitespace-only string', () => {
    expect(validatePath('   ')).toBeNull()
  })

  it('returns null for null/undefined', () => {
    expect(validatePath(null)).toBeNull()
    expect(validatePath(undefined)).toBeNull()
  })

  it('throws on null bytes', () => {
    expect(() => validatePath('/some/path\0evil')).toThrow('null bytes')
  })

  it('throws on URLs', () => {
    expect(() => validatePath('http://example.com')).toThrow('URL or flag')
    expect(() => validatePath('https://example.com')).toThrow('URL or flag')
  })

  it('throws on CLI flags', () => {
    expect(() => validatePath('--some-flag')).toThrow('URL or flag')
  })

  it('resolves valid paths', () => {
    const result = validatePath('/tmp/test')
    expect(result).toBe('/tmp/test')
  })

  it('resolves relative paths to absolute', () => {
    const result = validatePath('relative/path')
    expect(result).toContain('relative/path')
    expect(result.startsWith('/')).toBe(true)
  })
})

describe('ensureLocalDataDirs', () => {
  it('creates localDataRootDir, dataDir, and logsDir', () => {
    const config = {
      localDataRootDir: join(testDir, 'root'),
      dataDir: join(testDir, 'root/data'),
      logsDir: join(testDir, 'root/logs'),
    }
    ensureLocalDataDirs(config)
    expect(existsSync(config.localDataRootDir)).toBe(true)
    expect(existsSync(config.dataDir)).toBe(true)
    expect(existsSync(config.logsDir)).toBe(true)
  })

  it('is idempotent — calling twice does not error', () => {
    const config = {
      localDataRootDir: join(testDir, 'root'),
      dataDir: join(testDir, 'root/data'),
      logsDir: join(testDir, 'root/logs'),
    }
    ensureLocalDataDirs(config)
    ensureLocalDataDirs(config)
    expect(existsSync(config.localDataRootDir)).toBe(true)
  })

  it('creates nested directories', () => {
    const config = {
      localDataRootDir: join(testDir, 'a/b/c'),
      dataDir: join(testDir, 'a/b/c/data'),
      logsDir: join(testDir, 'a/b/c/logs'),
    }
    ensureLocalDataDirs(config)
    expect(existsSync(config.dataDir)).toBe(true)
  })
})

describe('resolvePluginDataDir', () => {
  it('returns pluginDataDir when it contains the plugin name', () => {
    const config = {
      pluginDataDir: '/home/user/.claude/plugins/data/agents-observe',
      pluginName: 'agents-observe',
      homeDir: '/home/user',
      serverPortFileName: 'server-port',
    }
    expect(resolvePluginDataDir(config)).toBe('/home/user/.claude/plugins/data/agents-observe')
  })

  it('returns null when pluginDataDir points to wrong plugin and no port file exists', () => {
    const config = {
      pluginDataDir: '/home/user/.claude/plugins/data/some-other-plugin',
      pluginName: 'agents-observe',
      homeDir: testDir,
      serverPortFileName: 'server-port',
    }
    expect(resolvePluginDataDir(config)).toBeNull()
  })

  it('returns null when pluginDataDir is undefined and no port file exists', () => {
    const config = {
      pluginDataDir: undefined,
      pluginName: 'agents-observe',
      homeDir: testDir,
      serverPortFileName: 'server-port',
    }
    expect(resolvePluginDataDir(config)).toBeNull()
  })

  it('returns null when homeDir is empty', () => {
    const config = {
      pluginDataDir: undefined,
      pluginName: 'agents-observe',
      homeDir: '',
      serverPortFileName: 'server-port',
    }
    expect(resolvePluginDataDir(config)).toBeNull()
  })

  it('discovers inline plugin dir via server-port file', () => {
    const inlineDir = join(testDir, '.claude/plugins/data/agents-observe-inline')
    mkdirSync(inlineDir, { recursive: true })
    writeFileSync(join(inlineDir, 'server-port'), '4981')

    const config = {
      pluginDataDir: '/wrong/plugin',
      pluginName: 'agents-observe',
      homeDir: testDir,
      serverPortFileName: 'server-port',
    }
    expect(resolvePluginDataDir(config)).toBe(inlineDir)
  })

  it('discovers bare plugin dir via server-port file', () => {
    const bareDir = join(testDir, '.claude/plugins/data/agents-observe')
    mkdirSync(bareDir, { recursive: true })
    writeFileSync(join(bareDir, 'server-port'), '4981')

    const config = {
      pluginDataDir: '/wrong/plugin',
      pluginName: 'agents-observe',
      homeDir: testDir,
      serverPortFileName: 'server-port',
    }
    expect(resolvePluginDataDir(config)).toBe(bareDir)
  })

  it('prefers inline dir over bare dir when both exist', () => {
    const inlineDir = join(testDir, '.claude/plugins/data/agents-observe-inline')
    const bareDir = join(testDir, '.claude/plugins/data/agents-observe')
    mkdirSync(inlineDir, { recursive: true })
    mkdirSync(bareDir, { recursive: true })
    writeFileSync(join(inlineDir, 'server-port'), '4981')
    writeFileSync(join(bareDir, 'server-port'), '4982')

    const config = {
      pluginDataDir: '/wrong/plugin',
      pluginName: 'agents-observe',
      homeDir: testDir,
      serverPortFileName: 'server-port',
    }
    expect(resolvePluginDataDir(config)).toBe(inlineDir)
  })
})

describe('readServerPortFile', () => {
  it('reads port from file', () => {
    const portFile = join(testDir, 'server-port')
    writeFileSync(portFile, '4981')
    expect(readServerPortFile({ serverPortFile: portFile })).toBe('4981')
  })

  it('trims whitespace from port', () => {
    const portFile = join(testDir, 'server-port')
    writeFileSync(portFile, '  4981\n')
    expect(readServerPortFile({ serverPortFile: portFile })).toBe('4981')
  })

  it('returns null when file does not exist', () => {
    expect(readServerPortFile({ serverPortFile: join(testDir, 'nonexistent') })).toBeNull()
  })

  it('returns null when file is empty', () => {
    const portFile = join(testDir, 'server-port')
    writeFileSync(portFile, '')
    expect(readServerPortFile({ serverPortFile: portFile })).toBeNull()
  })
})

describe('readVersionFile', () => {
  it('reads version from VERSION file at installDir root', () => {
    writeFileSync(join(testDir, 'VERSION'), '0.8.0')
    expect(readVersionFile({ installDir: testDir })).toBe('0.8.0')
  })

  it('trims whitespace from version', () => {
    writeFileSync(join(testDir, 'VERSION'), '  0.8.0\n')
    expect(readVersionFile({ installDir: testDir })).toBe('0.8.0')
  })

  it('returns null when VERSION file does not exist', () => {
    expect(readVersionFile({ installDir: join(testDir, 'nonexistent') })).toBeNull()
  })
})
