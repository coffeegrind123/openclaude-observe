import * as React from 'react'
import { Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { THINKING_LEVELS } from '@/types/instructions'
import { AGENT_KEYS, readListField, writeListField, type ListFieldMode } from './instructions-lib'

interface AgentFrontmatterFormProps {
  value: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
}

const KNOWN_KEYS = new Set<string>(AGENT_KEYS)

const SELECT_CLASS = cn(
  'h-9 w-full rounded-md border border-input bg-transparent dark:bg-input/30 px-3 text-sm',
  'outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
)

function asString(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground font-mono">{label}</span>
      {hint && <span className="ml-1.5 text-[0.65rem] text-muted-foreground/70">{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  )
}

function StringListEditor({
  items,
  onChange,
  placeholder,
}: {
  items: string[]
  onChange: (next: string[]) => void
  placeholder: string
}) {
  const [draft, setDraft] = React.useState('')
  const add = () => {
    const v = draft.trim()
    if (!v) {
      return
    }
    onChange([...items, v])
    setDraft('')
  }
  return (
    <div className="space-y-1.5">
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {items.map((item, i) => (
            <span
              key={`${item}-${i}`}
              className="inline-flex items-center gap-1 rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-xs"
            >
              {item}
              <button
                type="button"
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                className="text-muted-foreground hover:text-foreground"
                title={`Remove ${item}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
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

/**
 * Editor for a `tools`/`extensions`/`skills`-style field, which
 * pi-subagents-lite reads as all / none / an explicit list / unset (inherit).
 */
function ListModeField({
  label,
  hint,
  value,
  modes,
  modeLabels,
  onChange,
  placeholder,
}: {
  label: string
  hint?: string
  value: unknown
  modes: ListFieldMode[]
  modeLabels?: Partial<Record<ListFieldMode, string>>
  onChange: (next: unknown) => void
  placeholder: string
}) {
  const parsed = readListField(value)
  // A mode the field can't express (e.g. `exclude_tools: none`, which pi reads
  // as unset) is shown as unset so saving normalises it.
  const mode = modes.includes(parsed.mode) ? parsed.mode : 'unset'
  const labels: Record<ListFieldMode, string> = {
    unset: 'inherit (unset)',
    all: 'all',
    none: 'none',
    list: 'only these…',
    ...modeLabels,
  }
  return (
    <Field label={label} hint={hint}>
      <div className="space-y-1.5">
        <select
          value={mode}
          onChange={(e) => {
            const next = e.target.value as ListFieldMode
            onChange(writeListField(next, next === 'list' ? parsed.items : []))
          }}
          className={SELECT_CLASS}
        >
          {modes.map((m) => (
            <option key={m} value={m}>
              {labels[m]}
            </option>
          ))}
        </select>
        {mode === 'list' && (
          <StringListEditor
            items={parsed.items}
            onChange={(items) => onChange(writeListField('list', items))}
            placeholder={placeholder}
          />
        )}
      </div>
    </Field>
  )
}

function TriStateField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint?: string
  value: unknown
  onChange: (next: boolean | undefined) => void
}) {
  const current =
    value === true || value === 'true'
      ? 'true'
      : value === false || value === 'false'
        ? 'false'
        : ''
  return (
    <Field label={label} hint={hint}>
      <select
        value={current}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value === 'true')}
        className={SELECT_CLASS}
      >
        <option value="">default</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    </Field>
  )
}

function NumberField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint?: string
  value: unknown
  onChange: (next: number | undefined) => void
}) {
  return (
    <Field label={label} hint={hint}>
      <Input
        type="number"
        min={1}
        value={asString(value)}
        onChange={(e) => {
          const raw = e.target.value
          onChange(raw === '' || Number.isNaN(Number(raw)) ? undefined : Number(raw))
        }}
        placeholder="default"
        className="font-mono text-sm"
      />
    </Field>
  )
}

/**
 * Schema-aware form for a pi-subagents-lite agent definition. Field meanings
 * follow parseAgentFile(); unknown keys are shown read-only and preserved.
 */
export function AgentFrontmatterForm({ value, onChange }: AgentFrontmatterFormProps) {
  const set = (key: string, v: unknown) => {
    const next = { ...value }
    if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) {
      delete next[key]
    } else {
      next[key] = v
    }
    onChange(next)
  }

  const unknownKeys = Object.keys(value).filter((k) => !KNOWN_KEYS.has(k))
  const thinking = asString(value.thinking)
  const thinkingKnown = !thinking || (THINKING_LEVELS as readonly string[]).includes(thinking)

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label="name" hint="required — how the agent is called">
          <Input
            value={asString(value.name)}
            onChange={(e) => set('name', e.target.value)}
            placeholder="explorer"
            className={cn('font-mono text-sm', !asString(value.name) && 'border-amber-500/60')}
          />
        </Field>
        <Field label="display_name">
          <Input
            value={asString(value.display_name)}
            onChange={(e) => set('display_name', e.target.value)}
            placeholder="Explorer"
            className="text-sm"
          />
        </Field>
      </div>

      <Field label="description" hint="one line — shown to the model choosing an agent">
        <Input
          value={asString(value.description)}
          onChange={(e) => set('description', e.target.value.replace(/[\r\n]+/g, ' '))}
          placeholder="Answers one investigation question with file:line evidence"
          className="text-sm"
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="model" hint="provider/model-id">
          <Input
            value={asString(value.model)}
            onChange={(e) => set('model', e.target.value)}
            placeholder="inherit"
            className="font-mono text-sm"
          />
        </Field>
        <Field label="thinking">
          <select
            value={thinking}
            onChange={(e) => set('thinking', e.target.value)}
            className={cn(SELECT_CLASS, !thinkingKnown && 'border-amber-500/60')}
          >
            <option value="">inherit</option>
            {!thinkingKnown && <option value={thinking}>{thinking} (invalid)</option>}
            {THINKING_LEVELS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <ListModeField
          label="tools"
          value={value.tools}
          modes={['unset', 'all', 'none', 'list']}
          onChange={(v) => set('tools', v)}
          placeholder="read · grep · bash"
        />
        <ListModeField
          label="exclude_tools"
          value={value.exclude_tools}
          modes={['unset', 'all', 'list']}
          modeLabels={{ unset: 'exclude nothing', all: 'exclude all' }}
          onChange={(v) => set('exclude_tools', v)}
          placeholder="write · edit"
        />
        <ListModeField
          label="extensions"
          value={value.extensions}
          modes={['unset', 'all', 'none', 'list']}
          onChange={(v) => set('extensions', v)}
          placeholder="extension name"
        />
        <ListModeField
          label="exclude_extensions"
          value={value.exclude_extensions}
          modes={['unset', 'all', 'list']}
          modeLabels={{ unset: 'exclude nothing', all: 'exclude all' }}
          onChange={(v) => set('exclude_extensions', v)}
          placeholder="pi-mcp-adapter"
        />
        <ListModeField
          label="skills"
          value={value.skills}
          modes={['unset', 'all', 'none', 'list']}
          onChange={(v) => set('skills', v)}
          placeholder="skill name"
        />
        <ListModeField
          label="preload_skills"
          hint="loaded into the prompt up front"
          value={value.preload_skills}
          modes={['unset', 'none', 'list']}
          onChange={(v) => set('preload_skills', v)}
          placeholder="skill name"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="max_turns"
          value={value.max_turns}
          onChange={(v) => set('max_turns', v)}
        />
        <NumberField
          label="max_tokens"
          value={value.max_tokens}
          onChange={(v) => set('max_tokens', v)}
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <TriStateField
          label="include_context_files"
          hint="AGENTS.md etc."
          value={value.include_context_files}
          onChange={(v) => set('include_context_files', v)}
        />
        <TriStateField
          label="include_system_prompt"
          value={value.include_system_prompt}
          onChange={(v) => set('include_system_prompt', v)}
        />
        <TriStateField
          label="include_environment"
          value={value.include_environment}
          onChange={(v) => set('include_environment', v)}
        />
        <TriStateField label="hidden" value={value.hidden} onChange={(v) => set('hidden', v)} />
        <TriStateField
          label="output_transcript"
          value={value.output_transcript}
          onChange={(v) => set('output_transcript', v)}
        />
      </div>

      {unknownKeys.length > 0 && (
        <div className="rounded-md border border-dashed border-border p-2">
          <p className="text-[0.7rem] text-muted-foreground mb-1">
            Fields pi-subagents-lite doesn't read (preserved on save — edit in Raw mode):
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
    </div>
  )
}
