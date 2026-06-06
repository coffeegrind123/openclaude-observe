import * as React from 'react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useCreateMemoryFile } from '@/hooks/use-memory'
import { ApiError } from '@/lib/api-client'
import { MEMORY_TYPES, type MemoryStoreKind } from '@/types/memory'

interface NewFileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  storeId: string
  storeKind: MemoryStoreKind
  onCreated: (relPath: string) => void
}

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function NewFileDialog({
  open,
  onOpenChange,
  storeId,
  storeKind,
  onCreated,
}: NewFileDialogProps) {
  const [title, setTitle] = React.useState('')
  const [type, setType] = React.useState<string>(storeKind === 'project' ? 'project' : '')
  const [description, setDescription] = React.useState('')
  const create = useCreateMemoryFile(storeId)

  React.useEffect(() => {
    if (open) {
      setTitle('')
      setType(storeKind === 'project' ? 'project' : '')
      setDescription('')
    }
  }, [open, storeKind])

  const slug = slugify(title)
  const fileName = slug ? `${slug}.md` : ''
  // Agent stores conventionally hold a single MEMORY.md; default to that.
  const finalName = storeKind === 'agent' && !slug ? 'MEMORY.md' : fileName

  const submit = async () => {
    if (!finalName) {
      toast.error('Enter a name.')
      return
    }
    // Write the flat top-level schema that OpenClaude's canonical memdir reader
    // (frontmatterParser + memoryScan) reads. User-created via UI ⇒ provenance
    // 'manual', status 'current' (trusted, not a seedling).
    const useFrontmatter = storeKind === 'project'
    const payload = useFrontmatter
      ? {
          name: finalName,
          frontmatter: {
            name: slug,
            description: description.trim() || undefined,
            type: type || undefined,
            status: 'current',
            provenance: 'manual',
          } as Record<string, unknown>,
          body: `# ${title.trim() || slug}\n\n`,
        }
      : { name: finalName, content: `# ${title.trim() || slug}\n\n` }

    try {
      const file = await create.mutateAsync(payload)
      toast.success(`Created ${file.name}`)
      onOpenChange(false)
      onCreated(file.relPath)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to create file')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>New memory file</DialogTitle>
        <div className="space-y-3 mt-2">
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Title</span>
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="A short descriptive title"
              className="mt-1"
            />
            {finalName && (
              <span className="mt-1 block font-mono text-[0.7rem] text-muted-foreground">
                → {finalName}
              </span>
            )}
          </label>

          {storeKind === 'project' && (
            <>
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">Type</span>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className={cn(
                    'mt-1 h-9 w-full rounded-md border border-input bg-transparent dark:bg-input/30 px-3 text-sm',
                    'outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
                  )}
                >
                  <option value="">—</option>
                  {MEMORY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">Description</span>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="One-line summary for recall"
                  className="mt-1"
                />
              </label>
            </>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={submit} disabled={create.isPending || !finalName}>
              {create.isPending ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
