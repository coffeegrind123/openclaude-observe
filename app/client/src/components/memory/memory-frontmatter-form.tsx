import * as React from 'react'
import { Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  MEMORY_TYPES,
  MEMORY_STATUSES,
  MEMORY_PROVENANCES,
  type MemoryEvidence,
} from '@/types/memory'

interface FrontmatterFormProps {
  value: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
}

const KNOWN_KEYS = new Set([
  'name',
  'description',
  'type',
  'status',
  'provenance',
  'triggers',
  'supersedes',
  'evidence',
  'metadata',
  'created_at',
  'created_by_session',
  'updated_at',
  'updated_by_session',
])

// Keys the form manages inside the `metadata:` wrapper (when present).
const META_MANAGED = ['type', 'status', 'provenance']

const READONLY_META = [
  'created_at',
  'created_by_session',
  'updated_at',
  'updated_by_session',
] as const

function asString(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

function asStringList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => asString(x)).filter(Boolean)
  if (typeof v === 'string' && v.trim()) return [v.trim()]
  return []
}

function asEvidence(v: unknown): MemoryEvidence[] {
  if (!Array.isArray(v)) return []
  return v.map((e) => {
    if (e && typeof e === 'object') {
      const o = e as Record<string, unknown>
      return {
        quote: asString(o.quote),
        source: asString(o.source),
        timestamp: asString(o.timestamp),
      }
    }
    return { quote: asString(e) }
  })
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

function Select({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  options: readonly string[]
  placeholder: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'h-9 w-full rounded-md border border-input bg-transparent dark:bg-input/30 px-3 text-sm',
        'outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
      )}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  )
}

/** Validate an OpenClaude trigger string: `tool:|bash:|file:|error:` + pattern. */
export function validateTrigger(raw: string): string | null {
  const idx = raw.indexOf(':')
  if (idx < 0) return 'Expected kind:pattern (tool/bash/file/error)'
  const kind = raw.slice(0, idx)
  const pattern = raw.slice(idx + 1)
  if (!['tool', 'bash', 'file', 'error'].includes(kind)) {
    return `Unknown kind "${kind}" — use tool, bash, file, or error`
  }
  if (!pattern.trim()) return 'Pattern is empty'
  return null
}

