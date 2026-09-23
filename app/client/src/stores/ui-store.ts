import { create } from 'zustand'
import type { Label, ParsedEvent } from '@/types'
import type { TimeRange } from '@/config/time-ranges'
import { getServerHealth } from '@/lib/server-health'
import { ACTIVITY_CONFIG } from '@/config/activity'

// 'stack' is the inference-stack page (llama-server + forge metrics).
export type AppView = 'observe' | 'instructions' | 'stack'

// URL hash grammar. The first segment either names a top-level surface or is
// the project; after that it is positional, never pattern-based:
//   #/                               → home
//   #/stack                          → inference-stack page
//   #/instructions[/<store>[/<file>]] → instructions browser
//   #/<proj>                         → project view
//   #/<proj>/<sess>                  → session in a project
//   #/_/<sess>                       → session whose project isn't known yet
//   …observe routes take an optional `:<view>` deep-link suffix (below).
// No UUID sniffing: any session id format works, and a legacy `#/<sessionId>`
// link is resolved by looking the id up (useRouteSync), not by its shape.
// Every segment is percent-encoded on write and decoded on read, so ids and
// slugs may contain any character; the structural '/', ':' and '@' only ever
// appear encoded inside a segment. `stack` and `instructions` are reserved
// first segments: a project slugged `stack` or `instructions` can't have a
// project URL of its own.
export const PROJECT_PLACEHOLDER = '_'

// decodeURIComponent throws on a stray '%'; a hand-mangled URL should degrade
// to the raw segment instead of crashing the router.
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

// The deep-link view is `scope.name[@target]`: '.' and '@' are structural and
// scope/name are a fixed vocabulary, so only the @target (a session id) can
// carry arbitrary characters — encode/decode just that part.
function encodeViewTarget(view: string): string {
  const at = view.indexOf('@')
  return at === -1 ? view : view.slice(0, at + 1) + encodeURIComponent(view.slice(at + 1))
}
function decodeViewTarget(view: string): string {
  const at = view.indexOf('@')
  return at === -1 ? view : view.slice(0, at + 1) + safeDecode(view.slice(at + 1))
}

/**
 * The canonical observe hash for (project, session, deep-link view). A session
 * without a known project gets the `_` placeholder. Single source of truth for
 * observe URLs: updateHash, history seeding, useRouteSync and session links.
 */
export function buildHash(
  projectSlug: string | null,
  sessionId: string | null,
  view: string | null = null,
): string {
  let path = '/'
  if (sessionId) {
    const proj = projectSlug ? encodeURIComponent(projectSlug) : PROJECT_PLACEHOLDER
    path = `/${proj}/${encodeURIComponent(sessionId)}`
  } else if (projectSlug) {
    path = `/${encodeURIComponent(projectSlug)}`
  }
  return `#${path}${view ? `:${encodeViewTarget(view)}` : ''}`
}

/**
 * Parses a deep-link view (the part after `:`):
 *   `:<name>`               → global            (scope 'global', target null)
 *   `:<scope>.<name>`       → bound to the URL's session / project
 *   `:<scope>.<name>@<id>`  → bound to an explicit id
 * Unknown scopes read as a global name.
 */
export function parseView(view: string): {
  scope: 'global' | 'session' | 'project'
  name: string
  target: string | null
} {
  let target: string | null = null
  let body = view
  const at = view.indexOf('@')
  if (at !== -1) {
    target = view.slice(at + 1) || null
    body = view.slice(0, at)
  }
  const dot = body.indexOf('.')
  if (dot === -1) {
    return { scope: 'global', name: body, target }
  }
  const scope = body.slice(0, dot)
  const name = body.slice(dot + 1)
  if (scope === 'session' || scope === 'project') {
    return { scope, name, target }
  }
  return { scope: 'global', name: body, target }
}

export interface Route {
  view: AppView
  projectSlug: string | null
  sessionId: string | null
  /** Deep-link modal view (the `:x` suffix), observe routes only. */
  deepLinkView: string | null
  instructionsStoreId: string | null
  instructionsFile: string | null
}

const EMPTY_ROUTE: Route = {
  view: 'observe',
  projectSlug: null,
  sessionId: null,
  deepLinkView: null,
  instructionsStoreId: null,
  instructionsFile: null,
}

/** Parses a location hash (with or without the leading '#'). */
export function parseRoute(rawHash: string): Route {
  const hash = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash
  if (!hash || hash === '/') {
    return EMPTY_ROUTE
  }

  // Reserved surfaces are matched on the raw first segment, before the view
  // suffix is split off: instructions paths are percent-encoded, so they
  // never contain a raw ':' — but a stray one must not change the surface.
  const first = hash.split('/').filter(Boolean)[0] ?? ''
  const firstBare = first.split(':')[0]
  if (firstBare === 'stack') {
    return { ...EMPTY_ROUTE, view: 'stack' }
  }
  if (firstBare === 'instructions') {
    // #/instructions, #/instructions/<storeId>, #/instructions/<storeId>/<relPath>
    // (relPath is URI-encoded, so its `/`s don't split into extra parts).
    const parts = hash.split('/').filter(Boolean)
    return {
      ...EMPTY_ROUTE,
      view: 'instructions',
      instructionsStoreId: parts[1] ? safeDecode(parts[1]) : null,
      instructionsFile: parts[2] ? safeDecode(parts[2]) : null,
    }
  }

  // Only one raw ':' per URL — the view delimiter. Colons inside a slug or id
  // are encoded as %3A.
  let path = hash
  let deepLinkView: string | null = null
  const colon = hash.indexOf(':')
  if (colon !== -1) {
    const rawView = hash.slice(colon + 1)
    deepLinkView = rawView ? decodeViewTarget(rawView) : null
    path = hash.slice(0, colon)
  }

  const parts = path.split('/').filter(Boolean).map(safeDecode)
  if (parts.length === 0) {
    return { ...EMPTY_ROUTE, deepLinkView }
  }
  if (parts.length === 1) {
    // A bare placeholder is meaningless — only a session URL's project slot
    // uses it — so it reads as home.
    if (parts[0] === PROJECT_PLACEHOLDER) {
      return { ...EMPTY_ROUTE, deepLinkView }
    }
    return { ...EMPTY_ROUTE, projectSlug: parts[0], deepLinkView }
  }
  // [project-or-placeholder, session]. The placeholder is a null project that
  // useRouteSync fills in from the session.
  return {
    ...EMPTY_ROUTE,
    projectSlug: parts[0] === PROJECT_PLACEHOLDER ? null : parts[0],
    sessionId: parts[1],
    deepLinkView,
  }
}

