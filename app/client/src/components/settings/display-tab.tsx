import { useState } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { useTheme } from '@/components/theme-provider'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'

const ACTIVE_INDICATOR_MIN_SECONDS = 1
const ACTIVE_INDICATOR_MAX_SECONDS = 600

export function DisplayTab() {
  const reverseFeed = useUIStore((s) => s.reverseFeed)
  const setReverseFeed = useUIStore((s) => s.setReverseFeed)
  const mergeToolEvents = useUIStore((s) => s.mergeToolEvents)
  const setMergeToolEvents = useUIStore((s) => s.setMergeToolEvents)
  const notificationsEnabled = useUIStore((s) => s.notificationsEnabled)
  const setNotificationsEnabled = useUIStore((s) => s.setNotificationsEnabled)
  const activeIndicatorEnabled = useUIStore((s) => s.activeIndicatorEnabled)
  const setActiveIndicatorEnabled = useUIStore((s) => s.setActiveIndicatorEnabled)
  const activeIndicatorSeconds = useUIStore((s) => s.activeIndicatorSeconds)
  const setActiveIndicatorSeconds = useUIStore((s) => s.setActiveIndicatorSeconds)
  const { mode, setMode } = useTheme()

  // Local string state so the field edits freely; committed (clamped) on blur.
  const [secondsStr, setSecondsStr] = useState(String(activeIndicatorSeconds))
  const commitSeconds = () => {
    const n = Math.round(Number(secondsStr))
    if (!Number.isFinite(n) || n < ACTIVE_INDICATOR_MIN_SECONDS) {
      setSecondsStr(String(activeIndicatorSeconds))
      return
    }
    const clamped = Math.min(ACTIVE_INDICATOR_MAX_SECONDS, n)
    setActiveIndicatorSeconds(clamped)
    setSecondsStr(String(clamped))
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <header>
          <h3 className="text-sm font-medium">Appearance</h3>
          <p className="text-xs text-muted-foreground">Pick the dashboard theme.</p>
        </header>
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Theme</label>
          <div className="flex gap-1">
            {(['light', 'dark', 'system'] as const).map((opt) => (
              <button
                key={opt}
                className={`px-3 py-1.5 text-xs rounded-md border transition-colors cursor-pointer ${
                  mode === opt
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
                }`}
                onClick={() => setMode(opt)}
              >
                {opt.charAt(0).toUpperCase() + opt.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <header>
          <h3 className="text-sm font-medium">Event feed</h3>
          <p className="text-xs text-muted-foreground">
            Control how new events appear in the event stream.
          </p>
        </header>

        <label className="flex items-start gap-3 cursor-pointer select-none">
          <Checkbox
            checked={reverseFeed}
            onCheckedChange={(c) => setReverseFeed(c === true)}
            className="mt-0.5"
          />
          <div className="space-y-0.5">
            <div className="text-sm">Newest events on top</div>
            <p className="text-xs text-muted-foreground">
              New events spawn at the top of the feed and existing events fall downwards. When
              disabled, new events append to the bottom.
            </p>
          </div>
        </label>

        <label className="flex items-start gap-3 cursor-pointer select-none">
          <Checkbox
            checked={mergeToolEvents}
            onCheckedChange={(c) => setMergeToolEvents(c === true)}
            className="mt-0.5"
            aria-label="Merge tool call start and result"
          />
          <div className="space-y-0.5">
            <div className="text-sm">Merge tool call start and result</div>
            <p className="text-xs text-muted-foreground">
              Show each tool call as one row, its PostToolUse result folded into the PreToolUse.
              When disabled, every hook event gets its own row, labelled with its hook name — what
              the pi extension actually sent.
            </p>
          </div>
        </label>
      </section>

      <section className="space-y-3">
        <header>
          <h3 className="text-sm font-medium">Sidebar</h3>
        </header>
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <Checkbox
            checked={notificationsEnabled}
            onCheckedChange={(v) => setNotificationsEnabled(v === true)}
            className="mt-0.5"
          />
          <div className="space-y-0.5">
            <div className="text-sm">Show notification alerts</div>
            <p className="text-xs text-muted-foreground">
              Highlights sessions (and their parent projects) in the sidebar when an agent emits a
              Notification event and is waiting for your input. Click the bell to dismiss it for
              that session.
            </p>
          </div>
        </label>

        <div className="space-y-2">
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <Checkbox
              checked={activeIndicatorEnabled}
              onCheckedChange={(v) => setActiveIndicatorEnabled(v === true)}
              className="mt-0.5"
            />
            <div className="space-y-0.5">
              <div className="text-sm">Show active session indicator</div>
              <p className="text-xs text-muted-foreground">
                Pulses the session dot (and its project folder) green in the sidebar for a few
                seconds after an agent sends activity, then fades.
              </p>
            </div>
          </label>
          <div className="ml-7 flex items-center gap-2">
            <label htmlFor="active-indicator-seconds" className="text-xs text-muted-foreground">
              Stay lit for
            </label>
            <Input
              id="active-indicator-seconds"
              type="number"
              min={ACTIVE_INDICATOR_MIN_SECONDS}
              max={ACTIVE_INDICATOR_MAX_SECONDS}
              value={secondsStr}
              disabled={!activeIndicatorEnabled}
              onChange={(e) => setSecondsStr(e.target.value)}
              onBlur={commitSeconds}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur()
                }
              }}
              className="h-7 w-16 px-2 text-xs md:text-xs"
            />
            <span className="text-xs text-muted-foreground">seconds</span>
          </div>
        </div>
      </section>
    </div>
  )
}
