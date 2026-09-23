import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useUIStore, parseView, buildHash, PROJECT_PLACEHOLDER } from '@/stores/ui-store'
import { useProjects } from '@/hooks/use-projects'
import { api } from '@/lib/api-client'
import type { Session } from '@/types'

const SESSION_VIEW_TABS = new Set(['details', 'stats', 'labels'])

// Bound on the legacy-link dedup set: it only grows on slugs that match no
// project (old `#/<sessionId>` links, typos) but lives as long as the page.
// Cleared, not LRU-evicted — a re-resolve after a clear costs one fetch.
const MAX_FALLBACK_ATTEMPTS = 50

// Session rows are shared with SessionBreadcrumb through ['session', id]. The
// reconciler re-runs on every projects update (frequent on a live dashboard),
// so without a staleTime each of those would refetch the session.
const SESSION_STALE_MS = 30_000

// Rewrite the CURRENT history entry (replaceState, never pushState) so
// canonicalizing the advisory project segment doesn't pollute back/forward.
function canonicalizeHash(
  projectSlug: string | null,
  sessionId: string | null,
  view: string | null,
) {
  const target = buildHash(projectSlug, sessionId, view)
  if (window.location.hash !== target) {
    window.history.replaceState(null, '', target)
  }
}

/**
 * Keeps the URL, the resolved project and the selected session in sync.
 *
 * The session id is the source of truth (session ids are unique); the
 * project segment is advisory and always DERIVED from the resolved session —
 * never trusted from the URL or carried over from a previous selection. That
 * is what lets `#/_/<id>` and legacy `#/<id>` links land, and keeps a stale
 * project segment from surviving a jump between sessions of different
 * projects.
 *
 * Only runs while the observe surface is showing: the instructions and stack
 * pages own the URL then, and a canonicalizing replaceState would clobber it.
 */
