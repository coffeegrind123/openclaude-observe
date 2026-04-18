import { useCallback, useRef } from 'react'
import { PanelRightOpen, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'
import { Button } from '@/components/ui/button'
import { ChatFeed } from './chat-feed'

const MIN_WIDTH = 280
const MAX_WIDTH = 800

/**
 * Right-hand chat panel. Wraps the resize handle and collapse behavior so
 * main-panel.tsx can treat it as a single sibling of EventStream.
 *
 * Collapsed state renders a thin vertical rail with an expand button so the
 * user can bring the panel back without returning to settings.
 */
export function ChatPanel() {
  const chatPanelCollapsed = useUIStore((s) => s.chatPanelCollapsed)
  const chatPanelWidth = useUIStore((s) => s.chatPanelWidth)
  const setChatPanelCollapsed = useUIStore((s) => s.setChatPanelCollapsed)
  const setChatPanelWidth = useUIStore((s) => s.setChatPanelWidth)

  const panelRef = useRef<HTMLDivElement>(null)
  const resizing = useRef(false)

  // Mirror Sidebar's manual resize: measure from the right edge because the
  // panel is right-anchored, so dragging left makes it wider.
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (chatPanelCollapsed) return
      e.preventDefault()
      resizing.current = true
      if (panelRef.current) panelRef.current.style.transition = 'none'

      const onMouseMove = (ev: MouseEvent) => {
        if (!resizing.current) return
        const viewportWidth = window.innerWidth
        const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, viewportWidth - ev.clientX))
        if (panelRef.current) panelRef.current.style.width = `${newWidth}px`
      }

      const onMouseUp = (ev: MouseEvent) => {
        resizing.current = false
        if (panelRef.current) panelRef.current.style.transition = ''
        const viewportWidth = window.innerWidth
        const finalWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, viewportWidth - ev.clientX))
        setChatPanelWidth(finalWidth)
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [chatPanelCollapsed, setChatPanelWidth],
  )

  if (chatPanelCollapsed) {
    return (
      <div className="flex flex-col w-8 shrink-0 border-l border-border/50 bg-card/30">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 mt-1"
          onClick={() => setChatPanelCollapsed(false)}
          title="Show chat panel"
        >
          <PanelRightOpen className="h-3.5 w-3.5" />
        </Button>
        <div className="flex flex-col items-center gap-2 mt-2 text-muted-foreground">
          <MessageSquare className="h-3.5 w-3.5" />
          <span
            className="text-[10px] tracking-wider uppercase"
            style={{ writingMode: 'vertical-rl' }}
          >
            Chat
          </span>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={panelRef}
      className={cn(
        'relative flex flex-col shrink-0 border-l border-border/50 bg-card/30 transition-[width] duration-200',
      )}
      style={{ width: chatPanelWidth }}
    >
      {/* Resize handle on the LEFT edge (panel is right-anchored) */}
      <div
        className="absolute top-0 left-0 w-1 h-full -translate-x-1/2 cursor-col-resize hover:bg-primary/20 active:bg-primary/30 z-10"
        onMouseDown={handleMouseDown}
      />
      <ChatFeed />
    </div>
  )
}
