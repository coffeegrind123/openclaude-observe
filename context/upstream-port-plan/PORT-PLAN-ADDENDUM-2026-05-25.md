# Upstream Port Plan — Addendum (2026-05-25)

Reconciles the 2026-04-27 PORT-PLAN.md against current state.

- **Plan baseline:** upstream `38bdce6`, we were 67 ahead / 193 behind.
- **Now:** upstream `2cf04ad` (v0.9.8), we are **96 ahead / 377 behind**.
- **184 new upstream commits** landed since the plan was written; they were never analyzed.

## Status of the original plan

| Plan section | Status |
|---|---|
| §A Already ported | n/a |
| §B.1 bug fixes | **DONE** (582a57c, 785d8bc, b61708f, b9537c1) |
| §B.2 fetch deduping | **DONE** (d6bbd1c, 86d40ce, 7ad1580, 7aee3a9, c45b009) |
| §B.3 rendering perf | **DONE** (7591de0, 28bc46c, 1b56108, 16e4e19) |
| §B.4 server enhancements | **DONE** (a91d879, c45f6ba, 401e2de) |
| §B.5 standalone UX | **MOSTLY DONE** (1f313c9, d2f6589, 6209015, 1027885). Outstanding: `b944dfb`/`3ee2a63` paired-event runtime display; verify `133b465` PreCompact pairing |
| §B.6 misc | **DONE** (9384da2) |
| §C.1 Database Prune UI | **DONE** (this branch: abf2a66 → 11c993c) |
| §C.2 Keyboard shortcuts | **NOT STARTED** |
| §C.3 Icon registry | **NOT STARTED** |
| §C.4 Notification env var | **NOT STARTED** |

## New commit groups (184 commits, 38bdce6..2cf04ad)

### G1. Unified Filters — ✅ PORTED (2026-05-25)
**Status:** Done (server + client + Filters tab). DB-backed RE2 filters replace
`config/filters.ts`. `event.filters` computed in `use-deduped-events.ts` (our pipeline,
not the agent registry). re2js dep added. ui-store renamed active*Filters. See
[[unified-filters-port-g1]] memory. Verifying combined gate.

---

### G1 (original). Unified Filters system — ~75 commits — PORT WITH MERGE WORK (large)
Range: `89cf8b9`..`a7fabdd` plus all-filter-exclusions `7339de0`..`4b798a0`.
DB-backed, user-defined regex filters (RE2 via re2js) replacing the static
`config/filters.ts` STATIC_FILTERS we still use. New `filters` table, REST routes,
filter-store, WS messages, Filters tab in Settings with editor + live preview,
pill-name templating ({bashCommand} etc.), primary/secondary→custom/default model,
negate/case-insensitive flags, default-all exclusion filter.
- **Conflict:** replaces our `config/filters.ts` + recent `b61708f` "Errors + Config static filters".
- **Server-side filter matching** (`ceb8c82`, `2fc9548`) runs in per-agent `processEvent` — must adapt to our parser path, not the agent-class registry.
- **Effort:** ~2–3 days. High value (user-extensible filtering).

### G2. Transcript Token Stats — ~45 commits — ✅ PORTED (2026-05-25)
**Status:** Done. Backend transcript-parser (claude-only, codex dropped per user),
transcript-stats route + config + storage + health flag, docker-compose bind mount,
client api-client types + section components + session-modal Stats restructure.
All tests green. **Deferred:** `/observe stats` deep-link URL convention (02d7e8c,
use-route-sync.ts + ui-store.ts) and `/observe view` skill subcommand (skill-side, skip).
See [[transcript-token-stats-port]] memory.

---

### G2 (original analysis). Transcript Token Stats — ~45 commits — PORT WITH MERGE WORK (large), GATED
Range: `29524cc`..`a02ee58`, `c3acff8`..`2f0b9ff`.
Reads `~/.claude/projects` JSONL transcripts (docker bind mount) → per-prompt /
per-model token + cost stats, subagent discovery via filesystem scan, canonical
pricing, codex transcript support, Stats-tab restructure (3 collapsible sections +
Token Usage), deep-link `/observe stats`, `/observe view` subcommand.
- **GATE:** requires OpenClaude to write Claude-format JSONL transcripts at the paths
  we store in `sessions.transcript_path`. **MUST VERIFY before porting.** If OpenClaude
  transcripts differ, port only the events-fallback path (`9bbfd2d`).
- **Overlaps** our existing server-side token tracking (`0b301c3`); upstream's is richer.
- The `/observe` skill/subcommand commits are hooks/skill-side → SKIP or adapt.
- **Effort:** ~2–3 days.

### G3. Event Deduplication — ✅ PORTED (2026-05-25)
**Status:** Done. `event-signature.ts` (adapted to our ParsedRawEvent), `signature_hash`
column + UNIQUE index, dedup pre-check + race handler at POST /events, dedup response in
our API shape. Tests: event-signature (7), sqlite-adapter dedup (4), events.test dedup
integration (3). See [[event-dedup-port]] memory.

---

### G3 (original analysis). Event Deduplication — 6 commits — PORT NOW (safe, high value)
`b3cf277`(spec), `d5f370d`(plan), `0ace541` canonical-json + signature helper,
`10c5c47` `signature_hash` column + UNIQUE index, `bb776cc` dedup at /events ingestion,
`0f56901` formatter.
- **High value for us:** native OTel can re-deliver events; dedup at ingestion prevents
  duplicates. No architecture conflict — pure server-side.
- **Effort:** ~2–4 hours. **Recommend first.**

