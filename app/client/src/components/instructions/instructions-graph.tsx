import * as React from 'react'
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d'
import { forceCollide } from 'd3-force'
import { Search, Maximize2, Link2, Link2Off } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type {
  InstructionsFileRole,
  InstructionsGraph,
  InstructionsGraphEdge,
  InstructionsStore,
} from '@/types/instructions'
import {
  EDGE_LABEL,
  ROLE_LABEL,
  edgeColorHex,
  fileCost,
  formatTokens,
  roleColorHex,
} from './instructions-lib'

interface InstructionsGraphProps {
  graph: InstructionsGraph | undefined
  stores: InstructionsStore[]
  /**
   * Store to scope the view to when the graph opens (null = all stores).
   * Deliberately not tracked afterwards: clicking a node in another store
   * navigates there, and the view shouldn't re-scope under the user.
   */
  initialStoreId: string | null
  /** Graph node id (`<storeId>::<relPath>`) of the open file, if any. */
  selectedId: string | null
  onSelect: (storeId: string, relPath: string) => void
}

interface GNode {
  id: string
  storeId: string
  relPath: string
  label: string
  title: string
  role: InstructionsFileRole
  color: string
  deg: number
  r: number
  tokens: number
  shadowed: boolean
  isHub: boolean
  // injected by the force simulation
  x?: number
  y?: number
}
interface GLink {
  source: string | GNode
  target: string | GNode
  kind: InstructionsGraphEdge['kind']
  color: string
}

/** Zoom level past which every node shows its label (level-of-detail). */
const LABEL_SCALE = 1.6
/** Permanent-label cap: only the N highest-degree nodes are labelled by default. */
const HUB_LABELS = 6
const ROLES: InstructionsFileRole[] = ['context', 'system', 'append-system', 'agent']
const EDGE_KINDS: InstructionsGraphEdge['kind'][] = ['mdlink', 'wikilink', 'agent']

function linkEndId(e: string | GNode): string {
  return typeof e === 'object' ? e.id : e
}

/**
 * Build the force-graph model from the server's cross-store graph. Node size
 * tracks context cost (bigger = more tokens paid), so the heavy files stand
 * out; colour is what the file is to pi.
 */
function buildModel(graph: InstructionsGraph | undefined) {
  const srcNodes = graph?.nodes ?? []
  const srcEdges = graph?.edges ?? []
  const degree = new Map<string, number>()
  const bump = (id: string) => degree.set(id, (degree.get(id) ?? 0) + 1)
  const adjacency = new Map<string, Set<string>>()
  const touch = (a: string, b: string) => {
    if (!adjacency.has(a)) {
      adjacency.set(a, new Set())
    }
    adjacency.get(a)!.add(b)
  }

  const links: GLink[] = srcEdges.map((e) => {
    bump(e.source)
    bump(e.target)
    touch(e.source, e.target)
    touch(e.target, e.source)
    return { source: e.source, target: e.target, kind: e.kind, color: edgeColorHex(e.kind) }
  })

  const hubIds = new Set(
    [...degree.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, HUB_LABELS)
      .filter(([, d]) => d > 0)
      .map(([id]) => id),
  )

  const nodes: GNode[] = srcNodes.map((n) => {
    const tokens = fileCost(n)
    return {
      id: n.id,
      storeId: n.storeId,
      relPath: n.relPath,
      label: n.agentName ?? n.relPath,
      title: `${n.storeLabel} · ${n.relPath} · ≈${formatTokens(tokens)} tokens`,
      role: n.role,
      color: roleColorHex(n.role),
      deg: degree.get(n.id) ?? 0,
      r: 4 + Math.min(14, Math.sqrt(tokens) / 5),
      tokens,
      shadowed: n.shadowed,
      isHub: hubIds.has(n.id),
    }
  })

  return { nodes, links, adjacency, edgeCount: links.length }
}

