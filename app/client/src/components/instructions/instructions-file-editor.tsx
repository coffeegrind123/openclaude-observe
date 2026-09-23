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
  EyeOff,
  Info,
  Link2Off,
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
import { useSaveInstructionsFile, useDeleteInstructionsFile } from '@/hooks/use-instructions'
import {
  FILE_TOKEN_WARN,
  type InstructionsFile,
  type InstructionsFileHeader,
  type InstructionsGraph,
  type InstructionsGraphNode,
  type InstructionsStore,
} from '@/types/instructions'
import { ApiError } from '@/lib/api-client'
import { AgentFrontmatterForm } from './instructions-frontmatter-form'
import { InstructionsMarkdown } from './instructions-markdown'
import { LinkingTextarea, type LinkTarget } from './instructions-linking-textarea'
import { InstructionsRoleIcon } from './instructions-role-icon'
import {
  EDGE_LABEL,
  ROLE_LABEL,
  agentIssues,
  composeContent,
  edgeColorHex,
  estimateTokens,
  fileStem,
  formatTokens,
  linksFor,
  nodeId,
  parseContent,
  relativeTime,
  resolveMdHref,
  roleBadgeClass,
  splitContent,
  type LinkRef,
} from './instructions-lib'

interface InstructionsFileEditorProps {
  store: InstructionsStore
  stores: InstructionsStore[]
  file: InstructionsFile
  header: InstructionsFileHeader | undefined
  graph: InstructionsGraph | undefined
  /** Open a file in any store (null relPath = the store's overview). */
  onOpen: (storeId: string, relPath: string | null) => void
}

type Mode = 'form' | 'raw'

const TEXTAREA_CLASS =
  'w-full rounded-md border border-input bg-transparent dark:bg-input/30 p-3 font-mono text-[0.8125rem] leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] resize-y'

/**
 * Resolve a [[wikilink]] stem the way the server's graph does: file stem or
 * subagent name, preferring the linking file's own store.
 */
function resolveStem(
  stem: string,
  storeId: string,
  nodes: InstructionsGraphNode[],
): InstructionsGraphNode | undefined {
  const lower = stem.toLowerCase()
  const matches = nodes.filter(
    (n) => fileStem(n.relPath).toLowerCase() === lower || n.agentName?.toLowerCase() === lower,
  )
  return matches.find((n) => n.storeId === storeId) ?? matches[0]
}

