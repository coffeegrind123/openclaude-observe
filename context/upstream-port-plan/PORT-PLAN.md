# Upstream Port Plan — agents-observe → openclaude-observe

**Generated:** 2026-04-27
**Upstream HEAD:** `38bdce6` (simple10/agents-observe @ main)
**Our HEAD:** `7a0bea4` (coffeegrind123/openclaude-observe @ main)
**Merge base:** `185d7bc`
**Divergence:** 67 commits ahead, 193 commits behind

---

## Executive Summary

The single biggest fact: **upstream did a multi-phase architectural refactor** ("three-layer contract", Phases 1–8) that **fundamentally conflicts with our native OpenClaude OTel integration**. A straight merge or even a bulk cherry-pick would break our system in ≥5 ways:

1. New `validateEnvelope()` rejects the shape `ClaudeObserveExporter` POSTs to `/api/events`.
2. The new agent-class registry deletes our `chat-feed/`, `compaction-boundary.tsx`, `context-badge.tsx`.
3. Our `instances` table has no upstream schema migration — left orphaned.
4. Our 22 OTel event types (LLM, daemon, pipe, coordinator, bridge, super, compaction, cost) need re-coding as per-class derivers.
5. Wire-format `events.type/subtype/tool_name` is replaced by opaque `payload + hookName`.

**Recommendation:** **Selective cherry-pick. Do NOT bulk-merge.** Defer the three-layer refactor 6–12 months until upstream's agent-class extension model stabilizes and our architecture has concrete agent classes to register.

---

## Categorization Buckets

- **A. ALREADY PORTED** — verified equivalents in our 67 commits, no action needed.
- **B. PORT NOW** — standalone improvements, safe to cherry-pick.
- **C. PORT WITH MERGE WORK** — useful but requires manual conflict resolution.
- **D. SKIP — REFACTOR DEPENDENCY** — only makes sense after the three-layer refactor.
- **E. SKIP — ARCHITECTURALLY INCOMPATIBLE** — conflicts with our OTel model.
- **F. SKIP — DOCS/RELEASE NOISE** — not a feature.

---

## A. Already Ported (no action)

These 18 upstream commits have been re-implemented with different SHAs. Verified by content comparison.

| Upstream | Our equivalent | Feature |
|---|---|---|
| `27896e3` | `c81a45a` | Close icon picker before applying |
| `778e22b` | `195edad` | Session labels for cross-project bookmarking |
| `d5ccf09` | `b63e436` | Notification indicator in main-panel session list |
| `9d0d431` | `a946fc3` | Sidebar notification indicator + animated favicon |
| `1508e0d` | `576d50f` | Resolve projects by cwd; codex date-path collapse |
| `4ef6d4f` | `4dae049` | Remount EventStream on session change |
| `2eaa9f2` | `ee6d804` | overflow-hidden timeline container |
| `cf19cbc` | `4ace433` | Re-scroll on tab visibility change |
| `645580c` | `9f2ce89` | GPU spinner on Live/Rewind |
| `cf5e220` | `694b0fe` | Memo TimelineRewind / freeze rewind agents |
| `b5a3ba9` | `1ccea87` | Rewind uses frozen events (memory leak) |
| `9f8d2d4` | `163b1d0` | Swap Live (green) / Rewind (orange) colors |
| `5ea9ba3` | `bdcc5ad` | Double-click sidebar name to rename |
| `eec6da0` | `9f04157` | Click breadcrumb to copy transcript path |
| `ae04fd2` | `12fc600` | Seed history on direct URL load |
| `44d98b7` | `925baf4` | Suppress pushState during back/forward |
| `1976b6d` | `e75cd81` | Browser back button support |
| `fcb93d4` | `71c040a` | Theme picker (light/dark/system) |

Plus the batch-ported in `744d051` (already in our tree):
`2906893`, `d7c7e51`, `d108bdd`, `f49bcd3`, `a7eb163`, `6323f4d`, `27896e3`.

**All other "scroll reliability" upstream commits** (`d1d0d07`, `a57d7e0`, `caab28a`, `636d183`, `71c040a`, `fc857f0`, `15c66c2`, `7992dbf`, `5ef9870`) are superseded by our cleaner `4dae049` (key remount). **Skip them.**

---

## B. Port Now — Standalone Wins

Cherry-pick directly. Safe, valuable, no architectural dependencies.

### B.1. Bug fixes — high-value, trivial

