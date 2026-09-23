import * as React from 'react'
import {
  ScrollText,
  ChevronRight,
  RefreshCw,
  FileText,
  AlertCircle,
  Search,
  List,
  Network,
  FilePlus2,
} from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api-client'
import { useUIStore } from '@/stores/ui-store'
import {
  useInstructionsStores,
  useInstructionsFiles,
  useInstructionsFile,
  useInstructionsGraph,
  useCreateInstructionsFile,
} from '@/hooks/use-instructions'
import type { InstructionsFileHeader, InstructionsStore } from '@/types/instructions'
import { InstructionsOverview } from './instructions-overview'
import { InstructionsFileList } from './instructions-file-list'
import { InstructionsGraphView } from './instructions-graph'
import { InstructionsFileEditor } from './instructions-file-editor'
import { NewFileDialog } from './instructions-new-file-dialog'
import { InstructionsContextLint } from './instructions-context-lint'
import { InstructionsCommandPalette } from './instructions-command-palette'
import {
  ROLE_LABEL,
  STORE_KIND_LABEL,
  agentDirsFor,
  nodeId,
  storeSubtitle,
  templateFor,
} from './instructions-lib'

export function InstructionsBrowser() {
  const storeId = useUIStore((s) => s.instructionsSelectedStoreId)
  const selectedFile = useUIStore((s) => s.instructionsSelectedFile)
  const setStore = useUIStore((s) => s.setInstructionsStore)
  const setFile = useUIStore((s) => s.setInstructionsFile)
  const openFile = useUIStore((s) => s.openInstructionsFile)
  const qc = useQueryClient()
  const [newOpen, setNewOpen] = React.useState(false)
  const [paletteOpen, setPaletteOpen] = React.useState(false)
  const [view, setView] = React.useState<'list' | 'graph'>('list')
  const [visibleFiles, setVisibleFiles] = React.useState<InstructionsFileHeader[]>([])
  const [highlight, setHighlight] = React.useState(-1)

  const storesQ = useInstructionsStores()
  const filesQ = useInstructionsFiles(storeId)
  const graphQ = useInstructionsGraph()

  const stores = React.useMemo(() => (storesQ.data?.ok ? storesQ.data.stores : []), [storesQ.data])
  const homes = storesQ.data?.ok ? storesQ.data.homes : []
  const activeStore = stores.find((s) => s.id === storeId)
  const files = React.useMemo(() => filesQ.data?.files ?? [], [filesQ.data])
  const selectedHeader = files.find((f) => f.relPath === selectedFile)
  // Placeholders (allowlisted but missing) have nothing to fetch.
  const fileQ = useInstructionsFile(
    storeId,
    selectedFile && selectedHeader?.exists !== false ? selectedFile : null,
  )
  const canCreate =
    !!activeStore &&
    activeStore.available &&
    (agentDirsFor(activeStore.kind).length > 0 || files.some((f) => !f.exists))

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['instructions'] })
  }

  const onOpen = React.useCallback(
    (targetStore: string, relPath: string | null) => {
      if (targetStore === storeId) {
        setFile(relPath)
      } else {
        openFile(targetStore, relPath)
      }
    },
    [storeId, setFile, openFile],
  )

  // ⌘K / Ctrl-K opens the palette; j/k/arrows + Enter drive the list when not typing.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
        return
      }
      if (paletteOpen) {
        return
      }
      const el = e.target as HTMLElement | null
      const typing =
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable)
      if (typing || !storeId || visibleFiles.length === 0 || view !== 'list') {
        return
      }
      const isDown = e.key === 'ArrowDown' || e.key === 'j'
      const isUp = e.key === 'ArrowUp' || e.key === 'k'
      if (isDown || isUp) {
        e.preventDefault()
        setHighlight((h) =>
          isDown
            ? Math.min((h < 0 ? -1 : h) + 1, visibleFiles.length - 1)
            : Math.max((h < 0 ? visibleFiles.length : h) - 1, 0),
        )
      } else if (e.key === 'Enter' && highlight >= 0 && highlight < visibleFiles.length) {
        e.preventDefault()
        setFile(visibleFiles[highlight].relPath)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [paletteOpen, storeId, visibleFiles, highlight, setFile, view])

  React.useEffect(() => {
    setHighlight(-1)
  }, [storeId])

  if (storesQ.data && !storesQ.data.ok) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-md text-center">
          <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <h2 className="text-base font-semibold mb-1">Instructions browser unavailable</h2>
          <p className="text-sm text-muted-foreground">{storesQ.data.message}</p>
        </div>
      </div>
    )
  }

  const editorEl = (() => {
    if (!selectedFile || !storeId || !activeStore) {
      return null
    }
    if (selectedHeader && !selectedHeader.exists) {
      return (
        <PlaceholderPanel
          store={activeStore}
          header={selectedHeader}
          onCreated={(rel) => setFile(rel)}
        />
      )
    }
    if (fileQ.isLoading) {
      return <div className="p-6 text-sm text-muted-foreground">Loading…</div>
    }
    if (fileQ.isError) {
      return (
        <div className="p-6 text-sm text-destructive">
          {fileQ.error instanceof ApiError
            ? fileQ.error.message
            : 'Failed to load file. It may have been moved or deleted.'}
        </div>
      )
    }
    if (!fileQ.data) {
      return null
    }
    return (
      <InstructionsFileEditor
        key={`${storeId}:${selectedFile}`}
        store={activeStore}
        stores={stores}
        file={fileQ.data}
        header={selectedHeader}
        graph={graphQ.data}
        onOpen={onOpen}
      />
    )
  })()

  const body = (() => {
    if (view === 'graph') {
      return (
        <div className="flex-1 flex overflow-hidden min-h-0">
          <InstructionsGraphView
            graph={graphQ.data}
            stores={stores}
            initialStoreId={storeId}
            selectedId={storeId && selectedFile ? nodeId(storeId, selectedFile) : null}
            onSelect={(sid, rel) => onOpen(sid, rel)}
          />
          {selectedFile && editorEl && (
            <div className="w-[480px] shrink-0 min-w-0 overflow-hidden border-l border-border">
              {editorEl}
            </div>
          )}
        </div>
      )
    }
    if (!storeId) {
      return <InstructionsOverview homes={homes} stores={stores} onSelect={setStore} />
    }
    if (activeStore && !activeStore.available) {
      return (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-md text-center">
            <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
            <h2 className="text-base font-semibold mb-1">Directory not found</h2>
            <p className="text-sm text-muted-foreground">
              <span className="font-mono">{activeStore.dir}</span> doesn't exist from the server's
              point of view. In docker, every pi home and project directory must be bind-mounted at
              the same absolute path pi uses.
            </p>
          </div>
        </div>
      )
    }
    return (
      <div className="flex-1 flex overflow-hidden min-h-0">
        <InstructionsFileList
          files={files}
          selectedRelPath={selectedFile}
          onSelect={(rel) => setFile(rel)}
          onNew={() => setNewOpen(true)}
          canCreate={canCreate}
          highlightIndex={highlight}
          onVisibleChange={setVisibleFiles}
        />
        <div className="flex-1 min-w-0 overflow-hidden">
          {selectedFile ? (
            editorEl
          ) : (
            <div className="h-full overflow-y-auto p-5">
              <div className="max-w-3xl mx-auto space-y-5">
                <div>
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                    <h2 className="text-base font-semibold">{activeStore?.label}</h2>
                    {activeStore && (
                      <span className="text-xs text-muted-foreground">
                        {STORE_KIND_LABEL[activeStore.kind]} · {activeStore.fileCount} file
                        {activeStore.fileCount === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                  {activeStore && (
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {activeStore.dir}
                    </p>
                  )}
                </div>
                {filesQ.isError && (
                  <p className="text-sm text-destructive">
                    {filesQ.error instanceof ApiError
                      ? filesQ.error.message
                      : 'Failed to list files.'}
                  </p>
                )}
                {activeStore && (
                  <InstructionsContextLint
                    store={activeStore}
                    files={files}
                    graph={graphQ.data}
                    onOpen={onOpen}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  })()

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Breadcrumb header */}
      <div className="shrink-0 shadow-float relative z-10 flex items-center gap-1 px-4 h-12 text-sm">
        <button
          onClick={() => setStore(null)}
          className="flex items-center gap-1.5 font-medium hover:text-primary transition-colors"
        >
          <ScrollText className="h-4 w-4" /> Instructions
        </button>
        {activeStore && (
          <>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            <button
              onClick={() => setFile(null)}
              title={activeStore.dir}
              className={cn(
                'truncate transition-colors',
                selectedFile ? 'text-muted-foreground hover:text-foreground' : 'font-medium',
              )}
            >
              {activeStore.label}
              <span className="ml-1 text-xs text-muted-foreground">
                ({storeSubtitle(activeStore)})
              </span>
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
        <div className="flex items-center rounded-md border border-border p-0.5">
          <button
            onClick={() => setView('list')}
            className={cn(
              'flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors',
              view === 'list'
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            title="List view"
          >
            <List className="h-3.5 w-3.5" /> List
          </button>
          <button
            onClick={() => setView('graph')}
            className={cn(
              'flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors',
              view === 'graph'
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            title="Link graph across all stores"
          >
            <Network className="h-3.5 w-3.5" /> Graph
          </button>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs text-muted-foreground"
          onClick={() => setPaletteOpen(true)}
          title="Search instructions (⌘K)"
        >
          <Search className="h-3.5 w-3.5" /> Search
          <kbd className="ml-1 rounded border border-border px-1 text-[0.6rem]">⌘K</kbd>
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={refresh} title="Refresh">
          <RefreshCw
            className={cn(
              'h-3.5 w-3.5',
              (filesQ.isFetching || storesQ.isFetching || graphQ.isFetching) && 'animate-spin',
            )}
          />
        </Button>
      </div>

      {body}

      {activeStore && (
        <NewFileDialog
          open={newOpen}
          onOpenChange={setNewOpen}
          store={activeStore}
          files={files}
          onCreated={(rel) => setFile(rel)}
        />
      )}

      <InstructionsCommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onNewFile={() => setNewOpen(true)}
        canCreate={canCreate}
      />
    </div>
  )
}

/** Shown for an allowlisted file that doesn't exist yet: explain it, offer to create it. */
function PlaceholderPanel({
  store,
  header,
  onCreated,
}: {
  store: InstructionsStore
  header: InstructionsFileHeader
  onCreated: (relPath: string) => void
}) {
  const create = useCreateInstructionsFile(store.id)
  const doCreate = async () => {
    try {
      const file = await create.mutateAsync({ path: header.relPath, ...templateFor(header.role) })
      toast.success(`Created ${file.relPath}`)
      onCreated(file.relPath)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : `Failed to create ${header.relPath}`)
    }
  }
  const explain: Record<string, string> = {
    context:
      'pi loads the first of AGENTS.override.md, AGENTS.md, CLAUDE.md found in this directory and sends it with every request.',
    system: "pi uses this file instead of its default system prompt. Leave it absent to keep pi's.",
    'append-system': 'pi appends this file to the system prompt on every request.',
    agent: 'A subagent definition.',
  }
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-lg mx-auto rounded-lg border border-dashed border-border p-6 text-center space-y-3">
        <FilePlus2 className="h-8 w-8 mx-auto text-muted-foreground" />
        <h2 className="text-base font-semibold font-mono">{header.relPath}</h2>
        <p className="text-xs text-muted-foreground font-mono break-all">
          {store.dir}/{header.relPath}
        </p>
        <p className="text-sm text-muted-foreground">
          Not created yet ({ROLE_LABEL[header.role]}). {explain[header.role]}
        </p>
        {header.role === 'system' && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Creating it replaces pi's built-in system prompt with this file's contents.
          </p>
        )}
        <Button size="sm" onClick={doCreate} disabled={create.isPending}>
          <FilePlus2 className="h-4 w-4" />{' '}
          {create.isPending ? 'Creating…' : `Create ${header.name}`}
        </Button>
      </div>
    </div>
  )
}
