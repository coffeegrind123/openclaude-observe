import * as React from 'react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useCreateInstructionsFile } from '@/hooks/use-instructions'
import { ApiError } from '@/lib/api-client'
import type { InstructionsFileHeader, InstructionsStore } from '@/types/instructions'
import { ROLE_LABEL, agentDirsFor, templateFor } from './instructions-lib'

interface NewFileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  store: InstructionsStore
  files: InstructionsFileHeader[]
  onCreated: (relPath: string) => void
}

const AGENT_CHOICE = '__agent__'

const SELECT_CLASS = cn(
  'mt-1 h-9 w-full rounded-md border border-input bg-transparent dark:bg-input/30 px-3 text-sm',
  'outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
)

/** Agent file stem: lowercase letters, digits, dashes — also a safe path segment. */
function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const DIR_HINT: Record<string, string> = {
  '': 'user subagent',
  '.pi/agents': 'project — highest precedence',
  '.agents/agents': 'shared workspace',
}

export function NewFileDialog({ open, onOpenChange, store, files, onCreated }: NewFileDialogProps) {
  const missing = files.filter((f) => !f.exists)
  const agentDirs = agentDirsFor(store.kind)
  const [choice, setChoice] = React.useState('')
  const [agentDir, setAgentDir] = React.useState(agentDirs[0] ?? '')
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const create = useCreateInstructionsFile(store.id)

  React.useEffect(() => {
    if (!open) {
      return
    }
    setChoice(agentDirs.length ? AGENT_CHOICE : (missing[0]?.relPath ?? ''))
    setAgentDir(agentDirs[0] ?? '')
    setName('')
    setDescription('')
    // Reset only when the dialog opens, not on every refetch of `files`.
  }, [open, store.id])

  const isAgent = choice === AGENT_CHOICE
  const slug = slugify(name)
  const relPath = isAgent
    ? slug
      ? agentDir
        ? `${agentDir}/${slug}.md`
        : `${slug}.md`
      : ''
    : choice
  const taken = isAgent && files.some((f) => f.exists && f.relPath === relPath)
  const chosenMissing = missing.find((f) => f.relPath === choice)

  const submit = async () => {
    if (!relPath || taken) {
      return
    }
    const template = isAgent
      ? {
          frontmatter: {
            name: slug,
            ...(description.trim() ? { description: description.trim() } : {}),
          },
          body: `You are ${slug}.\n`,
        }
      : templateFor(chosenMissing?.role ?? 'context')
    try {
      const file = await create.mutateAsync({ path: relPath, ...template })
      toast.success(`Created ${file.relPath}`)
      onOpenChange(false)
      onCreated(file.relPath)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to create file')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>New instruction file</DialogTitle>
        <p className="text-xs text-muted-foreground font-mono truncate">{store.dir}</p>
        <div className="space-y-3 mt-2">
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Kind</span>
            <select
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              className={SELECT_CLASS}
            >
              {agentDirs.length > 0 && <option value={AGENT_CHOICE}>Subagent definition</option>}
              {missing.map((f) => (
                <option key={f.relPath} value={f.relPath}>
                  {f.relPath} — {ROLE_LABEL[f.role]}
                </option>
              ))}
            </select>
          </label>

          {isAgent && (
            <>
              {agentDirs.length > 1 && (
                <label className="block">
                  <span className="text-xs font-medium text-muted-foreground">Directory</span>
                  <select
                    value={agentDir}
                    onChange={(e) => setAgentDir(e.target.value)}
                    className={SELECT_CLASS}
                  >
                    {agentDirs.map((d) => (
                      <option key={d} value={d}>
                        {d || '.'} — {DIR_HINT[d]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">Name</span>
                <Input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submit()}
                  placeholder="reviewer"
                  className={cn('mt-1', taken && 'border-amber-500/60')}
                />
                {relPath && (
                  <span
                    className={cn(
                      'mt-1 block font-mono text-[0.7rem]',
                      taken ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground',
                    )}
                  >
                    → {relPath}
                    {taken && ' (already exists)'}
                  </span>
                )}
              </label>
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">Description</span>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value.replace(/[\r\n]+/g, ' '))}
                  placeholder="One line — shown to the model choosing a subagent"
                  className="mt-1"
                />
              </label>
            </>
          )}

          {chosenMissing?.role === 'system' && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
              SYSTEM.md <span className="font-medium">replaces</span> pi's default system prompt
              entirely. Use APPEND_SYSTEM.md to add to it instead.
            </p>
          )}
          {chosenMissing?.role === 'context' && (
            <p className="text-xs text-muted-foreground">
              pi loads only the first of AGENTS.override.md, AGENTS.md, CLAUDE.md in a directory.
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={submit} disabled={create.isPending || !relPath || taken}>
              {create.isPending ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
