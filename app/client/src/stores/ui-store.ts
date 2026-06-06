import { create } from 'zustand'
import type { Label, ParsedEvent } from '@/types'
import type { TimeRange } from '@/config/time-ranges'
import { getServerHealth } from '@/lib/server-health'

// Session IDs are UUIDs (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Route {
  view: 'observe' | 'memory'
  projectSlug: string | null
  sessionId: string | null
  memoryStoreId: string | null
  memoryFile: string | null
}

const EMPTY_ROUTE: Route = {
  view: 'observe',
  projectSlug: null,
  sessionId: null,
  memoryStoreId: null,
  memoryFile: null,
}

function parseHash(): Route {
  const hash = window.location.hash.slice(1)
  if (!hash || hash === '/') return EMPTY_ROUTE
  const parts = hash.split('/').filter(Boolean)
  // Memory view: #/memory, #/memory/<storeId>, #/memory/<storeId>/<relPath>
  if (parts[0] === 'memory') {
    return {
      ...EMPTY_ROUTE,
      view: 'memory',
      memoryStoreId: parts[1] ? decodeURIComponent(parts[1]) : null,
      memoryFile: parts[2] ? decodeURIComponent(parts[2]) : null,
    }
  }
  if (parts.length === 1) {
    // Distinguish between session ID (UUID) and project slug
    if (UUID_RE.test(parts[0])) {
      return { ...EMPTY_ROUTE, sessionId: parts[0] }
    }
    return { ...EMPTY_ROUTE, projectSlug: parts[0] }
  }
  if (parts.length >= 2) {
    return { ...EMPTY_ROUTE, projectSlug: parts[0], sessionId: parts[1] }
  }
  return EMPTY_ROUTE
}

// When true, skip pushState (the URL is already correct from browser navigation)
let suppressHashPush = false

function updateHash(projectSlug: string | null, sessionId: string | null) {
  if (suppressHashPush) return
  let hash = '/'
  if (projectSlug && sessionId) {
    hash = `/${projectSlug}/${sessionId}`
  } else if (projectSlug) {
    hash = `/${projectSlug}`
  } else if (sessionId) {
    hash = `/${sessionId}`
  }
  window.history.pushState(null, '', `#${hash}`)
}

function updateMemoryHash(storeId: string | null, file: string | null) {
  if (suppressHashPush) return
  let hash = '/memory'
  if (storeId) hash += `/${encodeURIComponent(storeId)}`
  if (storeId && file) hash += `/${encodeURIComponent(file)}`
  window.history.pushState(null, '', `#${hash}`)
}

const SIDEBAR_TAB_KEY = 'openclaude-observe-sidebar-tab'
function persistSidebarTab(tab: SidebarTab) {
  try {
    localStorage.setItem(SIDEBAR_TAB_KEY, tab)
  } catch {}
}

type SidebarTab = 'projects' | 'labels' | 'memory'

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

  // Top-level view. 'observe' = the session/event dashboard; 'memory' = the
  // OpenClaude memory browser/editor. Reflected in the URL hash (#/memory).
  view: 'observe' | 'memory'
  setView: (view: 'observe' | 'memory') => void

  selectedProjectId: number | null
  selectedProjectSlug: string | null
  selectedSessionId: string | null
  selectedAgentIds: string[]
  setSelectedProject: (id: number | null, slug?: string | null) => void
  setSelectedSessionId: (id: string | null) => void
  updateProjectSlug: (slug: string) => void
  setSelectedAgentIds: (ids: string[]) => void
  toggleAgentId: (id: string) => void
  removeAgentId: (id: string) => void

  // Memory browser selection — which store (project memory dir / global /
  // agent) and which file within it are open.
  memorySelectedStoreId: string | null
  memorySelectedFile: string | null
  setMemoryStore: (id: string | null) => void
  setMemoryFile: (relPath: string | null) => void

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

  // Session being edited in the SessionEditModal (null = closed)
  editingSessionId: string | null
  editingSessionTab: 'details' | 'stats' | 'labels'
  setEditingSessionId: (id: string | null, tab?: 'details' | 'stats' | 'labels') => void

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

  // Sidebar Projects/Labels/Memory tab selector — persisted so the sidebar
  // re-opens on whichever view the user was last using. The Memory tab also
  // drives the top-level `view`.
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
  pulseSession: (sessionId: string) => void

  // Version tracking
  serverVersion: string | null
  setServerVersion: (version: string) => void
  latestVersion: string | null
  setLatestVersion: (version: string) => void
}

