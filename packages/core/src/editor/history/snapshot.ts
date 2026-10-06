import { isEqual } from 'es-toolkit'

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import type { EditorContext } from '#core/editor/types'
import { computeAllLayouts } from '#core/layout'

export type PageSnapshot = Map<string, SceneNode>

// Keep one reusable copy per live page. Weak keys release deleted pages/closed documents.
const recentSnapshots = new WeakMap<SceneGraph, WeakMap<SceneNode, PageSnapshot>>()

export function snapshotPage(graph: SceneGraph, pageId: string): PageSnapshot {
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
  const walk = (id: string) => {
    const node = graph.getNode(id)
    if (!node) return
    const saved = previous?.get(id)
    snapshot.set(id, saved && isEqual(saved, node) ? saved : node)
    if (snapshot.get(id) === node) changed.push(node)
    for (const childId of node.childIds) walk(childId)
  }
  walk(pageId)
  // Imported nodes share glyph/geometry/source payloads. One clone preserves that sharing;
  // cloning each node separately amplifies every common buffer across the entire page.
  for (const node of structuredClone(changed)) snapshot.set(node.id, node)
  pages.set(page, snapshot)
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
  // One independently owned clone also preserves sharing when replaying history.
  restoreChildren(ctx.graph, structuredClone(snapshot), page.id, pageSnap.childIds)

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
    const { parentId: _snapParentId, childIds: snapChildIds, ...rest } = snap
    graph.createNode(snap.type, parentId, { ...rest, childIds: [] })
    graph.reorderChild(snap.id, parentId, childIds.indexOf(childId))
    restoreChildren(graph, snapshot, snap.id, snapChildIds)
  }
}
