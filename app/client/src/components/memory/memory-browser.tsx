import * as React from 'react'
import { Brain, ChevronRight, RefreshCw, FileText, AlertCircle, Search } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useUIStore } from '@/stores/ui-store'
import { useMemoryStores, useMemoryFiles, useMemoryFile } from '@/hooks/use-memory'
import { MemoryOverview } from './memory-overview'
import { MemoryFileList } from './memory-file-list'
import { MemoryFileEditor } from './memory-file-editor'
import { NewFileDialog } from './memory-new-file-dialog'
import { MemoryStoreLint } from './memory-store-lint'
import { MemoryCommandPalette } from './memory-command-palette'
import type { MemoryFileHeader } from '@/types/memory'

export function MemoryBrowser() {
  const storeId = useUIStore((s) => s.memorySelectedStoreId)
  const selectedFile = useUIStore((s) => s.memorySelectedFile)
  const setMemoryStore = useUIStore((s) => s.setMemoryStore)
  const setMemoryFile = useUIStore((s) => s.setMemoryFile)
  const qc = useQueryClient()
  const [newOpen, setNewOpen] = React.useState(false)
  const [paletteOpen, setPaletteOpen] = React.useState(false)
  const [visibleFiles, setVisibleFiles] = React.useState<MemoryFileHeader[]>([])
  const [highlight, setHighlight] = React.useState(-1)

  const storesQ = useMemoryStores()
  const filesQ = useMemoryFiles(storeId)
  const fileQ = useMemoryFile(storeId, selectedFile)

  const stores = storesQ.data?.ok ? storesQ.data.stores : []
  const activeStore = stores.find((s) => s.id === storeId)
  const files = filesQ.data?.files ?? []
  const canCreate = !!activeStore && activeStore.kind !== 'global'

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['memory'] })
  }

  // ⌘K / Ctrl-K opens the palette; list keyboard nav when not typing.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
        return
      }
      if (paletteOpen) return
      const el = e.target as HTMLElement | null
      const typing =
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable)
      if (typing) return
      if (!storeId || visibleFiles.length === 0) return
      const isDown = e.key === 'ArrowDown' || e.key === 'j'
      const isUp = e.key === 'ArrowUp' || e.key === 'k'
      if (isDown || isUp) {
        e.preventDefault()
        setHighlight((h) => {
          const next = isDown
            ? Math.min((h < 0 ? -1 : h) + 1, visibleFiles.length - 1)
            : Math.max((h < 0 ? visibleFiles.length : h) - 1, 0)
          return next
        })
      } else if (e.key === 'Enter' && highlight >= 0 && highlight < visibleFiles.length) {
        e.preventDefault()
        setMemoryFile(visibleFiles[highlight].relPath)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [paletteOpen, storeId, visibleFiles, highlight, setMemoryFile])

  // Reset the highlight when the store changes.
  React.useEffect(() => {
    setHighlight(-1)
  }, [storeId])

  // Feature disabled / not configured — explain rather than error.
  if (storesQ.data && !storesQ.data.ok) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-md text-center">
          <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <h2 className="text-base font-semibold mb-1">Memory browser unavailable</h2>
          <p className="text-sm text-muted-foreground">{storesQ.data.message}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Breadcrumb header */}
      <div className="shrink-0 shadow-float relative z-10 flex items-center gap-1 px-4 h-12 text-sm">
        <button
          onClick={() => setMemoryStore(null)}
          className="flex items-center gap-1.5 font-medium hover:text-primary transition-colors"
        >
          <Brain className="h-4 w-4" /> Memory
        </button>
        {activeStore && (
          <>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            <button
              onClick={() => setMemoryFile(null)}
              className={cn(
                'truncate transition-colors',
                selectedFile ? 'text-muted-foreground hover:text-foreground' : 'font-medium',
              )}
            >
              {activeStore.label}
            </button>
          </>
        )}
        {activeStore && selectedFile && (
          <>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-mono text-xs truncate">{selectedFile}</span>
          </>
        )}
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs text-muted-foreground"
          onClick={() => setPaletteOpen(true)}
          title="Search memory (⌘K)"
        >
          <Search className="h-3.5 w-3.5" /> Search
          <kbd className="ml-1 rounded border border-border px-1 text-[0.6rem]">⌘K</kbd>
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={refresh} title="Refresh">
          <RefreshCw className={cn('h-3.5 w-3.5', filesQ.isFetching && 'animate-spin')} />
        </Button>
      </div>

      {/* Body */}
      {!storeId ? (
        <MemoryOverview stores={stores} onSelect={setMemoryStore} />
      ) : (
        <div className="flex-1 flex overflow-hidden min-h-0">
          <MemoryFileList
            files={files}
            selectedRelPath={selectedFile}
            onSelect={(rel) => setMemoryFile(rel)}
            onNew={() => setNewOpen(true)}
            canCreate={canCreate}
            highlightIndex={highlight}
            onVisibleChange={setVisibleFiles}
          />
          <div className="flex-1 min-w-0 overflow-hidden">
            {selectedFile ? (
              fileQ.isLoading ? (
                <div className="p-6 text-sm text-muted-foreground">Loading…</div>
              ) : fileQ.isError ? (
                <div className="p-6 text-sm text-destructive">
                  Failed to load file. It may have been moved or deleted.
                </div>
              ) : fileQ.data ? (
                <MemoryFileEditor
                  key={`${storeId}:${selectedFile}`}
                  storeId={storeId}
                  file={fileQ.data}
                  files={files}
                  onNavigate={(rel) => setMemoryFile(rel || null)}
                />
              ) : null
            ) : (
              <div className="h-full overflow-y-auto p-5">
                <div className="max-w-2xl mx-auto space-y-5">
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                    <h2 className="text-base font-semibold">{activeStore?.label}</h2>
                    <span className="text-xs text-muted-foreground">
                      {files.length} file{files.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {files.length === 0
                      ? 'This store has no memory files yet.'
                      : 'Select a memory file from the list to view or edit it.'}
                  </p>
                  {storeId && files.length > 0 && (
                    <MemoryStoreLint storeId={storeId} files={files} onOpen={setMemoryFile} />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {storeId && activeStore && (
        <NewFileDialog
          open={newOpen}
          onOpenChange={setNewOpen}
          storeId={storeId}
          storeKind={activeStore.kind}
          onCreated={(rel) => setMemoryFile(rel)}
        />
      )}

      <MemoryCommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onNewFile={() => setNewOpen(true)}
        canCreate={canCreate}
      />
    </div>
  )
}