function parseHash(): Route {
  return parseRoute(window.location.hash)
}

// When true, skip pushState (the URL is already correct from browser navigation)
let suppressHashPush = false

function updateHash(projectSlug: string | null, sessionId: string | null, view: string | null) {
  if (suppressHashPush) {
    return
  }
  // No-op guard: re-setting the same selection (or re-opening the same modal)
  // must not stack duplicate history entries. Compares the parsed route, not
  // raw strings — segments are encoded and browsers may normalize the stored
  // hash. The surface is part of the comparison so leaving #/instructions for
  // home still pushes `#/`.
  const cur = parseHash()
  if (
    cur.view === 'observe' &&
    cur.projectSlug === projectSlug &&
    cur.sessionId === sessionId &&
    cur.deepLinkView === view
  ) {
    return
  }
  window.history.pushState(null, '', buildHash(projectSlug, sessionId, view))
}

function updateInstructionsHash(storeId: string | null, file: string | null) {
  if (suppressHashPush) return
  let hash = '/instructions'
  if (storeId) hash += `/${encodeURIComponent(storeId)}`
  if (storeId && file) hash += `/${encodeURIComponent(file)}`
  window.history.pushState(null, '', `#${hash}`)
}

type EditingSessionTab = 'details' | 'stats' | 'labels'

/**
 * The deep-link view string for the current modal state, or null when no
 * deep-linkable modal is open. The session modal targeting the selected
 * session omits the `@<id>`; targeting another session carries it. Extend
 * this (not ad-hoc writes) as more modals become linkable.
 */
function computeDeepLinkView(state: {
  editingSessionId: string | null
  editingSessionTab: EditingSessionTab
  selectedSessionId: string | null
}): string | null {
  if (state.editingSessionId === null) {
    return null
  }
  const tab = state.editingSessionTab
  return state.editingSessionId === state.selectedSessionId
    ? `session.${tab}`
    : `session.${tab}@${state.editingSessionId}`
}

const SIDEBAR_TAB_KEY = 'instantcoffee-observe-sidebar-tab'
function persistSidebarTab(tab: SidebarTab) {
  try {
    localStorage.setItem(SIDEBAR_TAB_KEY, tab)
  } catch {}
}

type SidebarTab = 'projects' | 'labels' | 'instructions'
const SIDEBAR_TABS: readonly SidebarTab[] = ['projects', 'labels', 'instructions']

interface SessionFilterState {
  activePrimaryFilters: string[]
  activeSecondaryFilters: string[]
  searchQuery: string
}

const DEFAULT_FILTER_STATE: SessionFilterState = {
  activePrimaryFilters: [],
  activeSecondaryFilters: [],
  searchQuery: '',
}

interface UIState {
  sidebarCollapsed: boolean
  sidebarWidth: number
  setSidebarCollapsed: (collapsed: boolean) => void
  setSidebarWidth: (width: number) => void

  // Top-level view. 'observe' = the session/event dashboard; 'instructions' =
  // the pi instruction-file browser/editor. Reflected in the URL hash
  // (#/instructions).
  view: AppView
  setView: (view: AppView) => void

  selectedProjectId: number | null
  selectedProjectSlug: string | null
  selectedSessionId: string | null
  selectedAgentIds: string[]
  setSelectedProject: (id: number | null, slug?: string | null) => void
  setSelectedSessionId: (id: string | null) => void
  /**
   * Open a session from outside its project (home, constellation, pinned) as
   * ONE history entry. setSelectedProject + setSelectedSessionId push two
   * (`#/slug`, then `#/slug/id`), stranding Back on an intermediate page.
   */
  openSession: (projectId: number | null, slug: string | null, sessionId: string) => void

  // Preview selection: highlights a session (and expands its project) in the
  // sidebar WITHOUT navigating or touching the URL. The Constellation home
  // view's drill-in sets it so the sidebar tracks the focused star while the
  // home view stays mounted.
  previewProjectId: number | null
  previewSessionId: string | null
  setPreviewSession: (sessionId: string | null, projectId: number | null) => void
  clearPreviewSession: () => void

  // Home view (a registered dashboard theme id, see src/dashboard/). Persisted.
  dashboardThemeId: string
  setDashboardThemeId: (id: string) => void
  updateProjectSlug: (slug: string) => void
  setSelectedAgentIds: (ids: string[]) => void
  toggleAgentId: (id: string) => void
  removeAgentId: (id: string) => void

  // Instructions browser selection — which store (pi home / home subagents /
  // project) and which file within it are open.
  instructionsSelectedStoreId: string | null
  instructionsSelectedFile: string | null
  setInstructionsStore: (id: string | null) => void
  setInstructionsFile: (relPath: string | null) => void
  /** Jump straight to a file in any store (one history entry). */
  openInstructionsFile: (storeId: string, relPath: string | null) => void

  activePrimaryFilters: string[] // labels from primary filters
  activeSecondaryFilters: string[] // tool names from secondary filters
  searchQuery: string
  sessionFilterStates: Map<string, SessionFilterState> // per-session filter state
  togglePrimaryFilter: (label: string) => void
  toggleSecondaryFilter: (toolName: string) => void
  clearAllFilters: () => void
  setSearchQuery: (query: string) => void

  timelineHeight: number
  timeRange: TimeRange
  setTimelineHeight: (height: number) => void
  setTimeRange: (range: TimeRange) => void