export function useRouteSync() {
  const queryClient = useQueryClient()
  const { data: projects } = useProjects()
  const view = useUIStore((s) => s.view)
  const selectedSessionId = useUIStore((s) => s.selectedSessionId)
  const selectedProjectId = useUIStore((s) => s.selectedProjectId)
  const selectedProjectSlug = useUIStore((s) => s.selectedProjectSlug)
  const deepLinkView = useUIStore((s) => s.deepLinkView)
  const isObserve = view === 'observe'

  const fetchSession = (id: string) =>
    queryClient.fetchQuery<Session>({
      queryKey: ['session', id],
      queryFn: () => api.getSession(id),
      staleTime: SESSION_STALE_MS,
    })

  // ── Session → project reconciler ────────────────────────────────
  // Runs on every session change. Our own setState only touches the project
  // id/slug, which are not dependencies, so it can't loop.
  useEffect(() => {
    if (!isObserve || !selectedSessionId) {
      return
    }
    let cancelled = false

    fetchSession(selectedSessionId)
      .then((session) => {
        if (cancelled) {
          return
        }
        if (!session) {
          useUIStore.getState().setRouteError(selectedSessionId)
          return
        }
        const resolvedId = session.projectId ?? null
        const project = resolvedId != null ? projects?.find((p) => p.id === resolvedId) : undefined

        // Project id known but projects not loaded yet: set the id and wait
        // for this effect to re-run, rather than canonicalizing a real
        // project down to `_` for a moment.
        if (resolvedId != null && !project) {
          if (useUIStore.getState().selectedProjectId !== resolvedId) {
            useUIStore.setState({ selectedProjectId: resolvedId })
          }
          return
        }

        const resolvedSlug = project?.slug ?? null
        const st = useUIStore.getState()
        st.clearRouteError()
        if (st.selectedProjectId !== resolvedId || st.selectedProjectSlug !== resolvedSlug) {
          useUIStore.setState({ selectedProjectId: resolvedId, selectedProjectSlug: resolvedSlug })
        }
        canonicalizeHash(resolvedSlug, selectedSessionId, useUIStore.getState().deepLinkView)
      })
      .catch(() => {
        if (!cancelled) {
          useUIStore.getState().setRouteError(selectedSessionId)
        }
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isObserve, selectedSessionId, projects])

  // ── Bare project slug + legacy single-segment fallback ──────────
  // `#/<slug>`: resolve slug → id and keep a renamed slug fresh. A slug that
  // matches no project may be a legacy `#/<sessionId>` link from before the
  // project segment was positional — look it up AS a session (a data lookup,
  // not a UUID-shape guess) and switch to the canonical `#/_/<id>`.
  const attemptedSessionFallback = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!isObserve || !projects || selectedSessionId) {
      return
    }
    if (!selectedProjectSlug || selectedProjectSlug === PROJECT_PLACEHOLDER) {
      return
    }

    if (selectedProjectId) {
      const project = projects.find((p) => p.id === selectedProjectId)
      if (project && project.slug !== selectedProjectSlug) {
        useUIStore.getState().updateProjectSlug(project.slug)
      }
      return
    }

    const project = projects.find((p) => p.slug === selectedProjectSlug)
    if (project) {
      useUIStore.getState().clearRouteError()
      useUIStore.setState({ selectedProjectId: project.id })
      return
    }

    const candidate = selectedProjectSlug
    if (attemptedSessionFallback.current.has(candidate)) {
      useUIStore.getState().setRouteError(candidate)
      return
    }
    if (attemptedSessionFallback.current.size >= MAX_FALLBACK_ATTEMPTS) {
      attemptedSessionFallback.current.clear()
    }
    attemptedSessionFallback.current.add(candidate)
    fetchSession(candidate)
      .then((session) => {
        if (!session) {
          useUIStore.getState().setRouteError(candidate)
          return
        }
        useUIStore.getState().clearRouteError()
        // Hand off to the session reconciler, which fills in the project.
        useUIStore.setState({
          selectedSessionId: candidate,
          selectedProjectSlug: null,
          selectedProjectId: null,
        })
        canonicalizeHash(null, candidate, useUIStore.getState().deepLinkView)
      })
      .catch(() => useUIStore.getState().setRouteError(candidate))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isObserve, projects, selectedProjectSlug, selectedProjectId, selectedSessionId])

  // ── Deep-link view → modal ──────────────────────────────────────
  // Direct loads and back/forward set deepLinkView from the URL; open the
  // modal it names. Writes the modal state directly (not through
  // setEditingSessionId) so the URL isn't pushed again. Invalid views are
  // stripped with a warning so they don't silently rot.
  useEffect(() => {
    if (!isObserve || !deepLinkView) {
      return
    }
    const parsed = parseView(deepLinkView)

    if (parsed.scope === 'session') {
      const targetId = parsed.target ?? selectedSessionId
      if (!targetId) {
        // The session id comes synchronously from the URL on load, so no
        // session here means the link itself was malformed.
        console.warn(
          `[route-sync] Deep link :${deepLinkView} needs a session (none in the URL or @target) — stripping.`,
        )
        useUIStore.getState().setDeepLinkView(null)
        return
      }
      if (!SESSION_VIEW_TABS.has(parsed.name)) {
        console.warn(
          `[route-sync] Deep link :${deepLinkView} — unknown session view "${parsed.name}". Valid: details, stats, labels.`,
        )
        useUIStore.getState().setDeepLinkView(null)
        return
      }
      const tab = parsed.name as 'details' | 'stats' | 'labels'
      const state = useUIStore.getState()
      if (state.editingSessionId !== targetId || state.editingSessionTab !== tab) {
        useUIStore.setState({ editingSessionId: targetId, editingSessionTab: tab })
      }
      return
    }

    console.warn(
      `[route-sync] Deep link :${deepLinkView} (${parsed.scope}.${parsed.name}) isn't wired up — stripping.`,
    )
    useUIStore.getState().setDeepLinkView(null)
  }, [isObserve, deepLinkView, selectedSessionId])
}
