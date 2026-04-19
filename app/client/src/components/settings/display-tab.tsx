import { useUIStore } from '@/stores/ui-store'
import { useTheme } from '@/components/theme-provider'
import { Checkbox } from '@/components/ui/checkbox'

export function DisplayTab() {
  const reverseFeed = useUIStore((s) => s.reverseFeed)
  const setReverseFeed = useUIStore((s) => s.setReverseFeed)
  const { mode, setMode } = useTheme()

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
      </section>
    </div>
  )
}