  expandedEventIds: Set<number>
  scrollToEventId: number | null
  // Event id currently flashing after a scroll-to. Stored at the store level
  // (not local row state) so the flash survives row unmount/remount during
  // virtualizer scrolling — common when scrolling long distances in rewind.
  flashingEventId: number | null
  expandAllCounter: number // incremented to signal "expand all" to event stream
  // The most recently expanded event id — the "row the user is focused
  // on." Used to keep that row in view when filters/search change. Reset
  // on explicit re-collapse of the same row, expand/collapse all, auto-
  // follow re-enable, and session/project switches.
  lastExpandedEventId: number | null
  toggleExpandedEvent: (id: number) => void
  collapseAllEvents: () => void
  requestExpandAll: () => void
  expandAllEvents: (ids: number[]) => void
  setScrollToEventId: (id: number | null) => void
  setFlashingEventId: (id: number | null) => void

  // Selected event (highlighted row)
  selectedEventId: number | null
  setSelectedEventId: (id: number | null) => void

  // Default collapse state of the conversation thread in newly opened event
  // details (in-memory, default expanded). Details SEED their own state from
  // this at mount and write back on toggle — they must not subscribe, or
  // toggling one thread would collapse every open detail and jump the stream.
  threadCollapsed: boolean
  setThreadCollapsed: (collapsed: boolean) => void

  // Set by an inline detail whose thread toggle changed its row's height, so
  // EventStream re-measures that row synchronously (layout effect) and the
  // virtualizer reflows + anchors in the same frame, instead of a frame late
  // via ResizeObserver (a visible flash). Cleared once handled.
  threadRemeasureEventId: number | null
  setThreadRemeasureEventId: (id: number | null) => void

  // Session being edited in the SessionEditModal (null = closed)
  editingSessionId: string | null
  editingSessionTab: EditingSessionTab
  setEditingSessionId: (id: string | null, tab?: EditingSessionTab) => void

  // Deep-link view: the `:session.stats` / `:session.labels@<id>` suffix on
  // an observe URL. Mirrors the open modal into the URL (the actions above
  // write it); useRouteSync drives the reverse, URL → modal, on direct loads
  // and back/forward.
  deepLinkView: string | null
  setDeepLinkView: (view: string | null) => void

  // Session id or project slug from the URL that matched nothing, so the
  // main panel can say "not found" instead of staying blank.
  routeError: string | null
  setRouteError: (idOrSlug: string) => void
  clearRouteError: () => void

  // Labels — user-defined bookmarks across sessions (localStorage only)
  labels: Label[]
  labelMemberships: Map<string, Set<string>> // labelId → sessionIds
  createLabel: (name: string) => Label | null
  renameLabel: (id: string, name: string) => boolean
  deleteLabel: (id: string) => void
  toggleSessionLabel: (labelId: string, sessionId: string) => void
  getLabelsForSession: (sessionId: string) => Label[]
  // Labels live in a tab of the Settings modal now. openLabelsModal
  // just routes to that tab with an optional scroll-to target; close
  // drops you out of Settings entirely. labelsModalScrollToId is still
  // read by the tab body on mount.
  labelsModalScrollToId: string | null
  openLabelsModal: (scrollToLabelId?: string) => void
  closeLabelsModal: () => void
  clearLabelsModalScrollTarget: () => void

  // Sidebar Projects/Labels/Instructions tab selector — persisted so the
  // sidebar re-opens on whichever view the user was last using. The
  // Instructions tab also drives the top-level `view`.
  sidebarTab: SidebarTab
  setSidebarTab: (tab: SidebarTab) => void

  // Settings modal
  settingsOpen: boolean
  settingsTab: string
  openSettings: (tab?: string) => void
  setSettingsTab: (tab: string) => void
  closeSettings: () => void
  // Last filter id viewed in the Filters tab — persisted so reopening
  // the modal lands on the same filter the user was last editing.
  lastFilterId: string | null
  setLastFilterId: (id: string | null) => void

  // Auto-follow
  autoFollow: boolean
  setAutoFollow: (enabled: boolean) => void

  // Notification alerts — when off, the sidebar bells never appear.
  notificationsEnabled: boolean
  setNotificationsEnabled: (enabled: boolean) => void

  // Active-session indicator — the green pulse on the sidebar session dot /
  // project folder after activity. `activeIndicatorEnabled` toggles it;
  // `activeIndicatorSeconds` is how long it stays lit before fading.
  activeIndicatorEnabled: boolean
  setActiveIndicatorEnabled: (enabled: boolean) => void
  activeIndicatorSeconds: number
  setActiveIndicatorSeconds: (seconds: number) => void

  // Rewind mode: freezes the event/timeline view at a snapshot of events
  rewindMode: boolean
  frozenEvents: ParsedEvent[] | null
  /** Pre-rewind autoFollow value, restored on exit */
  autoFollowBeforeRewind: boolean
  enterRewindMode: (events: ParsedEvent[]) => void
  exitRewindMode: () => void

  // Session sort order in sidebar
  sessionSortOrder: 'activity' | 'created'
  setSessionSortOrder: (order: 'activity' | 'created') => void

  // Pinned sessions (persisted to localStorage)
  pinnedSessionIds: Set<string>
  togglePinnedSession: (id: string) => void
  isSessionPinned: (id: string) => boolean

  // Feed direction (persisted to localStorage). When true, newest events appear
  // at the top and older events flow downwards. Default is true.
  reverseFeed: boolean
  setReverseFeed: (enabled: boolean) => void

  // Pre/Post merge (persisted). On (default): a tool call's PostToolUse /
  // PostToolUseFailure folds into its PreToolUse row. Off: every hook event
  // is its own row, labelled with its hook name — for seeing exactly what
  // the extension sent.
  mergeToolEvents: boolean
  setMergeToolEvents: (enabled: boolean) => void

  // River view lens. false = full "stream" (everything); true = "talk"
  // (conversation only — prompts + assistant / subagent / task messages,
  // tool + topology telemetry hidden). In-memory; resets per session load.
  talkMode: boolean
  setTalkMode: (on: boolean) => void

