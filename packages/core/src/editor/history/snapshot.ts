import { isEqual } from 'es-toolkit'

import {
  CommittedGraphEventError,
  restorePageCheckpoint,
  type SceneGraph,
  type SceneNode
} from '@open-pencil/scene-graph'

import type { EditorContext } from '#core/editor/types'
import { computeAllLayouts } from '#core/layout'

export type PageSnapshot = Map<string, SceneNode>
type DependentRoot = { parentId: string; index: number }
const dependentRoots = new WeakMap<PageSnapshot, Map<string, DependentRoot>>()

// Keep one reusable copy per live page. Weak keys release deleted pages/closed documents.
const recentSnapshots = new WeakMap<SceneGraph, WeakMap<SceneNode, PageSnapshot>>()

export function snapshotPage(
  graph: SceneGraph,
  pageId: string,
  before?: PageSnapshot
): PageSnapshot {
  const snapshot: PageSnapshot = new Map()
  const page = graph.getNode(pageId)
  if (!page) return snapshot
  let pages = recentSnapshots.get(graph)
  if (!pages) {
    pages = new WeakMap()
    recentSnapshots.set(graph, pages)
  }
  const previous = pages.get(page)
  const changed: SceneNode[] = []
  const sharedFields = new WeakMap<object, unknown>()
  const walk = (id: string) => {
    const node = graph.getNode(id)
    if (!node || snapshot.has(id)) return
    const saved = previous?.get(id)
    snapshot.set(id, saved && isEqual(saved, node) ? saved : node)
    if (snapshot.get(id) === node) changed.push(node)
    else if (saved) {
      for (const [key, value] of Object.entries(node)) {
        if (value && typeof value === 'object')
          sharedFields.set(value, saved[key as keyof SceneNode])
      }
    }
    for (const childId of node.childIds) walk(childId)
  }
  walk(pageId)
  const roots = new Map<string, DependentRoot>(before && dependentRoots.get(before))
  if (!before) captureDependentSnapshotRoots(graph, snapshot, roots, walk)
  // Freeze the same owned forest across both sides, even when the edit deleted a source.
  for (const id of roots.keys()) if (!snapshot.has(id)) walk(id)
  if (before) captureMovedSnapshotRoots(graph, snapshot, before, roots, walk)
  for (const [id, placement] of roots) {
    const live = graph.getNode(id)
    const parent = live?.parentId ? graph.getNode(live.parentId) : undefined
    if (live?.parentId && parent)
      roots.set(id, { parentId: live.parentId, index: parent.childIds.indexOf(id) })
    else roots.set(id, placement)
  }
  dependentRoots.set(snapshot, roots)
  copyChangedSnapshotNodes(snapshot, changed, previous, sharedFields)
  pages.set(page, snapshot)
  return snapshot
}

function captureDependentSnapshotRoots(
  graph: SceneGraph,
  snapshot: PageSnapshot,
  roots: Map<string, DependentRoot>,
  walk: (id: string) => void
): void {
  const components = [...snapshot.values()]
    .filter((node) => node.type === 'COMPONENT')
    .map((node) => node.id)
  const visited = new Set<string>()
  for (const id of components) {
    if (visited.has(id)) continue
    visited.add(id)
    for (const instance of graph.getInstances(id)) {
      const enclosing = instance.parentId
        ? graph.closest(instance.parentId, (node) => node.type === 'COMPONENT')
        : undefined
      if (enclosing && !visited.has(enclosing.id)) components.push(enclosing.id)
      const root = enclosing ?? instance
      if (snapshot.has(root.id) || !root.parentId) continue
      const parent = graph.getNode(root.parentId)
      if (parent)
        roots.set(root.id, { parentId: root.parentId, index: parent.childIds.indexOf(root.id) })
      walk(root.id)
    }
  }
}

