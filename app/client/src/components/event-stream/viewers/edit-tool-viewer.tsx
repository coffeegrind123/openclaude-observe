import { lazy, Suspense, useState } from 'react'
import { DiffViewer } from './diff-viewer'
import { DiffPre } from '../detail-parts'

// react-diff-viewer-continued is heavy; only pull it in when a user asks for
// the side-by-side view.
const ReactDiffViewer = lazy(() => import('react-diff-viewer-continued'))

export interface EditBlock {
  oldText: string
  newText: string
}

interface EditToolViewerProps {
  path: string
  displayPath: string
  edits: EditBlock[]
  /** The tool's own display diff of the applied change (result details.diff). */
  resultDiff?: string | null
  /** First changed line in the new file (result details.firstChangedLine). */
  firstChangedLine?: number | null
}

type Mode = 'blocks' | 'split' | 'result'

export function EditToolViewer({
  path,
  displayPath,
  edits,
  resultDiff,
  firstChangedLine,
}: EditToolViewerProps) {
  const [mode, setMode] = useState<Mode>(resultDiff ? 'result' : 'blocks')

  if (edits.length === 0 && !resultDiff) {
    return (
      <div className="text-[11px] italic text-muted-foreground/70">No edit content captured.</div>
    )
  }

  const modes: { id: Mode; label: string }[] = []
  if (resultDiff) {
    modes.push({ id: 'result', label: 'applied diff' })
  }
  if (edits.length > 0) {
    modes.push({ id: 'blocks', label: 'edits' }, { id: 'split', label: 'side by side' })
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
        <span className="truncate font-mono">{displayPath}</span>
        <span className="shrink-0 rounded bg-muted/50 px-1 py-[1px]">
          {edits.length} edit{edits.length === 1 ? '' : 's'}
        </span>
        {firstChangedLine != null && (
          <span className="shrink-0 rounded bg-muted/50 px-1 py-[1px]">
            first change at line {firstChangedLine}
          </span>
        )}
        {modes.length > 1 && (
          <div className="ml-auto flex items-center gap-0.5 text-[9px]">
            {modes.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                className={`cursor-pointer rounded border px-1.5 py-[2px] transition-colors ${
                  mode === m.id
                    ? 'border-border bg-muted text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {mode === 'result' && resultDiff && <DiffPre value={resultDiff} maxHeight="max-h-96" />}

      {mode === 'blocks' &&
        edits.map((e, i) => (
          <div key={i} className="space-y-0.5">
            {edits.length > 1 && (
              <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
                edit {i + 1} of {edits.length}
              </div>
            )}
            <DiffViewer fileName={path} oldString={e.oldText} newString={e.newText} />
          </div>
        ))}

      {mode === 'split' &&
        edits.map((e, i) => (
          <div
            key={i}
            className="max-h-96 overflow-auto rounded bg-muted/50 text-[10px] [&_table]:!bg-transparent"
          >
            <Suspense fallback={<pre className="p-1.5 font-mono text-[10px]">Loading diff…</pre>}>
              <ReactDiffViewer
                oldValue={e.oldText}
                newValue={e.newText}
                splitView
                useDarkTheme
                styles={{
                  variables: {
                    dark: {
                      diffViewerBackground: 'transparent',
                      addedBackground: 'rgba(34,197,94,0.1)',
                      removedBackground: 'rgba(239,68,68,0.1)',
                      addedColor: '#4ade80',
                      removedColor: '#f87171',
                      wordAddedBackground: 'rgba(34,197,94,0.25)',
                      wordRemovedBackground: 'rgba(239,68,68,0.25)',
                      emptyLineBackground: 'transparent',
                      gutterBackground: 'transparent',
                      codeFoldBackground: 'transparent',
                      codeFoldGutterBackground: 'transparent',
                    },
                  },
                  contentText: { fontSize: '10px', lineHeight: '1.6' },
                }}
              />
            </Suspense>
          </div>
        ))}
    </div>
  )
}