function StringListEditor({
  items,
  onChange,
  placeholder,
  validate,
}: {
  items: string[]
  onChange: (next: string[]) => void
  placeholder: string
  validate?: (item: string) => string | null
}) {
  const [draft, setDraft] = React.useState('')
  const add = () => {
    const v = draft.trim()
    if (!v) return
    onChange([...items, v])
    setDraft('')
  }
  return (
    <div className="space-y-1.5">
      {items.map((item, i) => {
        const err = validate?.(item) ?? null
        return (
          <div key={i}>
            <div className="flex items-center gap-1.5">
              <Input
                value={item}
                onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
                className={cn('h-8 font-mono text-xs', err && 'border-amber-500/60')}
                title={err ?? undefined}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => onChange(items.filter((_, j) => j !== i))}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            {err && (
              <p className="mt-0.5 text-[0.65rem] text-amber-600 dark:text-amber-400">{err}</p>
            )}
          </div>
        )
      })}
      <div className="flex items-center gap-1.5">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          placeholder={placeholder}
          className="h-8 font-mono text-xs"
        />
        <Button type="button" variant="outline" size="icon-sm" onClick={add}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

function EvidenceEditor({
  items,
  onChange,
}: {
  items: MemoryEvidence[]
  onChange: (next: MemoryEvidence[]) => void
}) {
  const update = (i: number, patch: Partial<MemoryEvidence>) =>
    onChange(items.map((e, j) => (j === i ? { ...e, ...patch } : e)))
  return (
    <div className="space-y-2">
      {items.map((e, i) => (
        <div key={i} className="rounded-md border border-border p-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[0.7rem] uppercase tracking-wide text-muted-foreground">
              Evidence {i + 1}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
          <textarea
            value={e.quote ?? ''}
            onChange={(ev) => update(i, { quote: ev.target.value })}
            placeholder="Verbatim quote"
            rows={2}
            className="w-full rounded-md border border-input bg-transparent dark:bg-input/30 px-2 py-1 text-xs outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          />
          <Input
            value={e.source ?? ''}
            onChange={(ev) => update(i, { source: ev.target.value })}
            placeholder="Source (file / URL / ticket)"
            className="h-8 text-xs"
          />
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...items, { quote: '', source: '' }])}
      >
        <Plus className="h-3.5 w-3.5" /> Add evidence
      </Button>
    </div>
  )
}

export function FrontmatterForm({ value, onChange }: FrontmatterFormProps) {
  const meta =
    value.metadata && typeof value.metadata === 'object' && !Array.isArray(value.metadata)
      ? (value.metadata as Record<string, unknown>)
      : null
  const usesMeta = !!meta

  const set = (key: string, v: unknown) => {
    const next = { ...value }
    if (v === '' || (Array.isArray(v) && v.length === 0)) {
      delete next[key]
    } else {
      next[key] = v
    }
    onChange(next)
  }

  // Adaptive read/write for fields that live under `metadata:` in the
  // auto-memory schema but top-level in the flat memdir schema.
  const getAdaptive = (key: string) => asString(value[key]) || (meta ? asString(meta[key]) : '')
  const setAdaptive = (key: string, v: string) => {
    if (!usesMeta) {
      set(key, v)
      return
    }
    const nm = { ...(meta as Record<string, unknown>) }
    if (v === '') delete nm[key]
    else nm[key] = v
    const next = { ...value }
    if (Object.keys(nm).length) next.metadata = nm
    else delete next.metadata
    onChange(next)
  }

  const unknownKeys = Object.keys(value).filter((k) => !KNOWN_KEYS.has(k))
  const metaExtra = meta ? Object.keys(meta).filter((k) => !META_MANAGED.includes(k)) : []
  const evidence = asEvidence(value.evidence)

  return (
    <div className="space-y-3">
      <Field label="name">
        <Input
          value={asString(value.name)}
          onChange={(e) => set('name', e.target.value)}
          placeholder="short-kebab-case-slug"
          className="font-mono text-sm"
        />
      </Field>

      <Field label="description">
        <textarea
          value={asString(value.description)}
          onChange={(e) => set('description', e.target.value)}
          placeholder="One-line summary used for recall relevance"
          rows={2}
          className="w-full rounded-md border border-input bg-transparent dark:bg-input/30 px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
        />
      </Field>

      <div className="grid grid-cols-3 gap-2">
        <Field label="type">
          <Select
            value={getAdaptive('type')}
            onChange={(v) => setAdaptive('type', v)}
            options={MEMORY_TYPES}
            placeholder="—"
          />
        </Field>
        <Field label="status">
          <Select
            value={getAdaptive('status')}
            onChange={(v) => setAdaptive('status', v)}
            options={MEMORY_STATUSES}
            placeholder="—"
          />
        </Field>
        <Field label="provenance">
          <Select
            value={getAdaptive('provenance')}
            onChange={(v) => setAdaptive('provenance', v)}
            options={MEMORY_PROVENANCES}
            placeholder="—"
          />
        </Field>
      </div>

      <Field label="triggers">
        <StringListEditor
          items={asStringList(value.triggers)}
          onChange={(next) => set('triggers', next)}
          placeholder="tool:Bash · file:src/**/*.ts · error:ECONN"
          validate={validateTrigger}
        />
      </Field>

      <Field label="supersedes">
        <StringListEditor
          items={asStringList(value.supersedes)}
          onChange={(next) => set('supersedes', next)}
          placeholder="old-file.md"
        />
      </Field>

      <Field label="evidence">
        <EvidenceEditor items={evidence} onChange={(next) => set('evidence', next)} />
      </Field>

      {READONLY_META.some((k) => value[k] != null) && (
        <div className="rounded-md bg-muted/50 p-2 space-y-0.5">
          {READONLY_META.filter((k) => value[k] != null).map((k) => (
            <div key={k} className="flex justify-between gap-2 text-[0.7rem] font-mono">
              <span className="text-muted-foreground">{k}</span>
              <span className="truncate text-foreground/70" title={asString(value[k])}>
                {asString(value[k])}
              </span>
            </div>
          ))}
        </div>
      )}

      {metaExtra.length > 0 && (
        <div className="rounded-md bg-muted/50 p-2 space-y-0.5">
          <p className="text-[0.7rem] text-muted-foreground mb-1">metadata (preserved on save):</p>
          {metaExtra.map((k) => (
            <div key={k} className="flex justify-between gap-2 text-[0.7rem] font-mono">
              <span className="text-muted-foreground">{k}</span>
              <span
                className="truncate text-foreground/70"
                title={asString((meta as Record<string, unknown>)[k])}
              >
                {asString((meta as Record<string, unknown>)[k])}
              </span>
            </div>
          ))}
        </div>
      )}

      {unknownKeys.length > 0 && (
        <div className="rounded-md border border-dashed border-border p-2">
          <p className="text-[0.7rem] text-muted-foreground mb-1">
            Other fields (preserved on save — edit in Raw mode):
          </p>
          {unknownKeys.map((k) => (
            <div key={k} className="flex justify-between gap-2 text-[0.7rem] font-mono">
              <span className="text-muted-foreground">{k}</span>
              <span className="truncate text-foreground/70" title={JSON.stringify(value[k])}>
                {JSON.stringify(value[k])}
              </span>
            </div>
          ))}
        </div>
      )}

      <CustomFieldAdder
        existing={new Set(Object.keys(value))}
        onAdd={(key, val) => set(key, val)}
      />
    </div>
  )
}

/** Append an arbitrary top-level frontmatter field (string value). */
function CustomFieldAdder({
  existing,
  onAdd,
}: {
  existing: Set<string>
  onAdd: (key: string, value: string) => void
}) {
  const [key, setKey] = React.useState('')
  const [val, setVal] = React.useState('')
  const trimmedKey = key.trim()
  const dupe = !!trimmedKey && existing.has(trimmedKey)
  const add = () => {
    if (!trimmedKey || dupe) return
    onAdd(trimmedKey, val)
    setKey('')
    setVal('')
  }
  return (
    <div className="flex items-end gap-1.5">
      <label className="flex-1">
        <span className="text-[0.65rem] text-muted-foreground">custom field</span>
        <Input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="key"
          className={cn('h-8 mt-0.5 font-mono text-xs', dupe && 'border-amber-500/60')}
          title={dupe ? 'Field already exists' : undefined}
        />
      </label>
      <Input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
        placeholder="value"
        className="flex-1 h-8 font-mono text-xs"
      />
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        onClick={add}
        disabled={!trimmedKey || dupe}
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
