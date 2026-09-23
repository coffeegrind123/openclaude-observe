import { describe, it, expect } from 'vitest'
import {
  agentIssues,
  composeContent,
  estimateTokens,
  fileCost,
  fileStem,
  formatTokens,
  isOverFileBudget,
  linksFor,
  nodeId,
  normalizePosix,
  parseContent,
  readListField,
  relativeTime,
  resolveMdHref,
  sortHeaders,
  storeOverBudget,
  templateFor,
  writeListField,
} from './instructions-lib'
import type {
  InstructionsFileHeader,
  InstructionsGraph,
  InstructionsGraphNode,
  InstructionsStore,
} from '@/types/instructions'

function header(
  partial: Partial<InstructionsFileHeader> & { relPath: string },
): InstructionsFileHeader {
  return {
    name: partial.relPath.split('/').pop()!,
    role: 'context',
    exists: true,
    bytes: 0,
    mtimeMs: 0,
    hasFrontmatter: false,
    title: partial.relPath,
    snippet: '',
    tokens: 0,
    bodyTokens: 0,
    links: [],
    mdLinks: [],
    shadowedBy: null,
    ...partial,
  }
}

function node(storeId: string, relPath: string, extra: Partial<InstructionsGraphNode> = {}) {
  return {
    id: nodeId(storeId, relPath),
    storeId,
    storeLabel: storeId,
    storeKind: 'project',
    relPath,
    name: relPath.split('/').pop()!,
    title: relPath,
    role: 'context',
    tokens: 0,
    bodyTokens: 0,
    shadowed: false,
    broken: [],
    ...extra,
  } as InstructionsGraphNode
}

function store(id: string, dir: string, kind: InstructionsStore['kind'] = 'project') {
  return {
    id,
    kind,
    label: id,
    dir,
    available: true,
    fileCount: 0,
    missingCount: 0,
    totalBytes: 0,
    tokens: 0,
    lastModifiedMs: null,
  } as InstructionsStore
}

describe('token estimates', () => {
  it('estimates chars/4 like the server', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abcde')).toBe(2)
  })
  it('formats token counts', () => {
    expect(formatTokens(950)).toBe('950')
    expect(formatTokens(1234)).toBe('1.2k')
    expect(formatTokens(23_400)).toBe('23k')
  })
  it('costs agents by body, everything else by whole file', () => {
    expect(fileCost({ role: 'agent', tokens: 900, bodyTokens: 700 })).toBe(700)
    expect(fileCost({ role: 'context', tokens: 900, bodyTokens: 700 })).toBe(900)
    expect(isOverFileBudget({ role: 'context', tokens: 2001, bodyTokens: 0 })).toBe(true)
    expect(isOverFileBudget({ role: 'agent', tokens: 5000, bodyTokens: 100 })).toBe(false)
  })
  it('never flags the agents store as a per-request cost', () => {
    expect(storeOverBudget({ ...store('home:0', '/h'), kind: 'home', tokens: 4001 })).toBe(true)
    expect(storeOverBudget({ ...store('a', '/h'), kind: 'home-agents', tokens: 9000 })).toBe(false)
  })
})

describe('compose/parse round-trip', () => {
  it('composes frontmatter + body matching the server shape', () => {
    const out = composeContent({ name: 'x', tools: ['read'] }, 'body\n')
    expect(out).toBe('---\nname: x\ntools:\n  - read\n---\n\nbody\n')
    const parsed = parseContent(out)
    expect(parsed.frontmatter).toEqual({ name: 'x', tools: ['read'] })
    expect(parsed.body).toBe('body\n')
    expect(composeContent(parsed.frontmatter, parsed.body)).toBe(out)
  })
  it('never folds long values (pi-subagents-lite parses line by line)', () => {
    const long = 'word '.repeat(40).trim()
    expect(composeContent({ description: long }, 'b').split('\n')[1]).toBe(`description: ${long}`)
  })
  it('writes body-only when frontmatter is empty', () => {
    expect(composeContent(null, 'plain')).toBe('plain\n')
    expect(composeContent({}, 'plain\n')).toBe('plain\n')
  })
  it('treats an empty block as no fields and flags malformed YAML', () => {
    expect(parseContent('---\n\n---\nbody').frontmatter).toEqual({})
    const bad = parseContent('---\n: : bad\n---\nbody\n')
    expect(bad.error).toBe(true)
    expect(bad.frontmatter).toBeNull()
  })
})

describe('agent list fields', () => {
  it('reads the all/none/list/unset vocabulary like parseExtensions', () => {
    expect(readListField(undefined).mode).toBe('unset')
    expect(readListField(true).mode).toBe('all')
    expect(readListField('all').mode).toBe('all')
    expect(readListField(false).mode).toBe('none')
    expect(readListField('none').mode).toBe('none')
    expect(readListField(['read', 'grep'])).toEqual({ mode: 'list', items: ['read', 'grep'] })
    expect(readListField('[read, grep]')).toEqual({ mode: 'list', items: ['read', 'grep'] })
  })
  it('writes each mode back', () => {
    expect(writeListField('unset', ['x'])).toBeUndefined()
    expect(writeListField('all', [])).toBe(true)
    expect(writeListField('none', [])).toBe(false)
    expect(writeListField('list', ['a'])).toEqual(['a'])
    expect(writeListField('list', [])).toBeUndefined()
  })
})

