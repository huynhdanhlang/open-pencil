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

  let layoutPages = new Set([page.id])
  const errors: unknown[] = []
  try {
    layoutPages = restorePageCheckpoint(ctx.graph, snapshot)
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