  // Icon customization reactivity
  iconCustomizationVersion: number
  bumpIconCustomizationVersion: () => void

  // Session activity pulses — incremented each time the server
  // broadcasts an `activity` WS message for a session. In-memory only;
  // no persistence. Sidebar components subscribe to the specific
  // session's count and play a one-shot pulse animation when it
  // changes.
  sessionPulses: Record<string, number>
  /** Project-scoped pulse counter, parallel to sessionPulses. Lets the
   *  sidebar pulse a project folder without fetching the project's
   *  session list (activity pings carry projectId). */
  projectPulses: Record<number, number>
  /** Wall-clock ms of each session's latest activity ping. The Constellation
   *  render loop reads it every frame for live star heat without re-fetching. */
  sessionActivityAt: Record<string, number>
  pulseSession: (sessionId: string, projectId?: number | null) => void

  // Version tracking
  serverVersion: string | null
  setServerVersion: (version: string) => void
  latestVersion: string | null
  setLatestVersion: (version: string) => void
}

const PINNED_STORAGE_KEY = 'instantcoffee-observe-pinned-sessions'
const REVERSE_FEED_STORAGE_KEY = 'instantcoffee-observe-reverse-feed'
const MERGE_TOOL_EVENTS_STORAGE_KEY = 'instantcoffee-observe-merge-tool-events'
const DASHBOARD_THEME_STORAGE_KEY = 'instantcoffee-observe-dashboard-theme'

// The recent-sessions list stays the home view unless the user picks another
// (the dashboard registry resolves unknown ids back to it).
function loadDashboardThemeId(): string {
  try {
    return localStorage.getItem(DASHBOARD_THEME_STORAGE_KEY) || 'sessions-list'
  } catch {
    return 'sessions-list'
  }
}