describe('agentIssues', () => {
  it('requires a name', () => {
    expect(agentIssues(null, null)[0]).toMatch(/name/)
    expect(agentIssues({ description: 'x' }, 'description: x')[0]).toMatch(/skips/)
  })
  it('accepts a valid definition', () => {
    expect(
      agentIssues({ name: 'a', thinking: 'max', max_turns: 5, hidden: true }, 'name: a'),
    ).toEqual([])
  })
  it('flags bad thinking, numbers and booleans', () => {
    const issues = agentIssues(
      { name: 'a', thinking: 'extreme', max_turns: 'lots', hidden: 'yes' },
      'name: a',
    )
    expect(issues.some((i) => i.includes('thinking'))).toBe(true)
    expect(issues.some((i) => i.includes('max_turns'))).toBe(true)
    expect(issues.some((i) => i.includes('hidden'))).toBe(true)
  })
  it('flags YAML the line-based agent parser misreads', () => {
    expect(
      agentIssues({ name: 'a', description: 'x' }, 'name: a\ndescription: |\n  x'),
    ).toHaveLength(1)
    expect(agentIssues({ name: 'a', meta: { k: 1 } }, 'name: a\nmeta:\n  k: 1')).toHaveLength(1)
    // `- item` lists are fine.
    expect(agentIssues({ name: 'a', tools: ['read'] }, 'name: a\ntools:\n  - read')).toEqual([])
  })
})

describe('links', () => {
  const graph: InstructionsGraph = {
    nodes: [
      node('project:1', 'AGENTS.md', { broken: ['[[nowhere]]'] }),
      node('project:1', '.pi/agents/reviewer.md', { role: 'agent', agentName: 'reviewer' }),
      node('home-agents:0', 'explorer.md', { role: 'agent', agentName: 'explorer' }),
    ],
    edges: [
      {
        source: 'project:1::AGENTS.md',
        target: 'project:1::.pi/agents/reviewer.md',
        kind: 'mdlink',
      },
      {
        source: 'project:1::.pi/agents/reviewer.md',
        target: 'home-agents:0::explorer.md',
        kind: 'agent',
      },
    ],
  }
  it('splits outgoing, incoming and broken links for a node', () => {
    const l = linksFor(graph, 'project:1::.pi/agents/reviewer.md')
    expect(l.outgoing.map((r) => [r.node.relPath, r.kind])).toEqual([['explorer.md', 'agent']])
    expect(l.incoming.map((r) => [r.node.relPath, r.kind])).toEqual([['AGENTS.md', 'mdlink']])
    expect(linksFor(graph, 'project:1::AGENTS.md').broken).toEqual(['[[nowhere]]'])
    expect(linksFor(undefined, 'x')).toEqual({ outgoing: [], incoming: [], broken: [] })
  })
  it('resolves markdown hrefs across stores like the server', () => {
    const stores = [
      store('project:1', '/work/proj'),
      store('home-agents:0', '/home/u/.pi/agent/agents', 'home-agents'),
    ]
    const nodes = [...graph.nodes, node('project:2', 'AGENTS.md')]
    stores.push(store('project:2', '/work/other'))
    expect(resolveMdHref('.pi/agents/reviewer.md', stores[0], 'AGENTS.md', stores, nodes)?.id).toBe(
      'project:1::.pi/agents/reviewer.md',
    )
    expect(
      resolveMdHref('../../AGENTS.md#top', stores[0], '.pi/agents/reviewer.md', stores, nodes)?.id,
    ).toBe('project:1::AGENTS.md')
    expect(resolveMdHref('../other/AGENTS.md', stores[0], 'AGENTS.md', stores, nodes)?.id).toBe(
      'project:2::AGENTS.md',
    )
    expect(
      resolveMdHref('/home/u/.pi/agent/agents/explorer.md', stores[0], 'AGENTS.md', stores, nodes)
        ?.id,
    ).toBe('home-agents:0::explorer.md')
    expect(resolveMdHref('README.md', stores[0], 'AGENTS.md', stores, nodes)).toBeUndefined()
  })
  it('normalises posix paths', () => {
    expect(normalizePosix('/a/b/../c/./d')).toBe('/a/c/d')
    expect(normalizePosix('/a/../../b')).toBe('/b')
  })
})

describe('misc helpers', () => {
  it('derives stems', () => {
    expect(fileStem('.pi/agents/reviewer.md')).toBe('reviewer')
  })
  it('sorts existing files first, then by role and path', () => {
    const out = sortHeaders([
      header({ relPath: 'x.md', role: 'agent' }),
      header({ relPath: 'CLAUDE.md', exists: false }),
      header({ relPath: '.pi/SYSTEM.md', role: 'system' }),
      header({ relPath: 'AGENTS.md' }),
    ])
    expect(out.map((f) => f.relPath)).toEqual(['AGENTS.md', '.pi/SYSTEM.md', 'x.md', 'CLAUDE.md'])
  })
  it('templates new files by role', () => {
    expect(templateFor('agent', 'reviewer')).toMatchObject({ frontmatter: { name: 'reviewer' } })
    expect(templateFor('context')).toHaveProperty('content')
  })
  it('formats relative times', () => {
    expect(relativeTime(null)).toBe('—')
    expect(relativeTime(Date.now())).toBe('just now')
    expect(relativeTime(Date.now() - 5 * 60_000)).toBe('5m ago')
  })
})