export function InstructionsGraphView({
  graph,
  stores,
  initialStoreId,
  selectedId,
  onSelect,
}: InstructionsGraphProps) {
  const wrapRef = React.useRef<HTMLDivElement>(null)
  const fgRef = React.useRef<ForceGraphMethods<GNode, GLink> | undefined>(undefined)
  const onSelectRef = React.useRef(onSelect)
  onSelectRef.current = onSelect

  const [size, setSize] = React.useState({ w: 0, h: 0 })
  const [query, setQuery] = React.useState('')
  const [roleFilter, setRoleFilter] = React.useState<InstructionsFileRole | null>(null)
  const [storeFilter, setStoreFilter] = React.useState<string | null>(initialStoreId)
  const [linksOn, setLinksOn] = React.useState(true)
  const [hoverId, setHoverId] = React.useState<string | null>(null)

  const model = React.useMemo(() => buildModel(graph), [graph])

  // Apply filters without rebuilding node identities (so the sim keeps
  // positions). A store filter keeps that store's files plus anything they
  // link to or from — cross-store links are the point of the graph.
  const data = React.useMemo(() => {
    let nodes = model.nodes
    if (storeFilter) {
      const keep = new Set(nodes.filter((n) => n.storeId === storeFilter).map((n) => n.id))
      for (const id of [...keep]) {
        for (const nb of model.adjacency.get(id) ?? []) {
          keep.add(nb)
        }
      }
      nodes = nodes.filter((n) => keep.has(n.id))
    }
    if (roleFilter) {
      nodes = nodes.filter((n) => n.role === roleFilter)
    }
    const allow = new Set(nodes.map((n) => n.id))
    const links = model.links.filter(
      (l) => allow.has(linkEndId(l.source)) && allow.has(linkEndId(l.target)),
    )
    return { nodes, links }
  }, [model, storeFilter, roleFilter])

  const q = query.trim().toLowerCase()
  const searchHit = React.useCallback(
    (n: GNode) => !!q && (n.label.toLowerCase().includes(q) || n.title.toLowerCase().includes(q)),
    [q],
  )

  // Focused node = hovered, else the selected file. Its closed neighbourhood is
  // lit; everything else dims (Obsidian-style hop highlight).
  const focusId = hoverId ?? selectedId
  const highlightNodes = React.useMemo(() => {
    if (!focusId) return null
    const set = new Set<string>([focusId])
    for (const nb of model.adjacency.get(focusId) ?? []) set.add(nb)
    return set
  }, [focusId, model])

  // ── responsive sizing ──
  React.useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // ── physics: spread clusters, prevent overlap, settle, fit ──
  React.useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    fg.d3Force('charge')?.strength(-160)
    fg.d3Force('link')?.distance(46).strength(0.7)
    fg.d3Force('collide', forceCollide<GNode>((n) => n.r + 6).strength(0.9))
    fg.d3ReheatSimulation()
  }, [model])

  // Centre the selected node when it changes from outside (e.g. editor nav).
  React.useEffect(() => {
    const fg = fgRef.current
    if (!fg || !selectedId) return
    const n = model.nodes.find((x) => x.id === selectedId)
    if (n && n.x != null && n.y != null) {
      fg.centerAt(n.x, n.y, 500)
      fg.zoom(Math.max(2, fg.zoom()), 500)
    }
  }, [selectedId, model])

  const dimOf = (id: string) => (highlightNodes ? (highlightNodes.has(id) ? 1 : 0.12) : 1)

  // ── node painter: glow disc + LOD label ──
  const paintNode = React.useCallback(
    (node: GNode, ctx: CanvasRenderingContext2D, scale: number) => {
      const x = node.x ?? 0
      const y = node.y ?? 0
      const a = dimOf(node.id)
      const selected = node.id === selectedId
      const focused = node.id === focusId
      const hit = searchHit(node)

      ctx.save()
      ctx.globalAlpha = a
      // soft glow
      if (a > 0.5) {
        ctx.shadowColor = node.color
        ctx.shadowBlur = (focused ? 26 : 13) / Math.max(scale, 0.4)
      }
      ctx.beginPath()
      ctx.arc(x, y, node.r, 0, 2 * Math.PI)
      ctx.fillStyle = node.color
      ctx.globalAlpha = a * (node.shadowed ? 0.5 : 1)
      ctx.fill()
      ctx.shadowBlur = 0
      ctx.globalAlpha = a
      // separation ring so same-colour neighbours stay distinct
      ctx.lineWidth = 1 / scale
      ctx.strokeStyle = node.shadowed ? 'rgba(148,163,184,.6)' : 'rgba(7,11,22,.85)'
      if (node.shadowed) {
        ctx.setLineDash([3 / scale, 2 / scale])
      }
      ctx.stroke()
      ctx.setLineDash([])
      // selection / search rings
      if (selected || hit) {
        ctx.beginPath()
        ctx.arc(x, y, node.r + 3 / scale, 0, 2 * Math.PI)
        ctx.lineWidth = 2 / scale
        ctx.strokeStyle = selected ? '#ffffff' : '#facc15'
        ctx.stroke()
      }
      ctx.restore()
      // Labels are drawn in a separate post-pass (paintLabels) so they can be
      // de-cluttered against each other and never overlap.
    },
    [selectedId, focusId, highlightNodes, searchHit],
  )

  // ── label post-pass: priority order + collision skip so labels never overlap ──
  const wantsLabel = React.useCallback(
    (n: GNode, scale: number) =>
      (!highlightNodes || highlightNodes.has(n.id)) &&
      (scale > LABEL_SCALE ||
        n.isHub ||
        n.id === focusId ||
        n.id === selectedId ||
        searchHit(n) ||
        (highlightNodes?.has(n.id) ?? false)),
    [focusId, selectedId, searchHit, highlightNodes],
  )
  const labelPriority = React.useCallback(
    (n: GNode) => {
      if (n.id === selectedId) return 1e6
      if (n.id === focusId) return 9e5
      if (searchHit(n)) return 8e5
      return n.deg // hubs / well-connected files win the space over leaves
    },
    [selectedId, focusId, searchHit],
  )
  const paintLabels = React.useCallback(
    (ctx: CanvasRenderingContext2D, scale: number) => {
      const fontPx = 12 / scale
      ctx.font = `500 ${fontPx}px ui-sans-serif, system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      const padX = 4 / scale
      const padY = 2.5 / scale
      const gap = 3 / scale
      const placed: Array<[number, number, number, number]> = []
      const cands = data.nodes
        .filter((n) => wantsLabel(n, scale))
        .sort((a, b) => labelPriority(b) - labelPriority(a))
      for (const node of cands) {
        const x = node.x ?? 0
        const y = node.y ?? 0
        const label = node.label.length > 34 ? node.label.slice(0, 33) + '…' : node.label
        const w = ctx.measureText(label).width + padX * 2
        const h = fontPx + padY * 2
        const lx = x - w / 2
        const ly = y + node.r + gap
        // skip if this box would overlap a higher-priority label already drawn
        let clash = false
        for (const [px1, py1, px2, py2] of placed) {
          if (lx < px2 && lx + w > px1 && ly < py2 && ly + h > py1) {
            clash = true
            break
          }
        }
        if (clash) continue
        placed.push([lx, ly, lx + w, ly + h])
        ctx.fillStyle = 'rgba(7,11,22,.88)'
        roundRect(ctx, lx, ly, w, h, 3 / scale)
        ctx.fill()
        ctx.fillStyle = node.id === selectedId ? '#ffffff' : '#e6edf6'
        ctx.fillText(label, x, ly + padY)
      }
    },
    [data, wantsLabel, labelPriority, selectedId],
  )

  const paintPointer = React.useCallback(
    (node: GNode, color: string, ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(node.x ?? 0, node.y ?? 0, node.r + 2, 0, 2 * Math.PI)
      ctx.fill()
    },
    [],
  )

  const isHL = (l: GLink) =>
    !!highlightNodes &&
    highlightNodes.has(linkEndId(l.source)) &&
    highlightNodes.has(linkEndId(l.target))

  const fit = () => fgRef.current?.zoomToFit(500, 60)

  return (
    <div className="relative flex-1 h-full min-w-0 overflow-hidden bg-gradient-to-b from-background to-muted/20">
      {/* Toolbar */}
      <div className="absolute left-3 top-3 z-10 flex w-60 flex-col gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Highlight nodes…"
            className="h-8 bg-background/80 pl-7 text-sm backdrop-blur"
          />
        </div>
        <select
          value={storeFilter ?? ''}
          onChange={(e) => setStoreFilter(e.target.value || null)}
          className="h-8 rounded-md border border-input bg-background/80 px-2 text-xs backdrop-blur outline-none"
          title="Scope to one store (plus whatever it links to)"
        >
          <option value="">All stores</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.kind === 'home-agents' ? `${s.label} · subagents` : s.label}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setRoleFilter(null)}
            className={cn(
              'rounded-full border px-2 py-0.5 text-[0.7rem] transition-colors',
              !roleFilter
                ? 'border-primary/50 bg-primary/10 text-foreground'
                : 'border-border text-muted-foreground hover:bg-accent',
            )}
          >
            all
          </button>
          {ROLES.map((r) => (
            <button
              key={r}
              onClick={() => setRoleFilter((cur) => (cur === r ? null : r))}
              className={cn(
                'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.7rem] transition-colors',
                roleFilter === r
                  ? 'border-foreground/40 bg-accent text-foreground'
                  : 'border-border text-muted-foreground hover:bg-accent',
              )}
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: roleColorHex(r) }}
              />
              {ROLE_LABEL[r]}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-0.5 rounded-md border border-border bg-background/80 px-2 py-1 text-[0.65rem] text-muted-foreground backdrop-blur">
          {EDGE_KINDS.map((k) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-3" style={{ background: edgeColorHex(k) }} />
              {EDGE_LABEL[k]}
            </span>
          ))}
          <span>node size ∝ estimated tokens</span>
        </div>
      </div>

      {/* Top-right controls */}
      <div className="absolute right-3 top-3 z-10 flex gap-1.5">
        <Button
          variant="outline"
          size="icon-sm"
          className="bg-background/80 backdrop-blur"
          title={linksOn ? 'Hide links' : 'Show links'}
          onClick={() => setLinksOn((v) => !v)}
        >
          {linksOn ? <Link2 className="h-3.5 w-3.5" /> : <Link2Off className="h-3.5 w-3.5" />}
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          className="bg-background/80 backdrop-blur"
          title="Fit to view"
          onClick={fit}
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Empty / no-link hints */}
      {model.nodes.length === 0 ? (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          No instruction files to graph.
        </div>
      ) : data.links.length === 0 ? (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-border bg-background/80 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
          No links here — add [[wikilinks]], relative .md links, or mention a subagent by name.
        </div>
      ) : null}

      <div ref={wrapRef} className="absolute inset-0">
        {size.w > 0 && size.h > 0 && (
          <ForceGraph2D<GNode, GLink>
            ref={fgRef}
            width={size.w}
            height={size.h}
            graphData={data}
            backgroundColor="rgba(0,0,0,0)"
            nodeRelSize={4}
            nodeCanvasObject={paintNode}
            nodePointerAreaPaint={paintPointer}
            onRenderFramePost={paintLabels}
            linkColor={(l) => (isHL(l) ? (l as GLink).color : 'rgba(148,163,184,.18)')}
            linkWidth={(l) => (isHL(l) ? 2 : linksOn ? 1 : 0)}
            linkCurvature={0.12}
            linkVisibility={() => linksOn}
            linkDirectionalParticles={(l) => (isHL(l) ? 4 : 0)}
            linkDirectionalParticleWidth={2}
            linkDirectionalParticleSpeed={0.012}
            linkDirectionalParticleColor={(l) => (l as GLink).color}
            cooldownTicks={120}
            onEngineStop={() => fgRef.current?.zoomToFit(400, 60)}
            onNodeHover={(n) => setHoverId(n ? (n as GNode).id : null)}
            nodeLabel={(n) => (n as GNode).title}
            onNodeClick={(n) => onSelectRef.current((n as GNode).storeId, (n as GNode).relPath)}
            onBackgroundClick={() => setHoverId(null)}
            enableNodeDrag
          />
        )}
      </div>
    </div>
  )
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}