function captureMovedSnapshotRoots(
  graph: SceneGraph,
  snapshot: PageSnapshot,
  before: PageSnapshot,
  roots: Map<string, DependentRoot>,
  walk: (id: string) => void
): void {
  // A captured node may move outside its original root. Own that node, never its new
  // foreign ancestor: the ancestor's pre-edit content was not part of this history.
  for (const saved of before.values()) {
    const live = graph.getNode(saved.id)
    if (!live || snapshot.has(live.id) || !live.parentId || !saved.parentId) continue
    const parent = graph.getNode(live.parentId)
    if (!parent) continue
    roots.set(live.id, { parentId: live.parentId, index: parent.childIds.indexOf(live.id) })
    dependentRoots.get(before)?.set(live.id, {
      parentId: saved.parentId,
      index: before.get(saved.parentId)?.childIds.indexOf(saved.id) ?? 0
    })
    walk(live.id)
  }
}

function copyChangedSnapshotNodes(
  snapshot: PageSnapshot,
  changed: SceneNode[],
  previous: PageSnapshot | undefined,
  sharedFields: WeakMap<object, unknown>
): void {
  // Layout changes must not re-copy immutable glyph/geometry/source payloads. Reuse
  // equal fields from owned history, never from mutable live nodes. Clone all new
  // fields together so shared imported payloads remain shared within this snapshot.
  const reusedFields: Record<string, unknown>[] = []
  const reusedFigPayloads = new Map<string, SceneNode['source']['fig']>()
  const changedFields = changed.map((node) => {
    const saved = previous?.get(node.id)
    const reused: Record<string, unknown> = {}
    const fresh: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node)) {
      if (saved && Object.hasOwn(saved, key) && isEqual(saved[key as keyof SceneNode], value)) {
        reused[key] = saved[key as keyof SceneNode]
        if (value && typeof value === 'object') sharedFields.set(value, reused[key])
      } else if (key === 'source' && saved && isEqual(saved.source.fig, node.source.fig)) {
        // Edit markers/order are a small mutable shell around a large unchanged FIG payload.
        // Retain the owned history payload, never the mutable live import or its buffers.
        const { fig: _fig, ...sourceFields } = node.source
        fresh.source = sourceFields
        reusedFigPayloads.set(node.id, saved.source.fig)
      } else fresh[key] = value
    }
    reusedFields.push(reused)
    return fresh
  })
  // New instances can borrow live payloads from older nodes. Resolve those aliases
  // to the owned history copy before cloning the remaining new fields together.
  changedFields.forEach((fields, index) => {
    for (const [key, value] of Object.entries(fields)) {
      if (value && typeof value === 'object' && sharedFields.has(value)) {
        const reused = reusedFields[index]
        if (reused) reused[key] = sharedFields.get(value)
        Reflect.deleteProperty(fields, key)
      }
    }
  })
  const clonedFields = structuredClone(changedFields)
  changed.forEach((node, index) => {
    // Every own field is replaced by an immutable reused value or an owned clone.
    const saved = { ...node, ...reusedFields[index], ...clonedFields[index] }
    const fig = reusedFigPayloads.get(node.id)
    if (fig) saved.source = { ...saved.source, fig }
    snapshot.set(node.id, saved)
  })
}

/** Restore the page the snapshot was taken of, whichever page is on screen. */
export function restorePageFromSnapshot(ctx: EditorContext, snapshot: PageSnapshot): void {
  // `snapshotPage` records the page first.
  const pageSnap = snapshot.values().next().value
  if (!pageSnap) return
  const page = ctx.graph.getNode(pageSnap.id)
  if (!page) return

  let layoutPages = new Set([page.id])
  const errors: unknown[] = []
  try {
    layoutPages = restorePageCheckpoint(ctx.graph, snapshot, dependentRoots.get(snapshot))
  } catch (error) {
    if (!(error instanceof CommittedGraphEventError)) throw error
    errors.push(error)
    layoutPages = new Set(ctx.graph.getPages().map((p) => p.id))
  }
  try {
    ctx.graph.clearAbsPosCache()
    if (page.id === ctx.state.currentPageId) {
      ctx.setSelectedIds(new Set())
      ctx.state.hoveredNodeId = null
    }
    for (const pageId of layoutPages) computeAllLayouts(ctx.graph, pageId)
  } catch (error) {
    errors.push(error)
  }
  try {
    ctx.requestRender()
  } catch (error) {
    errors.push(error)
  }
  if (errors.length) throw new CommittedGraphEventError(errors)
}