const PINNED_STORAGE_KEY = 'openclaude-observe-pinned-sessions'
const REVERSE_FEED_STORAGE_KEY = 'openclaude-observe-reverse-feed'

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

const LABELS_STORAGE_KEY = 'openclaude-observe-labels'
const LABEL_MEMBERSHIP_STORAGE_KEY = 'openclaude-observe-label-memberships'

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
  memoryStoreId: initialMemoryStoreId,
  memoryFile: initialMemoryFile,
} = initialRoute

const initialSidebarTab: SidebarTab =
  initialView === 'memory'
    ? 'memory'
    : ((localStorage.getItem(SIDEBAR_TAB_KEY) as SidebarTab) ?? 'projects')

export const useUIStore = create<UIState>((set, get) => ({
  sidebarCollapsed: false,
  sidebarWidth: 260,
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),

  view: initialView,
  setView: (view) => {
    set({ view })
    if (view === 'memory') {
      const s = get()
      updateMemoryHash(s.memorySelectedStoreId, s.memorySelectedFile)
    } else {
      const s = get()
      updateHash(s.selectedProjectSlug, s.selectedSessionId)
    }
  },

  memorySelectedStoreId: initialMemoryStoreId,
  memorySelectedFile: initialMemoryFile,
  setMemoryStore: (id) => {
    set({
      view: 'memory',
      sidebarTab: 'memory',
      memorySelectedStoreId: id,
      memorySelectedFile: null,
    })
    persistSidebarTab('memory')
    updateMemoryHash(id, null)
  },
  setMemoryFile: (relPath) => {
    const storeId = get().memorySelectedStoreId
    set({ view: 'memory', memorySelectedFile: relPath })
    updateMemoryHash(storeId, relPath)
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
    // Selecting observe content leaves the memory view. If the sidebar was on
    // the Memory tab, drop back to Projects so the chrome stays coherent.
    const nextTab: SidebarTab = state.sidebarTab === 'memory' ? 'projects' : state.sidebarTab
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
    updateHash(newSlug, null)
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
    const nextTab: SidebarTab = state.sidebarTab === 'memory' ? 'projects' : state.sidebarTab
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
    updateHash(state.selectedProjectSlug, id)
  },
  updateProjectSlug: (slug) => {
    set({ selectedProjectSlug: slug })
    const state = get()
    updateHash(slug, state.selectedSessionId)
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

  editingSessionId: null,
  editingSessionTab: 'details',
  setEditingSessionId: (id, tab) =>
    set({ editingSessionId: id, editingSessionTab: tab ?? 'details' }),

  sidebarTab: initialSidebarTab,
  setSidebarTab: (tab) => {
    persistSidebarTab(tab)
    if (tab === 'memory') {
      const s = get()
      set({ sidebarTab: tab, view: 'memory' })
      updateMemoryHash(s.memorySelectedStoreId, s.memorySelectedFile)
    } else {
      const s = get()
      set({ sidebarTab: tab, view: 'observe' })
      updateHash(s.selectedProjectSlug, s.selectedSessionId)
    }
  },

  settingsOpen: false,
  // Remember the last tab the user viewed so the gear icon reopens
  // there. Fall back to 'display' (the leftmost tab) on first use.
  settingsTab: localStorage.getItem('openclaude-observe-settings-tab') || 'display',
  openSettings: (tab) => {
    if (tab) {
      localStorage.setItem('openclaude-observe-settings-tab', tab)
      set({ settingsOpen: true, settingsTab: tab })
    } else {
      set({ settingsOpen: true })
    }
  },
  setSettingsTab: (tab) => {
    localStorage.setItem('openclaude-observe-settings-tab', tab)
    set({ settingsTab: tab })
  },
  closeSettings: () => set({ settingsOpen: false }),

  lastFilterId: localStorage.getItem('openclaude-observe-last-filter-id') || null,
  setLastFilterId: (id) => {
    if (id) localStorage.setItem('openclaude-observe-last-filter-id', id)
    else localStorage.removeItem('openclaude-observe-last-filter-id')
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

  notificationsEnabled: localStorage.getItem('openclaude-observe-notifications') !== 'off',
  setNotificationsEnabled: (enabled) => {
    localStorage.setItem('openclaude-observe-notifications', enabled ? 'on' : 'off')
    set({ notificationsEnabled: enabled })
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
    localStorage.setItem('openclaude-observe-settings-tab', 'labels')
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
  pulseSession: (sessionId) =>
    set((s) => ({
      sessionPulses: {
        ...s.sessionPulses,
        [sessionId]: (s.sessionPulses[sessionId] ?? 0) + 1,
      },
    })),

  serverVersion: null,
  setServerVersion: (version) => set({ serverVersion: version }),
  latestVersion: null,
  setLatestVersion: (version) => set({ latestVersion: version }),
}))

if (typeof window !== 'undefined') {
  // Seed history for direct URL loads so the back button has somewhere to go.
  // If loading #/project/session, push #/project first (project view),
  // then replace with the full URL. Back then goes to project view.
  if (initialView === 'memory') {
    // Seed history so back from a memory file lands on the memory home.
    window.history.replaceState(null, '', `#/memory`)
    if (initialMemoryStoreId) {
      window.history.pushState(null, '', `#/memory/${encodeURIComponent(initialMemoryStoreId)}`)
      if (initialMemoryFile) {
        window.history.pushState(
          null,
          '',
          `#/memory/${encodeURIComponent(initialMemoryStoreId)}/${encodeURIComponent(initialMemoryFile)}`,
        )
      }
    }
  } else if (initialProjectSlug && initialSessionId) {
    window.history.replaceState(null, '', `#/${initialProjectSlug}`)
    window.history.pushState(null, '', `#/${initialProjectSlug}/${initialSessionId}`)
  } else if (initialProjectSlug) {
    window.history.replaceState(null, '', `#/`)
    window.history.pushState(null, '', `#/${initialProjectSlug}`)
  }

  window.addEventListener('hashchange', () => {
    const route = parseHash()
    const state = useUIStore.getState()
    // Suppress pushState during browser-initiated navigation (back/forward)
    // — the URL is already correct, pushing would wipe the forward stack
    suppressHashPush = true
    try {
      if (route.view === 'memory') {
        useUIStore.setState({
          view: 'memory',
          sidebarTab: 'memory',
          memorySelectedStoreId: route.memoryStoreId,
          memorySelectedFile: route.memoryFile,
        })
        persistSidebarTab('memory')
      } else {
        const leftMemory = state.view === 'memory'
        useUIStore.setState({
          view: 'observe',
          ...(state.sidebarTab === 'memory' ? { sidebarTab: 'projects' as SidebarTab } : {}),
        })
        if (leftMemory && state.sidebarTab === 'memory') persistSidebarTab('projects')
        if (route.projectSlug !== state.selectedProjectSlug) {
          useUIStore.setState({ selectedProjectSlug: route.projectSlug })
        }
        if (route.sessionId !== state.selectedSessionId) {
          state.setSelectedSessionId(route.sessionId)
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