export function InstructionsFileEditor({
  store,
  stores,
  file,
  header,
  graph,
  onOpen,
}: InstructionsFileEditorProps) {
  const isAgent = file.role === 'agent'
  const initialMode: Mode = isAgent && !file.frontmatterError ? 'form' : 'raw'

  // `frontmatter` + `body` drive form mode; `raw` drives raw mode. They're
  // synced on every mode switch so no edits are lost.
  const [frontmatter, setFrontmatter] = React.useState<Record<string, unknown>>(
    file.frontmatter ?? {},
  )
  const [body, setBody] = React.useState(file.body)
  const [raw, setRaw] = React.useState(file.content)
  const [mode, setMode] = React.useState<Mode>(initialMode)
  const [showPreview, setShowPreview] = React.useState(false)

  const save = useSaveInstructionsFile(store.id)
  const del = useDeleteInstructionsFile(store.id)

  // Navigating between files may reuse this instance; reset on identity change.
  const fileKey = `${store.id}::${file.relPath}::${file.mtimeMs}`
  const lastKey = React.useRef(fileKey)
  React.useEffect(() => {
    if (lastKey.current === fileKey) {
      return
    }
    lastKey.current = fileKey
    setFrontmatter(file.frontmatter ?? {})
    setBody(file.body)
    setRaw(file.content)
    setMode(file.role === 'agent' && !file.frontmatterError ? 'form' : 'raw')
    setShowPreview(false)
  }, [fileKey, file])

  const switchMode = (next: Mode) => {
    if (next === mode) {
      return
    }
    if (next === 'raw') {
      setRaw(composeContent(frontmatter, body))
    } else {
      const parsed = parseContent(raw)
      if (parsed.error) {
        toast.error('Frontmatter is not valid YAML — fix it in Raw mode first.')
        return
      }
      setFrontmatter(parsed.frontmatter ?? {})
      setBody(parsed.body)
    }
    setMode(next)
  }

  const currentText = mode === 'raw' ? raw : composeContent(frontmatter, body)
  // In form mode compare against the file re-serialized the same way, not the
  // bytes on disk — otherwise flow-style YAML (`tools: [a, b]`) reads as an
  // edit the moment the file opens.
  const baseline = React.useMemo(
    () =>
      file.frontmatterError ? file.content : composeContent(file.frontmatter ?? {}, file.body),
    [file],
  )
  const dirty = mode === 'raw' ? raw !== file.content : currentText !== baseline

  const revert = () => {
    setFrontmatter(file.frontmatter ?? {})
    setBody(file.body)
    setRaw(file.content)
    setMode(initialMode)
  }

  const handleSave = async () => {
    try {
      const payload = mode === 'raw' ? { content: raw } : { frontmatter, body }
      await save.mutateAsync({ relPath: file.relPath, payload })
      toast.success(`Saved ${file.relPath}`)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : `Failed to save ${file.relPath}`)
    }
  }

  const handleDelete = async () => {
    try {
      await del.mutateAsync(file.relPath)
      toast.success(`Deleted ${file.relPath}`)
      onOpen(store.id, null)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : `Failed to delete ${file.relPath}`)
    }
  }

  // Live cost of what's in the editor, so trimming shows its effect before saving.
  const currentSplit = splitContent(currentText)
  const liveTokens = isAgent ? estimateTokens(currentSplit.body) : estimateTokens(currentText)
  const overBudget = !header?.shadowedBy && liveTokens > FILE_TOKEN_WARN

  const issues = React.useMemo(() => {
    if (!isAgent) {
      return []
    }
    const parsed = parseContent(currentText)
    return agentIssues(parsed.frontmatter, currentSplit.frontmatterRaw)
  }, [isAgent, currentText, currentSplit.frontmatterRaw])

  const nodes = React.useMemo(() => graph?.nodes ?? [], [graph])
  const links = linksFor(graph, nodeId(store.id, file.relPath))

  const linkTargets = React.useMemo<LinkTarget[]>(() => {
    const seen = new Set<string>()
    const out: LinkTarget[] = []
    for (const n of nodes) {
      if (n.storeId === store.id && n.relPath === file.relPath) {
        continue
      }
      const stem = n.agentName ?? fileStem(n.relPath)
      if (seen.has(stem.toLowerCase())) {
        continue
      }
      seen.add(stem.toLowerCase())
      out.push({ stem, title: `${n.title} — ${n.storeLabel}` })
    }
    return out
  }, [nodes, store.id, file.relPath])

  const knownStems = React.useMemo(() => {
    const s = new Set<string>()
    for (const n of nodes) {
      s.add(fileStem(n.relPath).toLowerCase())
      if (n.agentName) {
        s.add(n.agentName.toLowerCase())
      }
    }
    return s
  }, [nodes])

  const navigateToStem = React.useCallback(
    (stem: string) => {
      const target = resolveStem(stem, store.id, nodes)
      if (target) {
        onOpen(target.storeId, target.relPath)
      } else {
        toast.message(`No instruction file or subagent matches [[${stem}]]`)
      }
    },
    [nodes, store.id, onOpen],
  )

  const openHref = React.useCallback(
    (href: string) => {
      const target = resolveMdHref(href, store, file.relPath, stores, nodes)
      if (target) {
        onOpen(target.storeId, target.relPath)
        return true
      }
      toast.message(`${href} is not an instruction file in any store`)
      return false
    },
    [store, file.relPath, stores, nodes, onOpen],
  )

  const previewBody = mode === 'raw' ? parseContent(raw).body : body

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Editor header */}
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <InstructionsRoleIcon role={file.role} className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-base font-semibold truncate">{file.relPath}</h2>
              <Badge variant="outline" className={cn('text-[0.7rem]', roleBadgeClass(file.role))}>
                {ROLE_LABEL[file.role]}
              </Badge>
              <Badge
                variant="outline"
                className={cn(
                  'text-[0.7rem] font-mono',
                  overBudget && 'border-amber-500/40 text-amber-600 dark:text-amber-400',
                )}
                title={
                  isAgent
                    ? 'Estimated tokens in the system prompt (body chars ÷ 4)'
                    : 'Estimated tokens sent on every request (chars ÷ 4)'
                }
              >
                {overBudget && <AlertTriangle className="h-3 w-3" />}≈{formatTokens(liveTokens)}{' '}
                tokens{isAgent ? ' prompt' : ''}
              </Badge>
              {file.frontmatterError && (
                <Badge variant="outline" className="text-[0.7rem] border-red-500/40 text-red-500">
                  <AlertTriangle className="h-3 w-3" /> bad frontmatter
                </Badge>
              )}
            </div>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground truncate">
              {store.dir}/{file.relPath} · edited {relativeTime(file.mtimeMs)}
            </p>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {isAgent && (
              <div className="flex rounded-md border border-border overflow-hidden">
                <ModeButton
                  active={mode === 'form'}
                  onClick={() => switchMode('form')}
                  icon={Pencil}
                >
                  Form
                </ModeButton>
                <ModeButton
                  active={mode === 'raw'}
                  onClick={() => switchMode('raw')}
                  icon={FileCode}
                >
                  Raw
                </ModeButton>
              </div>
            )}
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
                <AlertDialogTitle>Delete {file.relPath}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes {store.dir}/{file.relPath} from disk.{' '}
                  {isAgent
                    ? 'The subagent disappears from pi on its next session.'
                    : 'pi stops sending it on its next session.'}{' '}
                  This cannot be undone.
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

      <RoleBanner store={store} file={file} header={header} onOpen={onOpen} />

      {/* Editor body */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="flex-1 min-w-0 overflow-y-auto p-4 space-y-4">
          {issues.length > 0 && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs space-y-1">
              {issues.map((i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-500" />
                  <span>{i}</span>
                </div>
              ))}
            </div>
          )}

          {mode === 'raw' ? (
            <LinkingTextarea
              value={raw}
              onChange={setRaw}
              targets={linkTargets}
              spellCheck={false}
              className={cn(TEXTAREA_CLASS, 'min-h-[60vh]')}
            />
          ) : (
            <>
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  Definition
                </h3>
                <AgentFrontmatterForm value={frontmatter} onChange={setFrontmatter} />
              </section>
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  System prompt
                </h3>
                <LinkingTextarea
                  value={body}
                  onChange={setBody}
                  targets={linkTargets}
                  spellCheck={false}
                  className={cn(TEXTAREA_CLASS, 'min-h-[40vh]')}
                />
              </section>
            </>
          )}

          {(links.outgoing.length > 0 || links.incoming.length > 0 || links.broken.length > 0) && (
            <section className="rounded-md border border-border p-3 space-y-2">
              {links.outgoing.length > 0 && (
                <LinkGroup
                  icon={Link2}
                  label="Links to"
                  refs={links.outgoing}
                  storeId={store.id}
                  onOpen={onOpen}
                />
              )}
              {links.incoming.length > 0 && (
                <LinkGroup
                  icon={CornerUpLeft}
                  label="Referenced by"
                  refs={links.incoming}
                  storeId={store.id}
                  onOpen={onOpen}
                />
              )}
              {links.broken.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1">
                    <Link2Off className="h-3.5 w-3.5" /> Broken (saved version)
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {links.broken.map((b) => (
                      <span
                        key={b}
                        className="rounded border border-amber-500/30 px-1.5 py-0.5 font-mono text-xs text-amber-600 dark:text-amber-400"
                      >
                        {b}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
        </div>

        {showPreview && (
          <div className="w-1/2 max-w-[640px] shrink-0 border-l border-border overflow-y-auto p-4 bg-muted/20">
            <InstructionsMarkdown
              body={previewBody}
              knownStems={knownStems}
              onNavigate={navigateToStem}
              onFileLink={openHref}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function RoleBanner({
  store,
  file,
  header,
  onOpen,
}: {
  store: InstructionsStore
  file: InstructionsFile
  header: InstructionsFileHeader | undefined
  onOpen: (storeId: string, relPath: string | null) => void
}) {
  let tone: 'warn' | 'info' = 'info'
  let text: React.ReactNode = null
  const project = store.kind === 'project'

  const shadowedBy = header?.shadowedBy ?? null

  if (shadowedBy) {
    tone = 'warn'
    text = (
      <>
        pi ignores this file — it loads only the first context file per directory, and{' '}
        <button
          onClick={() => onOpen(store.id, shadowedBy)}
          className="underline underline-offset-2 hover:opacity-80 font-mono"
        >
          {shadowedBy}
        </button>{' '}
        takes precedence.
      </>
    )
  } else if (file.role === 'context' && file.frontmatterRaw != null) {
    tone = 'warn'
    text =
      "pi doesn't parse frontmatter in context files — the YAML block is sent to the model verbatim."
  } else if (file.role === 'context') {
    text = project
      ? 'Sent with every request in this directory (and any subdirectory), after the pi home and parent-directory context files.'
      : 'Sent with every request by every session using this pi home.'
  } else if (file.role === 'system') {
    text = project
      ? "Replaces pi's default system prompt when pi trusts this project — overrides the pi home's SYSTEM.md."
      : "Replaces pi's default system prompt for this home (a trusted project's .pi/SYSTEM.md overrides it)."
  } else if (file.role === 'append-system') {
    text = project
      ? "Appended to the system prompt when pi trusts this project — replaces the pi home's APPEND_SYSTEM.md."
      : "Appended to the system prompt for this home (a trusted project's .pi/APPEND_SYSTEM.md replaces it)."
  } else if (file.role === 'agent') {
    text =
      store.kind === 'home-agents'
        ? 'User-level subagent. Project definitions with the same name (.agents/agents, then .pi/agents) override it field by field.'
        : file.relPath.startsWith('.pi/')
          ? 'Project subagent — highest precedence; overrides same-named shared and user definitions field by field.'
          : 'Shared workspace subagent — overrides user definitions, overridden by .pi/agents.'
  }

  if (!text) {
    return null
  }
  return (
    <div
      className={cn(
        'shrink-0 flex items-start gap-2 border-b px-4 py-2 text-xs',
        tone === 'warn'
          ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
          : 'border-border bg-muted/30 text-muted-foreground',
      )}
    >
      {tone === 'warn' ? (
        shadowedBy ? (
          <EyeOff className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        )
      ) : (
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      )}
      <span>{text}</span>
    </div>
  )
}

function LinkGroup({
  icon: Icon,
  label,
  refs,
  storeId,
  onOpen,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  refs: LinkRef[]
  storeId: string
  onOpen: (storeId: string, relPath: string | null) => void
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {refs.map(({ node, kind }) => (
          <button
            key={`${node.id}:${kind}`}
            onClick={() => onOpen(node.storeId, node.relPath)}
            className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs hover:bg-accent"
            title={`${EDGE_LABEL[kind]} · ${node.storeLabel}/${node.relPath}`}
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: edgeColorHex(kind) }}
            />
            {node.agentName ?? node.title}
            {node.storeId !== storeId && (
              <span className="text-muted-foreground">· {node.storeLabel}</span>
            )}
          </button>
        ))}
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
