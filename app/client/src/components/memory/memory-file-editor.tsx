import * as React from 'react'
import { toast } from 'sonner'
import {
  Save,
  Trash2,
  RotateCcw,
  Eye,
  Pencil,
  FileCode,
  AlertTriangle,
  Link2,
  CornerUpLeft,
  Activity,
  Archive,
  ArrowRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { useSaveMemoryFile, useDeleteMemoryFile } from '@/hooks/use-memory'
import type { MemoryFile, MemoryFileHeader } from '@/types/memory'
import { ApiError } from '@/lib/api-client'
import { FrontmatterForm } from './memory-frontmatter-form'
import { MemoryMarkdown } from './memory-markdown'
import { LinkingTextarea } from './memory-linking-textarea'
import { MemoryTypeIcon } from './memory-type-icon'
import {
  backlinksFor,
  composeContent,
  fileStem,
  isArchivedStatus,
  parseContent,
  readField,
  relativeTime,
  resolveLink,
  resolveSupersedes,
  statusBadgeClass,
  supersededBy,
  typeBadgeClass,
} from './memory-lib'
import { useUIStore } from '@/stores/ui-store'

interface MemoryFileEditorProps {
  storeId: string
  file: MemoryFile
  /** All file headers in the store, for wikilink resolution + backlinks. */
  files: MemoryFileHeader[]
  onNavigate: (relPath: string) => void
}

type Mode = 'form' | 'raw'

export function MemoryFileEditor({ storeId, file, files, onNavigate }: MemoryFileEditorProps) {
  // Edit state. `frontmatter` + `body` drive form mode; `raw` drives raw mode.
  // We keep them in sync on every mode switch so no edits are lost.
  const [frontmatter, setFrontmatter] = React.useState<Record<string, unknown> | null>(
    file.frontmatter,
  )
  const [body, setBody] = React.useState(file.body)
  const [raw, setRaw] = React.useState(file.content)
  const [mode, setMode] = React.useState<Mode>(
    file.frontmatterError ? 'raw' : file.isIndex && file.frontmatterRaw == null ? 'raw' : 'form',
  )
  const [showPreview, setShowPreview] = React.useState(false)

  const save = useSaveMemoryFile(storeId)
  const del = useDeleteMemoryFile(storeId)

  // Reset all local state when the file identity changes (navigating between
  // files reuses this component instance).
  const fileKey = `${storeId}::${file.relPath}::${file.mtimeMs}`
  const lastKey = React.useRef(fileKey)
  React.useEffect(() => {
    if (lastKey.current !== fileKey) {
      lastKey.current = fileKey
      setFrontmatter(file.frontmatter)
      setBody(file.body)
      setRaw(file.content)
      setMode(file.frontmatterError ? 'raw' : 'form')
      setShowPreview(false)
    }
  }, [fileKey, file])

  const switchMode = (next: Mode) => {
    if (next === mode) return
    if (next === 'raw') {
      // Compose raw from the structured edits so nothing is lost.
      setRaw(composeContent(frontmatter, body))
    } else {
      const parsed = parseContent(raw)
      if (parsed.error) {
        toast.error('Frontmatter is not valid YAML — fix it in Raw mode first.')
        return
      }
      setFrontmatter(parsed.frontmatter)
      setBody(parsed.body)
    }
    setMode(next)
  }

  const dirty =
    mode === 'raw' ? raw !== file.content : composeContent(frontmatter, body) !== file.content

  const revert = () => {
    setFrontmatter(file.frontmatter)
    setBody(file.body)
    setRaw(file.content)
    setMode(file.frontmatterError ? 'raw' : 'form')
  }

  const handleSave = async () => {
    try {
      if (mode === 'raw') {
        await save.mutateAsync({ relPath: file.relPath, payload: { content: raw } })
      } else {
        // Write exactly the edited frontmatter — no injected fields, so the
        // file's existing schema (metadata-wrapper vs flat) is preserved.
        await save.mutateAsync({ relPath: file.relPath, payload: { frontmatter, body } })
      }
      toast.success(`Saved ${file.name}`)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : `Failed to save ${file.name}`)
    }
  }

  const handleDelete = async () => {
    try {
      await del.mutateAsync(file.relPath)
      toast.success(`Deleted ${file.name}`)
      onNavigate('') // clear selection
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : `Failed to delete ${file.name}`)
    }
  }

  // Preview source: the body as currently edited.
  const previewBody = mode === 'raw' ? parseContent(raw).body : body
  const knownStems = React.useMemo(
    () => new Set(files.map((f) => fileStem(f.relPath).toLowerCase())),
    [files],
  )
  const navigateToStem = (stem: string) => {
    const target = resolveLink(stem, files)
    if (target) onNavigate(target.relPath)
    else toast.message(`No memory file matches [[${stem}]]`)
  }

  const header = files.find((f) => f.relPath === file.relPath)
  const outgoing = header?.links ?? []
  const backlinks = header ? backlinksFor(header, files) : []
  const supersedesEntries = header?.supersedes ?? []
  const supersededByFiles = header ? supersededBy(header, files) : []
  const sessionId = header?.sessionId
  const openSession = () => {
    if (sessionId) useUIStore.getState().setSelectedSessionId(sessionId)
  }
  const linkTargets = React.useMemo(
    () =>
      files
        .filter((f) => f.relPath !== file.relPath && !f.isIndex)
        .map((f) => ({ stem: fileStem(f.relPath), title: f.title })),
    [files, file.relPath],
  )

  const fmType = readField(frontmatter, 'type')
  const fmStatus = readField(frontmatter, 'status')
  const archived = isArchivedStatus(fmStatus)

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Editor header */}
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-semibold truncate">{file.name}</h2>
              {fmType && (
                <Badge
                  variant="outline"
                  className={cn('text-[0.7rem] gap-1', typeBadgeClass(fmType))}
                >
                  <MemoryTypeIcon type={fmType} className="h-3 w-3" />
                  {fmType}
                </Badge>
              )}
              {fmStatus && (
                <Badge
                  variant="outline"
                  className={cn('text-[0.7rem]', statusBadgeClass(fmStatus))}
                >
                  {fmStatus}
                </Badge>
              )}
              {file.frontmatterError && (
                <Badge variant="outline" className="text-[0.7rem] border-red-500/40 text-red-500">
                  <AlertTriangle className="h-3 w-3" /> bad frontmatter
                </Badge>
              )}
            </div>
            <p className="mt-0.5 flex items-center gap-2 font-mono text-xs text-muted-foreground">
              <span className="truncate">
                {file.relPath} · edited {relativeTime(file.mtimeMs)}
              </span>
              {sessionId && (
                <button
                  onClick={openSession}
                  className="inline-flex items-center gap-1 rounded px-1 text-primary hover:bg-primary/10 shrink-0"
                  title={`Open originating session ${sessionId}`}
                >
                  <Activity className="h-3 w-3" /> session
                </button>
              )}
            </p>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <div className="flex rounded-md border border-border overflow-hidden">
              <ModeButton active={mode === 'form'} onClick={() => switchMode('form')} icon={Pencil}>
                Form
              </ModeButton>
              <ModeButton active={mode === 'raw'} onClick={() => switchMode('raw')} icon={FileCode}>
                Raw
              </ModeButton>
            </div>
            <Button
              variant={showPreview ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setShowPreview((p) => !p)}
              title="Toggle markdown preview"
            >
              <Eye className="h-4 w-4" /> Preview
            </Button>
          </div>
        </div>

        {/* Action row */}
        <div className="mt-2 flex items-center gap-2">
          <Button size="sm" onClick={handleSave} disabled={!dirty || save.isPending}>
            <Save className="h-4 w-4" /> {save.isPending ? 'Saving…' : 'Save'}
          </Button>
          <Button size="sm" variant="outline" onClick={revert} disabled={!dirty}>
            <RotateCcw className="h-4 w-4" /> Revert
          </Button>
          <div className="flex-1" />
          {dirty && (
            <span className="text-xs text-amber-600 dark:text-amber-400">unsaved changes</span>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive">
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {file.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes the memory file from disk. OpenClaude will no longer
                  recall it. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  className="bg-destructive text-white hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Superseded / archived banner */}
      {(archived || supersededByFiles.length > 0) && (
        <div className="shrink-0 flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-300">
          <Archive className="h-3.5 w-3.5 shrink-0" />
          <span>
            {fmStatus === 'outdated'
              ? 'This memory is marked outdated.'
              : 'This memory is superseded.'}{' '}
            OpenClaude hides it from default recall.
          </span>
          {supersededByFiles.length > 0 && (
            <span className="flex items-center gap-1">
              Replaced by
              {supersededByFiles.map((f) => (
                <button
                  key={f.relPath}
                  onClick={() => onNavigate(f.relPath)}
                  className="underline underline-offset-2 hover:opacity-80"
                >
                  {f.title}
                </button>
              ))}
            </span>
          )}
        </div>
      )}

      {/* Editor body */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="flex-1 min-w-0 overflow-y-auto p-4 space-y-4">
          {mode === 'raw' ? (
            <LinkingTextarea
              value={raw}
              onChange={setRaw}
              targets={linkTargets}
              spellCheck={false}
              className="w-full min-h-[60vh] rounded-md border border-input bg-transparent dark:bg-input/30 p-3 font-mono text-[0.8125rem] leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] resize-y"
            />
          ) : (
            <>
              {file.frontmatterRaw != null ||
              (frontmatter && Object.keys(frontmatter).length > 0) ||
              !file.isIndex ? (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    Frontmatter
                  </h3>
                  <FrontmatterForm value={frontmatter ?? {}} onChange={setFrontmatter} />
                </section>
              ) : null}
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  Body
                </h3>
                <LinkingTextarea
                  value={body}
                  onChange={setBody}
                  targets={linkTargets}
                  spellCheck={false}
                  className="w-full min-h-[40vh] rounded-md border border-input bg-transparent dark:bg-input/30 p-3 font-mono text-[0.8125rem] leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] resize-y"
                />
              </section>
            </>
          )}

          {/* Links / backlinks / supersedes */}
          {(outgoing.length > 0 ||
            backlinks.length > 0 ||
            supersedesEntries.length > 0 ||
            supersededByFiles.length > 0) && (
            <section className="rounded-md border border-border p-3 space-y-2">
              {outgoing.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1">
                    <Link2 className="h-3.5 w-3.5" /> Links to
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {outgoing.map((stem) => {
                      const target = resolveLink(stem, files)
                      return (
                        <button
                          key={stem}
                          onClick={() => navigateToStem(stem)}
                          className={cn(
                            'rounded border px-1.5 py-0.5 text-xs transition-colors',
                            target
                              ? 'border-primary/30 text-primary hover:bg-primary/10'
                              : 'border-amber-500/30 text-amber-600 dark:text-amber-400',
                          )}
                        >
                          {stem}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
              {backlinks.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1">
                    <CornerUpLeft className="h-3.5 w-3.5" /> Linked from
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {backlinks.map((b) => (
                      <button
                        key={b.relPath}
                        onClick={() => onNavigate(b.relPath)}
                        className="rounded border border-border px-1.5 py-0.5 text-xs hover:bg-accent"
                      >
                        {b.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {supersedesEntries.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1">
                    <ArrowRight className="h-3.5 w-3.5" /> Supersedes
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {supersedesEntries.map((entry) => {
                      const target = resolveSupersedes(entry, files)
                      return (
                        <button
                          key={entry}
                          onClick={() => target && onNavigate(target.relPath)}
                          disabled={!target}
                          className={cn(
                            'rounded border px-1.5 py-0.5 text-xs',
                            target
                              ? 'border-border hover:bg-accent'
                              : 'border-dashed border-muted-foreground/30 text-muted-foreground',
                          )}
                          title={target ? `Go to ${target.name}` : 'Replaced file not found'}
                        >
                          {entry}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
              {supersededByFiles.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1">
                    <Archive className="h-3.5 w-3.5" /> Superseded by
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {supersededByFiles.map((f) => (
                      <button
                        key={f.relPath}
                        onClick={() => onNavigate(f.relPath)}
                        className="rounded border border-border px-1.5 py-0.5 text-xs hover:bg-accent"
                      >
                        {f.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
        </div>

        {/* Preview pane */}
        {showPreview && (
          <div className="w-1/2 max-w-[640px] shrink-0 border-l border-border overflow-y-auto p-4 bg-muted/20">
            <MemoryMarkdown
              body={previewBody}
              knownStems={knownStems}
              onNavigate={navigateToStem}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function ModeButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 px-2.5 h-8 text-xs font-medium transition-colors',
        active ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:bg-accent',
      )}
    >
      <Icon className="h-3.5 w-3.5" /> {children}
    </button>
  )
}
