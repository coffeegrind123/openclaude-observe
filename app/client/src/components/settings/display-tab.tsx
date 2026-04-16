import { useUIStore } from '@/stores/ui-store'
import { Checkbox } from '@/components/ui/checkbox'

export function DisplayTab() {
  const reverseFeed = useUIStore((s) => s.reverseFeed)
  const setReverseFeed = useUIStore((s) => s.setReverseFeed)

  return (
    <div className="space-y-6">
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