function loadMergeToolEvents(): boolean {
  try {
    return localStorage.getItem(MERGE_TOOL_EVENTS_STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

function loadPinnedSessions(): Set<string> {
  try {
    const raw = localStorage.getItem(PINNED_STORAGE_KEY)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch {
    return new Set()
  }
}

function savePinnedSessions(ids: Set<string>) {
  localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify([...ids]))
}

function loadReverseFeed(): boolean {
  try {
    const raw = localStorage.getItem(REVERSE_FEED_STORAGE_KEY)
    return raw === null ? true : raw === 'true'
  } catch {
    return true
  }
}

const ACTIVE_INDICATOR_STORAGE_KEY = 'instantcoffee-observe-active-indicator'
const ACTIVE_INDICATOR_SECONDS_STORAGE_KEY = 'instantcoffee-observe-active-indicator-seconds'

function readActiveIndicatorSeconds(): number {
  const raw = localStorage.getItem(ACTIVE_INDICATOR_SECONDS_STORAGE_KEY)
  const n = raw != null ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : ACTIVITY_CONFIG.pulseDurationMs / 1000
}

const LABELS_STORAGE_KEY = 'instantcoffee-observe-labels'
const LABEL_MEMBERSHIP_STORAGE_KEY = 'instantcoffee-observe-label-memberships'

function loadLabels(): Label[] {
  try {
    const raw = localStorage.getItem(LABELS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (l): l is Label =>
        l &&
        typeof l.id === 'string' &&
        typeof l.name === 'string' &&
        typeof l.createdAt === 'number',
    )
  } catch {
    return []
  }
}

function saveLabels(labels: Label[]) {
  localStorage.setItem(LABELS_STORAGE_KEY, JSON.stringify(labels))
}

function loadLabelMemberships(): Map<string, Set<string>> {
  try {
    const raw = localStorage.getItem(LABEL_MEMBERSHIP_STORAGE_KEY)
    if (!raw) return new Map()
    const parsed = JSON.parse(raw) as Record<string, string[]>
    const map = new Map<string, Set<string>>()
    for (const [labelId, sessionIds] of Object.entries(parsed)) {
      if (Array.isArray(sessionIds)) map.set(labelId, new Set(sessionIds))
    }
    return map
  } catch {
    return new Map()
  }
}

function saveLabelMemberships(memberships: Map<string, Set<string>>) {
  const obj: Record<string, string[]> = {}
  for (const [labelId, sessionIds] of memberships) {
    obj[labelId] = [...sessionIds]
  }
  localStorage.setItem(LABEL_MEMBERSHIP_STORAGE_KEY, JSON.stringify(obj))
}

function genLabelId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `label-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

const initialRoute = parseHash()
const {
  projectSlug: initialProjectSlug,
  sessionId: initialSessionId,
  view: initialView,
  instructionsStoreId: initialInstructionsStoreId,
  instructionsFile: initialInstructionsFile,
  deepLinkView: initialDeepLinkView,
} = initialRoute

// A persisted value from an older build (e.g. the removed 'memory' tab) falls
// back to Projects rather than selecting a tab that no longer exists.
function storedSidebarTab(): SidebarTab {
  try {
    const v = localStorage.getItem(SIDEBAR_TAB_KEY)
    return SIDEBAR_TABS.includes(v as SidebarTab) ? (v as SidebarTab) : 'projects'
  } catch {
    return 'projects'
  }
}

const initialSidebarTab: SidebarTab =
  initialView === 'instructions' ? 'instructions' : storedSidebarTab()

export const useUIStore = create<UIState>((set, get) => ({
  sidebarCollapsed: false,
  sidebarWidth: 260,
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),

  view: initialView,
  setView: (view) => {
    set({ view })
    if (view === 'stack') {
      if (!suppressHashPush) {
        window.history.pushState(null, '', '#/stack')
      }
    } else if (view === 'instructions') {
      const s = get()
      updateInstructionsHash(s.instructionsSelectedStoreId, s.instructionsSelectedFile)
    } else {
      const s = get()
      updateHash(s.selectedProjectSlug, s.selectedSessionId, s.deepLinkView)
    }
  },

  instructionsSelectedStoreId: initialInstructionsStoreId,
  instructionsSelectedFile: initialInstructionsFile,
  setInstructionsStore: (id) => {
    set({
      view: 'instructions',
      sidebarTab: 'instructions',
      instructionsSelectedStoreId: id,
      instructionsSelectedFile: null,
    })
    persistSidebarTab('instructions')
    updateInstructionsHash(id, null)
  },
  setInstructionsFile: (relPath) => {
    const storeId = get().instructionsSelectedStoreId
    set({ view: 'instructions', instructionsSelectedFile: relPath })
    updateInstructionsHash(storeId, relPath)
  },
  openInstructionsFile: (storeId, relPath) => {
    set({
      view: 'instructions',
      sidebarTab: 'instructions',
      instructionsSelectedStoreId: storeId,
      instructionsSelectedFile: relPath,
    })
    persistSidebarTab('instructions')
    updateInstructionsHash(storeId, relPath)
  },

  selectedProjectId: null,
  selectedProjectSlug: initialProjectSlug,
  selectedSessionId: initialSessionId,
  selectedAgentIds: [],
  setSelectedProject: (id, slug) => {
    const state = get()
    const nextFilterStates = new Map(state.sessionFilterStates)

    // Save current session's filter state before switching projects
    if (state.selectedSessionId) {
      nextFilterStates.set(state.selectedSessionId, {
        activePrimaryFilters: state.activePrimaryFilters,
        activeSecondaryFilters: state.activeSecondaryFilters,
        searchQuery: state.searchQuery,
      })
    }

    const newSlug = slug ?? null
    // Selecting observe content leaves the instructions view. If the sidebar
    // was on the Instructions tab, drop back to Projects so the chrome stays
    // coherent.
    const nextTab: SidebarTab = state.sidebarTab === 'instructions' ? 'projects' : state.sidebarTab
    if (nextTab !== state.sidebarTab) persistSidebarTab(nextTab)
    set({
      view: 'observe',
      sidebarTab: nextTab,
      selectedProjectId: id,
      selectedProjectSlug: newSlug,
      selectedSessionId: null,
      selectedAgentIds: [],
      expandedEventIds: new Set(),
      lastExpandedEventId: null,
      selectedEventId: null,
      scrollToEventId: null,
      sessionFilterStates: nextFilterStates,
      activePrimaryFilters: DEFAULT_FILTER_STATE.activePrimaryFilters,
      activeSecondaryFilters: DEFAULT_FILTER_STATE.activeSecondaryFilters,
      searchQuery: DEFAULT_FILTER_STATE.searchQuery,
    })
    const view = computeDeepLinkView(get())
    if (get().deepLinkView !== view) {
      set({ deepLinkView: view })
    }
    updateHash(newSlug, null, view)
  },
  setSelectedSessionId: (id) => {
    const state = get()
    const nextFilterStates = new Map(state.sessionFilterStates)

    // Save current session's filter state before switching
    if (state.selectedSessionId) {
      nextFilterStates.set(state.selectedSessionId, {
        activePrimaryFilters: state.activePrimaryFilters,
        activeSecondaryFilters: state.activeSecondaryFilters,
        searchQuery: state.searchQuery,
      })
    }

    // Restore saved filter state for the new session, or default to "All"
    const restored = id ? (nextFilterStates.get(id) ?? DEFAULT_FILTER_STATE) : DEFAULT_FILTER_STATE

    // Auto-exit rewind mode if switching to a different session — frozen events
    // from the old session would be stale.
    const exitingRewind = state.rewindMode && state.selectedSessionId !== id
    const nextTab: SidebarTab = state.sidebarTab === 'instructions' ? 'projects' : state.sidebarTab
    if (nextTab !== state.sidebarTab) persistSidebarTab(nextTab)
    set({
      view: 'observe',
      sidebarTab: nextTab,
      selectedSessionId: id,
      selectedAgentIds: [],
      expandedEventIds: new Set(),
      lastExpandedEventId: null,
      selectedEventId: null,
      scrollToEventId: null,
      sessionFilterStates: nextFilterStates,
      activePrimaryFilters: restored.activePrimaryFilters,
      activeSecondaryFilters: restored.activeSecondaryFilters,
      searchQuery: restored.searchQuery,
      ...(exitingRewind && {
        rewindMode: false,
        frozenEvents: null,
        autoFollow: state.autoFollowBeforeRewind,
      }),
    })
    const view = computeDeepLinkView(get())
    if (get().deepLinkView !== view) {
      set({ deepLinkView: view })
    }
    updateHash(state.selectedProjectSlug, id, view)
  },
  openSession: (projectId, slug, sessionId) => {
    const state = get()
    const nextFilterStates = new Map(state.sessionFilterStates)
    if (state.selectedSessionId) {
      nextFilterStates.set(state.selectedSessionId, {
        activePrimaryFilters: state.activePrimaryFilters,
        activeSecondaryFilters: state.activeSecondaryFilters,
        searchQuery: state.searchQuery,
      })
    }
    const restored = nextFilterStates.get(sessionId) ?? DEFAULT_FILTER_STATE
    const newSlug = slug ?? null
    const exitingRewind = state.rewindMode && state.selectedSessionId !== sessionId
    const nextTab: SidebarTab = state.sidebarTab === 'instructions' ? 'projects' : state.sidebarTab
    if (nextTab !== state.sidebarTab) persistSidebarTab(nextTab)
    set({
      view: 'observe',
      sidebarTab: nextTab,
      selectedProjectId: projectId,
      selectedProjectSlug: newSlug,
      selectedSessionId: sessionId,
      selectedAgentIds: [],
      expandedEventIds: new Set(),
      lastExpandedEventId: null,
      selectedEventId: null,
      scrollToEventId: null,
      sessionFilterStates: nextFilterStates,
      activePrimaryFilters: restored.activePrimaryFilters,
      activeSecondaryFilters: restored.activeSecondaryFilters,
      searchQuery: restored.searchQuery,
      ...(exitingRewind && {
        rewindMode: false,
        frozenEvents: null,
        autoFollow: state.autoFollowBeforeRewind,
      }),
    })
    const view = computeDeepLinkView(get())
    if (get().deepLinkView !== view) {
      set({ deepLinkView: view })
    }
    updateHash(newSlug, sessionId, view)
  },
  previewProjectId: null,
  previewSessionId: null,
  setPreviewSession: (sessionId, projectId) =>
    set({ previewSessionId: sessionId, previewProjectId: projectId }),
  clearPreviewSession: () => {
    if (get().previewSessionId !== null || get().previewProjectId !== null) {
      set({ previewSessionId: null, previewProjectId: null })
    }
  },

  dashboardThemeId: loadDashboardThemeId(),
  setDashboardThemeId: (id) => {
    try {
      localStorage.setItem(DASHBOARD_THEME_STORAGE_KEY, id)
    } catch {}
    set({ dashboardThemeId: id })
  },

  updateProjectSlug: (slug) => {
    set({ selectedProjectSlug: slug })
    const state = get()
    updateHash(slug, state.selectedSessionId, state.deepLinkView)
  },
  setSelectedAgentIds: (ids) => set({ selectedAgentIds: ids }),
  toggleAgentId: (id) =>
    set((s) => ({
      selectedAgentIds: s.selectedAgentIds.includes(id)
        ? s.selectedAgentIds.filter((a) => a !== id)
        : [...s.selectedAgentIds, id],
    })),
  removeAgentId: (id) =>
    set((s) => ({ selectedAgentIds: s.selectedAgentIds.filter((a) => a !== id) })),

  activePrimaryFilters: [],
  activeSecondaryFilters: [],
  searchQuery: '',
  sessionFilterStates: new Map(),
  togglePrimaryFilter: (label) =>
    set((s) => ({
      activePrimaryFilters: s.activePrimaryFilters.includes(label)
        ? s.activePrimaryFilters.filter((l) => l !== label)
        : [...s.activePrimaryFilters, label],
    })),
  toggleSecondaryFilter: (toolName) =>
    set((s) => ({
      activeSecondaryFilters: s.activeSecondaryFilters.includes(toolName)
        ? s.activeSecondaryFilters.filter((t) => t !== toolName)
        : [...s.activeSecondaryFilters, toolName],
    })),
  clearAllFilters: () => set({ activePrimaryFilters: [], activeSecondaryFilters: [] }),
  setSearchQuery: (query) => set({ searchQuery: query }),

  timelineHeight: 150,
  timeRange: '5m',
  setTimelineHeight: (height) => set({ timelineHeight: height }),
  setTimeRange: (range) => set({ timeRange: range }),

  expandedEventIds: new Set(),
  scrollToEventId: null,
  flashingEventId: null,
  lastExpandedEventId: null,
  toggleExpandedEvent: (id) =>
    set((s) => {
      const next = new Set(s.expandedEventIds)
      const isExpanding = !next.has(id)
      if (isExpanding) next.add(id)
      else next.delete(id)
      // Expanding marks this row as the user's focus. Any collapse
      // (even of a non-focused row) clears focus — the user is
      // signaling "I'm done inspecting." Next expand sets a new focus.
      return {
        expandedEventIds: next,
        lastExpandedEventId: isExpanding ? id : null,
        ...(isExpanding ? { autoFollow: false } : {}),
      }
    }),
  expandAllCounter: 0,
  collapseAllEvents: () => set({ expandedEventIds: new Set(), lastExpandedEventId: null }),
  requestExpandAll: () =>
    set((s) => ({
      expandAllCounter: s.expandAllCounter + 1,
      autoFollow: false,
      lastExpandedEventId: null,
    })),
  expandAllEvents: (ids: number[]) =>
    set({ expandedEventIds: new Set(ids), autoFollow: false, lastExpandedEventId: null }),
  setScrollToEventId: (id) => set({ scrollToEventId: id }),
  setFlashingEventId: (id) => set({ flashingEventId: id }),

  selectedEventId: null,
  setSelectedEventId: (id) => set({ selectedEventId: id }),

  threadCollapsed: false,
  setThreadCollapsed: (collapsed) => set({ threadCollapsed: collapsed }),

  threadRemeasureEventId: null,
  setThreadRemeasureEventId: (id) => set({ threadRemeasureEventId: id }),

  editingSessionId: null,
  editingSessionTab: 'details',
  setEditingSessionId: (id, tab) => {
    set({ editingSessionId: id, editingSessionTab: tab ?? 'details' })
    const state = get()
    const view = computeDeepLinkView(state)
    if (state.deepLinkView !== view) {
      set({ deepLinkView: view })
    }
    // The modal can open over the stack / instructions surfaces too; only an
    // observe URL carries a deep-link suffix.
    if (state.view === 'observe') {
      updateHash(state.selectedProjectSlug, state.selectedSessionId, view)
    }
  },

  deepLinkView: initialView === 'observe' ? initialDeepLinkView : null,
  setDeepLinkView: (view) => {
    set({ deepLinkView: view })
    const state = get()
    if (state.view === 'observe') {
      updateHash(state.selectedProjectSlug, state.selectedSessionId, view)
    }
  },

  routeError: null,
  setRouteError: (idOrSlug) => {
    if (get().routeError !== idOrSlug) {
      set({ routeError: idOrSlug })
    }
  },
  clearRouteError: () => {
    if (get().routeError !== null) {
      set({ routeError: null })
    }
  },

  sidebarTab: initialSidebarTab,
  setSidebarTab: (tab) => {
    persistSidebarTab(tab)
    if (tab === 'instructions') {
      const s = get()
      set({ sidebarTab: tab, view: 'instructions' })
      updateInstructionsHash(s.instructionsSelectedStoreId, s.instructionsSelectedFile)
    } else {
      const s = get()
      set({ sidebarTab: tab, view: 'observe' })
      updateHash(s.selectedProjectSlug, s.selectedSessionId, s.deepLinkView)
    }
  },

  settingsOpen: false,
  // Remember the last tab the user viewed so the gear icon reopens
  // there. Fall back to 'display' (the leftmost tab) on first use.
  settingsTab: localStorage.getItem('instantcoffee-observe-settings-tab') || 'display',
  openSettings: (tab) => {
    if (tab) {
      localStorage.setItem('instantcoffee-observe-settings-tab', tab)
      set({ settingsOpen: true, settingsTab: tab })
    } else {
      set({ settingsOpen: true })
    }
  },
  setSettingsTab: (tab) => {
    localStorage.setItem('instantcoffee-observe-settings-tab', tab)
    set({ settingsTab: tab })
  },
  closeSettings: () => set({ settingsOpen: false }),

  lastFilterId: localStorage.getItem('instantcoffee-observe-last-filter-id') || null,
  setLastFilterId: (id) => {
    if (id) localStorage.setItem('instantcoffee-observe-last-filter-id', id)
    else localStorage.removeItem('instantcoffee-observe-last-filter-id')
    set({ lastFilterId: id })
  },

  autoFollow: true,
  setAutoFollow: (enabled) =>
    set((s) => ({
      autoFollow: enabled,
      // Turning auto-follow back on is an explicit opt-out of the
      // "stay on the row I was inspecting" behavior.
      lastExpandedEventId: enabled ? null : s.lastExpandedEventId,
    })),

  notificationsEnabled: localStorage.getItem('instantcoffee-observe-notifications') !== 'off',
  setNotificationsEnabled: (enabled) => {
    localStorage.setItem('instantcoffee-observe-notifications', enabled ? 'on' : 'off')
    set({ notificationsEnabled: enabled })
  },

  activeIndicatorEnabled: localStorage.getItem(ACTIVE_INDICATOR_STORAGE_KEY) !== 'off',
  setActiveIndicatorEnabled: (enabled) => {
    localStorage.setItem(ACTIVE_INDICATOR_STORAGE_KEY, enabled ? 'on' : 'off')
    set({ activeIndicatorEnabled: enabled })
  },

  activeIndicatorSeconds: readActiveIndicatorSeconds(),
  setActiveIndicatorSeconds: (seconds) => {
    localStorage.setItem(ACTIVE_INDICATOR_SECONDS_STORAGE_KEY, String(seconds))
    set({ activeIndicatorSeconds: seconds })
  },

  rewindMode: false,
  frozenEvents: null,
  autoFollowBeforeRewind: true,
  enterRewindMode: (events) =>
    set((s) => ({
      rewindMode: true,
      frozenEvents: events,
      autoFollowBeforeRewind: s.autoFollow,
      autoFollow: false,
    })),
  exitRewindMode: () =>
    set((s) => ({
      rewindMode: false,
      frozenEvents: null,
      autoFollow: s.autoFollowBeforeRewind,
    })),

  sessionSortOrder: 'activity',
  setSessionSortOrder: (order) => set({ sessionSortOrder: order }),

  pinnedSessionIds: loadPinnedSessions(),
  togglePinnedSession: (id) =>
    set((s) => {
      const next = new Set(s.pinnedSessionIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      savePinnedSessions(next)
      return { pinnedSessionIds: next }
    }),
  isSessionPinned: (id) => get().pinnedSessionIds.has(id),

  reverseFeed: loadReverseFeed(),
  setReverseFeed: (enabled) => {
    try {
      localStorage.setItem(REVERSE_FEED_STORAGE_KEY, String(enabled))
    } catch {}
    set({ reverseFeed: enabled })
  },

  mergeToolEvents: loadMergeToolEvents(),
  setMergeToolEvents: (enabled) => {
    try {
      localStorage.setItem(MERGE_TOOL_EVENTS_STORAGE_KEY, String(enabled))
    } catch {}
    set({ mergeToolEvents: enabled })
  },

  talkMode: false,
  setTalkMode: (on) => set({ talkMode: on }),

  labels: loadLabels(),
  labelMemberships: loadLabelMemberships(),
  createLabel: (name) => {
    const trimmed = name.trim()
    if (!trimmed) return null
    const state = get()
    const lower = trimmed.toLowerCase()
    if (state.labels.some((l) => l.name.toLowerCase() === lower)) return null
    const label: Label = { id: genLabelId(), name: trimmed, createdAt: Date.now() }
    const nextLabels = [...state.labels, label]
    saveLabels(nextLabels)
    set({ labels: nextLabels })
    return label
  },
  renameLabel: (id, name) => {
    const trimmed = name.trim()
    if (!trimmed) return false
    const state = get()
    const lower = trimmed.toLowerCase()
    if (state.labels.some((l) => l.id !== id && l.name.toLowerCase() === lower)) return false
    const nextLabels = state.labels.map((l) => (l.id === id ? { ...l, name: trimmed } : l))
    saveLabels(nextLabels)
    set({ labels: nextLabels })
    return true
  },
  deleteLabel: (id) =>
    set((s) => {
      const nextLabels = s.labels.filter((l) => l.id !== id)
      const nextMemberships = new Map(s.labelMemberships)
      nextMemberships.delete(id)
      saveLabels(nextLabels)
      saveLabelMemberships(nextMemberships)
      return { labels: nextLabels, labelMemberships: nextMemberships }
    }),
  toggleSessionLabel: (labelId, sessionId) =>
    set((s) => {
      const nextMemberships = new Map(s.labelMemberships)
      const existing = new Set(nextMemberships.get(labelId) ?? [])
      if (existing.has(sessionId)) existing.delete(sessionId)
      else existing.add(sessionId)
      nextMemberships.set(labelId, existing)
      saveLabelMemberships(nextMemberships)
      return { labelMemberships: nextMemberships }
    }),
  getLabelsForSession: (sessionId) => {
    const state = get()
    return state.labels.filter((l) => state.labelMemberships.get(l.id)?.has(sessionId))
  },
  labelsModalScrollToId: null,
  openLabelsModal: (scrollToLabelId) => {
    localStorage.setItem('instantcoffee-observe-settings-tab', 'labels')
    set({
      settingsOpen: true,
      settingsTab: 'labels',
      labelsModalScrollToId: scrollToLabelId ?? null,
    })
  },
  closeLabelsModal: () => set({ settingsOpen: false, labelsModalScrollToId: null }),
  clearLabelsModalScrollTarget: () => set({ labelsModalScrollToId: null }),

  iconCustomizationVersion: 0,
  bumpIconCustomizationVersion: () =>
    set((s) => ({ iconCustomizationVersion: s.iconCustomizationVersion + 1 })),

  sessionPulses: {},
  projectPulses: {},
  sessionActivityAt: {},
  pulseSession: (sessionId, projectId) =>
    set((s) => {
      const sessionPulses = {
        ...s.sessionPulses,
        [sessionId]: (s.sessionPulses[sessionId] ?? 0) + 1,
      }
      const sessionActivityAt = { ...s.sessionActivityAt, [sessionId]: Date.now() }
      // Leave projectPulses' identity alone on project-less pings so
      // project subscribers don't re-render for nothing.
      if (projectId == null) {
        return { sessionPulses, sessionActivityAt }
      }
      return {
        sessionPulses,
        sessionActivityAt,
        projectPulses: {
          ...s.projectPulses,
          [projectId]: (s.projectPulses[projectId] ?? 0) + 1,
        },
      }
    }),

  serverVersion: null,
  setServerVersion: (version) => set({ serverVersion: version }),
  latestVersion: null,
  setLatestVersion: (version) => set({ latestVersion: version }),
}))

if (typeof window !== 'undefined') {
  // Seed history for direct URL loads so the back button has somewhere to go.
  // If loading #/project/session, push #/project first (project view),
  // then replace with the full URL. Back then goes to project view.
  if (initialView === 'instructions') {
    // Seed history so back from a file lands on the store, then the home.
    window.history.replaceState(null, '', `#/instructions`)
    if (initialInstructionsStoreId) {
      window.history.pushState(
        null,
        '',
        `#/instructions/${encodeURIComponent(initialInstructionsStoreId)}`,
      )
      if (initialInstructionsFile) {
        window.history.pushState(
          null,
          '',
          `#/instructions/${encodeURIComponent(initialInstructionsStoreId)}/${encodeURIComponent(initialInstructionsFile)}`,
        )
      }
    }
  } else if (initialView === 'stack') {
    // Nothing to seed: the stack page has no parent route.
  } else if (initialSessionId && initialProjectSlug) {
    // Back from a session drops to its project page; the :view suffix rides
    // only on the final entry, so Back peels off the modal first.
    window.history.replaceState(null, '', buildHash(initialProjectSlug, null, null))
    window.history.pushState(
      null,
      '',
      buildHash(initialProjectSlug, initialSessionId, initialDeepLinkView),
    )
  } else if (initialSessionId) {
    // `#/_/<sess>`: no meaningful intermediate Back target. Canonicalize in
    // place; useRouteSync fills in the real project from the session.
    window.history.replaceState(null, '', buildHash(null, initialSessionId, initialDeepLinkView))
  } else if (initialProjectSlug) {
    window.history.replaceState(null, '', `#/`)
    window.history.pushState(null, '', buildHash(initialProjectSlug, null, initialDeepLinkView))
  }

  window.addEventListener('hashchange', () => {
    const route = parseHash()
    const state = useUIStore.getState()
    // Suppress pushState during browser-initiated navigation (back/forward)
    // — the URL is already correct, pushing would wipe the forward stack
    suppressHashPush = true
    try {
      if (route.view === 'stack') {
        useUIStore.setState({ view: 'stack' })
      } else if (route.view === 'instructions') {
        useUIStore.setState({
          view: 'instructions',
          sidebarTab: 'instructions',
          instructionsSelectedStoreId: route.instructionsStoreId,
          instructionsSelectedFile: route.instructionsFile,
        })
        persistSidebarTab('instructions')
      } else {
        const leftInstructions = state.view === 'instructions'
        useUIStore.setState({
          view: 'observe',
          ...(state.sidebarTab === 'instructions' ? { sidebarTab: 'projects' as SidebarTab } : {}),
        })
        if (leftInstructions && state.sidebarTab === 'instructions') {
          persistSidebarTab('projects')
        }
        if (route.projectSlug !== state.selectedProjectSlug) {
          // Browser navigation is authoritative. A URL with no project
          // (home, or `#/_/<sess>`) also clears the resolved project id —
          // otherwise the main panel keeps showing the old project and
          // useRouteSync writes its slug back. A session URL re-resolves its
          // project from the session id.
          useUIStore.setState(
            route.projectSlug
              ? { selectedProjectSlug: route.projectSlug }
              : { selectedProjectSlug: null, selectedProjectId: null },
          )
        }
        if (route.sessionId !== state.selectedSessionId) {
          state.setSelectedSessionId(route.sessionId)
        }
        if (route.deepLinkView !== useUIStore.getState().deepLinkView) {
          useUIStore.setState({ deepLinkView: route.deepLinkView })
        }
        // Back off a `…:session.stats` entry closes the modal it opened.
        // (useRouteSync opens the modal a URL names; nothing else closes it.)
        if (!route.deepLinkView && useUIStore.getState().editingSessionId !== null) {
          useUIStore.setState({ editingSessionId: null })
        }
      }
    } finally {
      suppressHashPush = false
    }
  })

  // Check server version on page load. Shares the single page-wide
  // /api/health fetch with the WS log-level sniffer + settings modal.
  getServerHealth().then((data) => {
    if (data?.version) {
      useUIStore.getState().setServerVersion(data.version)
    }
  })

  // Fetch latest release version from GitHub on page load
  const githubRepoUrl = typeof __GITHUB_REPO_URL__ !== 'undefined' ? __GITHUB_REPO_URL__ : ''
  if (githubRepoUrl) {
    const match = githubRepoUrl.match(/github\.com\/([^/]+\/[^/]+)/)
    if (match) {
      fetch(`https://api.github.com/repos/${match[1]}/releases/latest`)
        .then((r) => (r.ok ? r.json() : null))
        .then((release) => {
          if (release?.tag_name) {
            useUIStore.getState().setLatestVersion(release.tag_name.replace(/^v/, ''))
          }
        })
        .catch(() => {})
    }
  }
}