| Commit | Title | Notes |
|---|---|---|
| `997a40f` | guard timeline-rewind/parser against poisoned timestamps | Defensive — port unconditionally |
| `15a9aab` | tooltips re-opening on tab reactivation | Standalone UX bug |
| `4f1cee7` | Errors + Config static filters | Filter category mapping fix; verify our filter category names match |
| `c22fe4d` | Session Stats memory leak (events array retained) | React Query gcTime/staleTime; confirm our session-modal uses same pattern |
| `38bdce6` | drop leftover api base url override | Trivial chore |

### B.2. Performance — fetch deduping & query polish

These largely live in `app/client/src/hooks/use-*.ts` and don't touch event processing.

| Commit | Title | Notes |
|---|---|---|
| `d2b4d79` | share single `/api/health` fetch | Trivial singleton |
| `fe119ad` | dedupe notifications fetch + suppress HomePage flash | Pure UX polish |
| `78a2469` | drop per-project session fetches for sidebar bell+pulse | Replace with the new `/api/sessions/unassigned` endpoint pattern; port `be8ce48` first |
| `d5c8743` | dedupe `/api/sessions/:id` fetches into one cache key | Standalone |
| `ae3c4e7` | drop refetchInterval polling on session/project queries | We already rely on WS invalidation; verify no behavior loss |
| `60d7be4` | API call regressions (lazy-fetch storm + cache thrash) | Bundle with the others above; commit message has details |
| `8efa058` | share single EventStore via React context | **Verify** — we have `useDedupedEvents` per consumer; their EventStore presumes the agent-class registry. Port the **context-sharing pattern only**, not the registry coupling |

### B.3. Performance — timeline & rendering

| Commit | Title | Notes |
|---|---|---|
| `5e2a1b1` | React.memo DotContainer with content-aware equality | Pure memoization |
| `09104d9` | split agent lane into absolute siblings + share tooltip per lane | Layout refactor; clean port |
| `488ee88` | timeline cleanup + perf guardrails | Standalone |
| `3c169bd` | move useAgents side-effect fetch out of useMemo | React-correctness fix |

### B.4. Server-side enhancements

| Commit | Title | Notes |
|---|---|---|
| `89fd45a` | backfill `sessions.start_cwd` from `metadata.cwd` | Better project resolution; verify our schema has `start_cwd` (it should after our 8792a8f baseline; if not, add migration) |
| `8fa2749` | backfill `start_cwd` inside v1→v2 rebuild SELECT | Companion fix; port together |
| `b3611d9` | `?fields=` allow-list on `GET /sessions/:id/events` | Bandwidth saver; opt-in, no breakage |
| `f3f6a82` | type events response inline; `??` for createdAt fallback | Type-safety polish |
| `ac24a1a` | drop `createdAt` from wire; make `sessionId/cwd/_meta` optional | **Caution:** verify our types still compile; OTel events may not stamp these fields |
| `be8ce48` | `GET /api/sessions/unassigned` | Required for `78a2469` port |

### B.5. UX features — clean, standalone

| Commit | Title | Notes |
|---|---|---|
| `694a17a` | transition spinner on rewind-mode range changes | Polish; pairs with `9f2ce89` we already have |
| `9ff0be6` | broadcast activity pings for sidebar pulse animation | Adds new WS message; verify our WS contract has room |
| `d286b58` | settings modal UX cleanup + db-size footer | Bundle with database-prune-ui port (§ C.1) |
| `b944dfb` | runtime on Stop/SubagentStop events + row summary | Pure display; reads existing fields |
| `3ee2a63` | paired-event runtime in detail pane + date tooltip | Companion to `b944dfb` |
| `39e88bd` | redact oversized base64 images in tool_response + inline image render | Useful for screenshot tool calls; port the **client redaction & render** parts even if hooks-side stamping doesn't apply |
| `48b9a4c` | restore default spacing/text size to tabs | Style polish |
| `133b465` | pair PreCompact/PostCompact into single row | **Verify** — our `compaction-boundary.tsx` already does this; if so, mark Already Ported |
| `6a7764d` | keep last-expanded row in view on filter/search | Standalone scroll polish |
| `509fd53` | nested-button warning in sidebar project row | Trivial a11y fix |

### B.6. Misc

| Commit | Title | Notes |
|---|---|---|
| `1644b6e` | drop unused Badge import in main-panel session-list | Trivial cleanup |

---

## C. Port With Merge Work

Substantial features worth porting; require careful merge against our customizations.

### C.1. Database Prune UI — Sessions/Projects/Labels tabs (full feature group)

Commits: `b9d6f26`, `44a420c`, `0196fbc`, `7a1f527`, `b810a57`, `ef91957`, `48b9a4c`, `c2b1ba3`, `20fced9` (release).

