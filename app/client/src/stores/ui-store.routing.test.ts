import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore, parseRoute, buildHash, parseView, PROJECT_PLACEHOLDER } from './ui-store'

function fireHashChange(hash: string) {
  window.location.hash = hash
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

beforeEach(() => {
  window.history.replaceState(null, '', '#/')
  useUIStore.setState({
    view: 'observe',
    sidebarTab: 'projects',
    selectedProjectId: null,
    selectedProjectSlug: null,
    selectedSessionId: null,
    editingSessionId: null,
    editingSessionTab: 'details',
    deepLinkView: null,
    routeError: null,
    instructionsSelectedStoreId: null,
    instructionsSelectedFile: null,
  })
})

describe('parseRoute — positional grammar', () => {
  it('home', () => {
    expect(parseRoute('#/')).toMatchObject({ view: 'observe', projectSlug: null, sessionId: null })
    expect(parseRoute('')).toMatchObject({ view: 'observe', projectSlug: null, sessionId: null })
  })

  it('segment 0 is the project, segment 1 the session — no id-shape sniffing', () => {
    expect(parseRoute('#/piproj')).toMatchObject({ projectSlug: 'piproj', sessionId: null })
    expect(parseRoute('#/piproj/not-a-uuid')).toMatchObject({
      projectSlug: 'piproj',
      sessionId: 'not-a-uuid',
    })
    // A legacy `#/<uuid>` link is a project slot now; useRouteSync looks it
    // up as a session when no project matches.
    expect(parseRoute('#/01a0cea5-b997-73d4-853f-9a594c831c4e')).toMatchObject({
      projectSlug: '01a0cea5-b997-73d4-853f-9a594c831c4e',
      sessionId: null,
    })
  })

  it('`_` is the unknown-project placeholder', () => {
    expect(parseRoute('#/_/sess-1')).toMatchObject({ projectSlug: null, sessionId: 'sess-1' })
    // A bare placeholder is home.
    expect(parseRoute('#/_')).toMatchObject({ projectSlug: null, sessionId: null })
  })

  it('decodes percent-encoded segments, so ids may contain ":" and "/"', () => {
    expect(parseRoute('#/my%3Aproj/a%2Fb%3Ac')).toMatchObject({
      projectSlug: 'my:proj',
      sessionId: 'a/b:c',
      deepLinkView: null,
    })
  })

  it('splits the `:view` deep-link suffix, decoding only its @target', () => {
    expect(parseRoute('#/piproj/sess-1:session.stats')).toMatchObject({
      projectSlug: 'piproj',
      sessionId: 'sess-1',
      deepLinkView: 'session.stats',
    })
    expect(parseRoute('#/_/sess-1:session.labels@other%3Aid')).toMatchObject({
      sessionId: 'sess-1',
      deepLinkView: 'session.labels@other:id',
    })
  })

  it('a malformed escape degrades to the raw segment instead of throwing', () => {
    expect(parseRoute('#/bad%E0%A4%A/sess')).toMatchObject({
      projectSlug: 'bad%E0%A4%A',
      sessionId: 'sess',
    })
  })

  it('keeps the reserved #/stack and #/instructions surfaces', () => {
    expect(parseRoute('#/stack')).toMatchObject({ view: 'stack', projectSlug: null })
    expect(parseRoute('#/instructions')).toMatchObject({
      view: 'instructions',
      instructionsStoreId: null,
    })
    expect(parseRoute('#/instructions/home%3A%2Fhome%2Fme/agents%2Fexplorer.md')).toMatchObject({
      view: 'instructions',
      instructionsStoreId: 'home:/home/me',
      instructionsFile: 'agents/explorer.md',
      deepLinkView: null,
    })
  })
})

describe('buildHash / parseView', () => {
  it('round-trips through parseRoute', () => {
    for (const [proj, sess, view] of [
      ['piproj', 'sess-1', null],
      [null, 'sess-1', 'session.stats'],
      ['a:b', 'x/y:z', 'session.labels@q:r'],
      ['piproj', null, null],
    ] as const) {
      const route = parseRoute(buildHash(proj, sess, view))
      expect(route.projectSlug).toBe(proj)
      expect(route.sessionId).toBe(sess)
      expect(route.deepLinkView).toBe(view)
    }
  })

  it('uses the placeholder for a session without a known project', () => {
    expect(buildHash(null, 'sess-1')).toBe(`#/${PROJECT_PLACEHOLDER}/sess-1`)
    expect(buildHash(null, null)).toBe('#/')
  })

  it('parses scope, name and target', () => {
    expect(parseView('session.stats')).toEqual({ scope: 'session', name: 'stats', target: null })
    expect(parseView('session.labels@abc')).toEqual({
      scope: 'session',
      name: 'labels',
      target: 'abc',
    })
    expect(parseView('settings')).toEqual({ scope: 'global', name: 'settings', target: null })
    expect(parseView('weird.thing')).toEqual({
      scope: 'global',
      name: 'weird.thing',
      target: null,
    })
  })
})

describe('store → URL', () => {
  it('a session selected before its project is known uses `#/_/<id>`', () => {
    useUIStore.getState().setSelectedSessionId('sess-1')
    expect(window.location.hash).toBe('#/_/sess-1')
  })

  it('encodes ids and slugs', () => {
    useUIStore.getState().openSession(1, 'my:proj', 'a/b')
    expect(window.location.hash).toBe('#/my%3Aproj/a%2Fb')
  })

  it('openSession is one history entry with project + session', () => {
    const before = window.history.length
    useUIStore.getState().openSession(7, 'piproj', 'sess-1')
    expect(window.history.length).toBe(before + 1)
    expect(window.location.hash).toBe('#/piproj/sess-1')
    const s = useUIStore.getState()
    expect(s.selectedProjectId).toBe(7)
    expect(s.selectedSessionId).toBe('sess-1')
    expect(s.view).toBe('observe')
  })

  it('re-selecting the same session does not stack history entries', () => {
    useUIStore.getState().openSession(7, 'piproj', 'sess-1')
    const before = window.history.length
    useUIStore.getState().setSelectedSessionId('sess-1')
    expect(window.history.length).toBe(before)
  })

  it('the session modal is mirrored into the URL, and closing it strips the suffix', () => {
    useUIStore.getState().openSession(7, 'piproj', 'sess-1')
    useUIStore.getState().setEditingSessionId('sess-1', 'stats')
    expect(window.location.hash).toBe('#/piproj/sess-1:session.stats')
    expect(useUIStore.getState().deepLinkView).toBe('session.stats')

    useUIStore.getState().setEditingSessionId(null)
    expect(window.location.hash).toBe('#/piproj/sess-1')
    expect(useUIStore.getState().deepLinkView).toBeNull()
  })

  it('a modal for another session carries an @target', () => {
    useUIStore.getState().openSession(7, 'piproj', 'sess-1')
    useUIStore.getState().setEditingSessionId('sess-2', 'labels')
    expect(window.location.hash).toBe('#/piproj/sess-1:session.labels@sess-2')
  })

  it('the modal over the instructions page leaves its URL alone', () => {
    useUIStore.getState().openInstructionsFile('home:/home/me', 'AGENTS.md')
    const hash = window.location.hash
    useUIStore.getState().setEditingSessionId('sess-1', 'stats')
    expect(window.location.hash).toBe(hash)
  })

  it('leaving #/instructions for home still pushes `#/`', () => {
    useUIStore.getState().openInstructionsFile('home:/home/me', 'AGENTS.md')
    expect(window.location.hash).toMatch(/^#\/instructions\//)
    useUIStore.getState().setSelectedProject(null)
    expect(window.location.hash).toBe('#/')
    expect(useUIStore.getState().view).toBe('observe')
  })

  it('leaving #/stack for a session pushes the session URL', () => {
    useUIStore.getState().setView('stack')
    useUIStore.getState().openSession(7, 'piproj', 'sess-1')
    expect(window.location.hash).toBe('#/piproj/sess-1')
    expect(useUIStore.getState().view).toBe('observe')
  })
})

describe('URL → store (back / forward)', () => {
  it('a deep-link suffix sets deepLinkView; going back off it closes the modal', () => {
    useUIStore.getState().openSession(7, 'piproj', 'sess-1')
    fireHashChange('#/piproj/sess-1:session.stats')
    expect(useUIStore.getState().deepLinkView).toBe('session.stats')

    // useRouteSync opens the modal from deepLinkView; simulate that.
    useUIStore.setState({ editingSessionId: 'sess-1', editingSessionTab: 'stats' })
    fireHashChange('#/piproj/sess-1')
    expect(useUIStore.getState().deepLinkView).toBeNull()
    expect(useUIStore.getState().editingSessionId).toBeNull()
  })

  it('a `#/_/<id>` URL clears the resolved project so it is re-derived', () => {
    useUIStore.getState().openSession(7, 'piproj', 'sess-1')
    fireHashChange('#/_/sess-2')
    const s = useUIStore.getState()
    expect(s.selectedProjectId).toBeNull()
    expect(s.selectedProjectSlug).toBeNull()
    expect(s.selectedSessionId).toBe('sess-2')
  })

  it('#/instructions and #/stack still switch surfaces', () => {
    fireHashChange('#/instructions/home%3A%2Fhome%2Fme')
    expect(useUIStore.getState().view).toBe('instructions')
    expect(useUIStore.getState().instructionsSelectedStoreId).toBe('home:/home/me')
    fireHashChange('#/stack')
    expect(useUIStore.getState().view).toBe('stack')
    fireHashChange('#/piproj/sess-1')
    expect(useUIStore.getState().view).toBe('observe')
    expect(useUIStore.getState().selectedSessionId).toBe('sess-1')
  })
})