### G4/G5/G7 — ✅ PORTED (2026-05-25)
- **G4 worktree detection:** `findExistingWorktreeProjectSlug` + match-only routing in
  resolveProject step 2. 13 helper tests + 2 routing tests.
- **G5 logs-modal search:** ported upstream's CSS-Custom-Highlight-API search + match
  nav + jump-to-event wholesale (translated `event.hookName`→`subtype||type`, toolName
  from `event.toolName`); added `::highlight(logs-search-*)` CSS.
- **G7 AskUserQuestion:** detail-render case + `AskUserQuestionBlock` in our
  `event-stream/event-detail.tsx` (not upstream's agents/ registry); answers read from
  paired Post via thread. OpenClaude has the AskUserQuestion tool (confirmed in
  ~/openclaude/src/tools.ts). Codex `.codex` worktree test case dropped.

---

### G4 (original). Worktree project detection — 4 commits — PORT NOW
`052664f`(docs), `92655be` findExistingWorktreeProjectSlug, `b177ab0` route worktree
sessions into parent project, `6cdbf32`(docs). Server-side, builds on our cwd resolution
(`576d50f`). Clean port.
- **Effort:** ~1–2 hours.

### G5. Raw-log modal search — 4 commits — PORT NOW
`20804eb` search in logs modal, `856a8a3` highlight matches, `4ce6bd7` divider fix,
`8f9c8c3` jump to event. We have `logs-modal.tsx`. Clean UX port.
- **Effort:** ~2–3 hours.

### G6. Unassigned bucket + sidebar fixes — 3 commits — PORT NOW (partial)
`8e95683` nested-button (we did equivalent `ce8e734` — SKIP), `70bc278` event count on
non-active rows, `ed8b7a1` refresh Unassigned after mutations.
- Requires the `/api/sessions/unassigned` endpoint (`be8ce48` from old plan §B.4 — was
  deferred). Decide if we want an Unassigned bucket. **Open question.**

### G7. AskUserQuestion rendering — 1 commit — PORT NOW (if emitted)
`dd75403` render AskUserQuestion event details (question/options/answer). Verify
OpenClaude emits AskUserQuestion; if yes, add detail viewer. Clean.

### G8. Hooks-specific — SKIP (architecturally incompatible)
`bccb09c` Setup/PostToolBatch hook capture, `13bc327` codex hooks env, `f9de6b1`/`31013a0`
plugin-root config, `2a71a91` claude settings, `c15f9a9`/`fc7c7f0` /observe skill subcommand.
We don't use hooks/plugin/skill. Note: PostToolBatch — verify OTel emits an equivalent
batch event; if so, add a parser case only.

### G9. Noise — SKIP
Releases (`770e348`, `6cf3276`, `4f33561`, `7a2cc90`, `6a0000e`, `2cf04ad`), merge commits,
prettier reflows (`a3986f6`, `9f8b649`, `7d671e3`, `00bd7db`, `97b2283`, `0f56901`),
`a3b1685` TASKS.md, `4d82670`/`deff72a` Claude Observe rename refs.

## Post-session status (2026-05-25)

**Ported & green:** G2 (transcript stats), G3 (event dedup), G4 (worktree detection),
G5 (logs-modal search), G7 (AskUserQuestion), §C.4 (configurable notification events via
`AGENTS_OBSERVE_NOTIFICATION_ON_EVENTS`). Also fixed a latent branch build break
(Badge import, vestigial agentClass).

**Deferred — architecture-dependent (like §D):**
- §B.5 `b944dfb`/`3ee2a63` paired-event runtime display — needs upstream's agent-class
  registry (`agents/claude-code/runtime.ts`, `event.turnId`, `dataApi.getTurnEvents`),
  none of which our fork has. Skip unless we build turn-tracking infra.

**Update (later in session):** G1 Unified Filters ✅ ported. §C.2 keyboard shortcuts ✅ ported
(keyboard-nav lib, use-region-shortcuts, region data-attrs, Keyboard settings tab).

**§C.3 icon registry — SKIP (already covered).** Our fork independently built the equivalent:
`lib/dynamic-icon.tsx` (ALL_ICON_NAMES + DynamicIcon + resolveIconName), `hooks/use-icon-customizations.ts`
(getIconCustomization, COLOR_PRESETS, migrateKeys), `config/event-icons.ts` (customization-first
resolution of any icon), and an any-lucide-icon picker. Upstream's registry only adds per-agent-class
layer isolation — moot for our single-class fork. Porting it = lateral rewrite + a 2nd localStorage
migration (risk to existing user customizations) for zero user-visible gain.

**Remaining:** G6 Unassigned bucket (needs product decision). Everything else is done or
intentionally skipped (three-layer refactor, hook libs, codex, docs/release noise).

## Recommended execution order
1. **G3 Event dedup** (safe, high value, ~½ day)
2. **G4 Worktree detection** + **G5 logs search** + **G7 AskUserQuestion** (safe batch, ~1 day)
3. **§C.2 Keyboard shortcuts** + **§C.3 Icon registry** + **§C.4 Notification env** (old-plan remainder, ~1.5 days)
4. **G1 Unified Filters** (large, replaces our static filters, ~2–3 days)
5. **G2 Transcript stats** (large, GATED on transcript-format verification, ~2–3 days)
6. **§B.5 remainder** (paired-event runtime display)

## Open questions
1. **G2 transcript format** — does OpenClaude write Claude-format JSONL at
   `sessions.transcript_path`? (Determines whether G2 is portable as-is.)
2. **G6 Unassigned bucket** — do we want a "no project" sidebar bucket, or do all OTel
   sessions resolve to a project via cwd?
3. **G7 AskUserQuestion** — does OpenClaude emit this event type?