**Verdict:** Port cleanly, no three-layer-refactor dependency.

- Sessions tab uses `session.status === 'active'` (we have it) — does **not** require Phase 7.3 `stoppedAt` derivation.
- Labels tab moves our `LabelsModal` (from `195edad`) into Settings — **pure UX reorganization**, reuses identical localStorage keys.
- Projects tab is a sortable-table rewrite + create/delete with new server endpoints.
- Sidebar Projects|Labels tabs add a layer over our existing label data — no model changes.

**New server endpoints to add:**
- `GET /api/db/stats` — `{ dbPath, sizeBytes, sessionCount, eventCount }`
- `POST /api/sessions/bulk-delete` — body `{ sessionIds[] }`, returns `{ ok, deleted, sizeBefore, sizeAfter }`
- `POST /api/projects` — body `{ name, slug? }`, returns project object

**Files to create:**
- `app/client/src/components/settings/sessions-tab.tsx`
- `app/client/src/hooks/use-db-stats.ts`
- (optional) `app/client/src/components/sidebar/project-label-tabs.tsx`

**Files to modify:** ~13 client + ~5 server. See per-commit file list in upstream `git diff b9d6f26~1..b810a57`.

**Effort:** ~6–10 hours.

### C.2. Keyboard Shortcuts — Session view nav (full feature group)

Commits: `b569fba` (design), `9da7831` (plan), `e782a35`, `f19a1d8`, `88927e7`, `6970774`, `52b582a`, `43aecf4`, `3cd8291`, `19daee3`, `88e39f7`, `083e7d2`, `5903197`, `a1bf4bf`, `2c03b1f`, `5e36f6c`, `e9bd512`, `85e6761`.

**Verdict:** Port — no real conflicts. Verified our double-click rename (`bdcc5ad`) is **orthogonal** to upstream's `role="button"` + `isEditing` guard (the rename handler lives on a nested `<span>`).

**New files:**
- `app/client/src/lib/keyboard-nav.ts` (+test)
- `app/client/src/hooks/use-region-shortcuts.ts` (+test)
- `app/client/src/components/settings/keyboard-settings.tsx`

**Modified files:** sidebar/session-item, project-list, pinned-sessions, sidebar; main-panel/event-filter-bar, agent-combobox, main-panel; settings-modal.

**Adaptation:** `85e6761` (window scrolls → event stream) makes sense for us — apply to event-stream pane only; the chat panel keeps its own scroll.

**Effort:** ~4–6 hours.

### C.3. Icon Registry (decoupled subset)

Commits: `8cbca69`, `9191e24`, `6b73a69` (last is part of Phase 8 cleanup).

**Verdict:** Port the **standalone icon registry concept** (global registry + per-class override hooks) but skip the agent-class layer-isolation parts. Our render-time icon resolution (`getEventColor` is already render-time after `1f88d01`-equivalent in our code) is partial; this consolidates it.

