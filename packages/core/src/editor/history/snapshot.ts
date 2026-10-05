import { isEqual } from 'es-toolkit'

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import type { EditorContext } from '#core/editor/types'
import { computeAllLayouts } from '#core/layout'

export type PageSnapshot = Map<string, SceneNode>

// Only the most recent page is cached; deleted pages and closed documents are not retained.
const recentSnapshots = new WeakMap<SceneGraph, PageSnapshot>()

export function snapshotPage(graph: SceneGraph, pageId: string): PageSnapshot {
  const snapshot: PageSnapshot = new Map()
  const previous = recentSnapshots.get(graph)
  const walk = (id: string) => {
    const node = graph.getNode(id)
    if (!node) return
    const saved = previous?.get(id)
    snapshot.set(id, saved && isEqual(saved, node) ? saved : structuredClone(node))
    for (const childId of node.childIds) walk(childId)
  }
  walk(pageId)
  recentSnapshots.set(graph, snapshot)
  return snapshot
}

/** Restore the page the snapshot was taken of, whichever page is on screen. */
export function restorePageFromSnapshot(ctx: EditorContext, snapshot: PageSnapshot): void {
  // `snapshotPage` records the page first.
  const pageSnap = snapshot.values().next().value
  if (!pageSnap) return
  const page = ctx.graph.getNode(pageSnap.id)
  if (!page) return

  for (const childId of page.childIds.slice()) ctx.graph.deleteNode(childId)
  restoreChildren(ctx.graph, snapshot, page.id, pageSnap.childIds)

  ctx.graph.clearAbsPosCache()
  computeAllLayouts(ctx.graph, page.id)
  if (page.id === ctx.state.currentPageId) {
    ctx.setSelectedIds(new Set())
    ctx.state.hoveredNodeId = null
  }
  ctx.requestRender()
}

function restoreChildren(
  graph: SceneGraph,
  snapshot: PageSnapshot,
  parentId: string,
  childIds: string[]
): void {
  for (const childId of childIds) {
    const snap = snapshot.get(childId)
    if (!snap) continue
    // History copies can be shared by many entries; the restored graph must own its arrays/buffers.
    const { parentId: _snapParentId, childIds: snapChildIds, ...rest } = structuredClone(snap)
    graph.createNode(snap.type, parentId, { ...rest, childIds: [] })
    graph.reorderChild(snap.id, parentId, childIds.indexOf(childId))
    restoreChildren(graph, snapshot, snap.id, snapChildIds)
  }
}