**Caution:** `9191e24` migrates icon-customization keys; we already have customizations in localStorage — write a one-shot migration that handles both old (our) and intermediate (upstream's pre-registry) keys.

**Effort:** ~3–4 hours.

### C.4. Configurable Notification Events (env var)

Commits: `f2b97f1`, `ccda118`, `fb7be61`, `9c98c1d`, `39c52e7`, `e55d81d`, `b01b915`, `8e8b19e`, `70c5479`, `35f4fb7`.

**Verdict:** Port the **client-side notification rule mechanism** (`AGENTS_OBSERVE_NOTIFICATION_ON_EVENTS` reading + applying to display). Skip the hook-lib commits — our OTel exporter doesn't have a hook lib.

**Adaptation needed:** Our notification model is **subtype-driven** (Notification subtype → notify). Upstream's is **flag-driven** at the envelope. Pick one:
- **Option A (recommended):** Keep our subtype model, add an env var to allow extending the trigger set to other subtypes (Stop, SubagentStop, etc.).
- **Option B:** Switch to envelope flags. Requires `ClaudeObserveExporter` to stamp `is_notification` — can't do without coordinated change.

**Effort:** ~2 hours for Option A.

### C.5. Misc UX

| Commit | Title | Merge work |
|---|---|---|
| `35f4fb7` | render UserPromptExpansion hook events | Add a parser case for `UserPromptExpansion` if OpenClaude emits it; otherwise SKIP |
| `aeff0fc` | harden fresh-install test harness | Our test harness diverged after dropping hooks; adapt or skip |

---

## D. Skip — Refactor Dependencies

Commits that ONLY make sense after the three-layer refactor lands. Defer.

| Commit | Why deferred |
|---|---|
| `7abc800` | derive agent parent/child from events — depends on Layer 3 spec |
| `128fd1a` | skip no-op agent metadata PATCHes — uses new `ctx.getAgent()` |
| `cff4de7` | switch consumers to derived fields — Phase 6.1 |
| `7819088` | codex parse-transcript + default derivers — Phase 6.2/6.3 |
| `b1fc38e` | trim ParsedEvent to wire shape — Phase 5 |
| `84a07d9` | derive session status from stoppedAt — Phase 7.3 |
| `e972d5d` | Unassigned bucket for null-project sessions — Phase 7.1 |
| `2cc456b` | debounce per-agent metadata PATCHes — Phase 7.2 |
| `f6d4857` | widen types for null-project sessions — Phase 7 follow-up |
| `547424c` | Phase 8 cleanup — depends on Phases 1–7 |
| `7ea54e3` | strip EnrichedEvent + per-class generics — refactor follow-up |
| `8cbca69`,`9191e24`,`6b73a69` | icon registry — see § C.3 (port subset only) |

---

## E. Skip — Architecturally Incompatible

These conflict with our OTel/multi-instance/chat-feed model and **must not be ported**.

| Commit | Why |
|---|---|
| **All "Phase 1–8" commits** | The three-layer contract assumes hook envelope, deletes our `chat-feed/`, `compaction-boundary.tsx`, `context-badge.tsx`. |
| `bd4d003`, `af00912`, `f3fb74`, `2d4a67b`, `02668ab`, `0634fd3`, `d21c62f` | Spec/plan docs for a refactor we are not doing. |
| `96b9b7a` (Phase 1.1+1.2) | Drops endpoints we may rely on |
| `9de7207` | Drops DB columns including some we still use for instances |
| `ee875f7` | FK-toggle rebuild fix only relevant if you do `1a7b882` |
| `1a7b882` (Phase 2) | Schema migration to three-layer; **incompatible** with our `instances` table and event subtype model |
| `7d54cfe` (Phase 3.1+3.2) | `validateEnvelope()` rejects ClaudeObserveExporter shape |
| `c1e191d` (Phase 3.3) | Project-resolver rewrite assumes new envelope; we already ported the project-by-cwd logic in `576d50f` |
| `36d525d` (Phase 3.4+3.6) | Rewrite POST /api/events — would delete our 22-event-type parser path |
| `2c3bc2f` (Phase 3.5) | `PATCH /api/agents/:id` is for the new metadata flow |
| `663a2c7`, `941e8d1`, `acd4a40`, `3b2758e`, `4cde806` | Hook lib rewrites — we don't have hooks |
| `c9eb2a8` | CLI-stamped descriptors; drops `tool_use_id` which we need for subagent parent tracking |
| `9c77dd8`, `9e6b0dd`, `d83c319`, `6e8bec4` | Notification envelope flags — see § C.4 Option B |
| **All `feat/database-prune-ui` upstream branch internal commits** that pre-date `b9d6f26` | Ported as part of § C.1 |

---

## F. Skip — Noise

`933d639` (release v0.9.2), `20fced9` (release v0.9.1), `5e315ad` (release v0.9.0), `e55d81d` (merge commit), `ef91957` (merge commit), `c2b1ba3` (move plans to implemented), `8bccd47` (prettier reflow).

---

## Recommended Execution Order

1. **Quick wins (1 day):** § B.1 bug fixes + § B.4 server enhancements + trivial misc.
2. **Performance pass (½ day):** § B.2 fetch deduping + § B.3 rendering perf.
3. **UX features (1 day):** § B.5 standalone UX + § C.4 notification env var (Option A).
4. **Database Prune UI (1–2 days):** § C.1.
5. **Keyboard Shortcuts (½–1 day):** § C.2.
6. **Icon registry (½ day):** § C.3.
7. **Defer:** § D refactor-dependent — revisit when you're ready to do the full three-layer migration. Re-evaluate in 6–12 months.

---

## Open Questions for You

1. **`be8ce48` `/api/sessions/unassigned`** — do we want a "no project" bucket in the sidebar, or do all our OTel sessions resolve to a project via cwd?
2. **`133b465` PreCompact/PostCompact pairing** — our `compaction-boundary.tsx` likely already does this; want me to verify line-by-line?
3. **`35f4fb7` UserPromptExpansion** — does OpenClaude emit this event? If not, skip; if yes, add parser case.
4. **`8efa058` shared EventStore context** — port the context-share pattern but keep our parser/dedup logic, or skip?
5. **Three-layer refactor timeline** — accept "defer 6–12 months" or do you want a phased migration plan?
