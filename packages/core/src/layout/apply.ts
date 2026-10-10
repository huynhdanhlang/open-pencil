import type { Node as YogaNode } from 'yoga-layout'

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import { layoutConstrainedChildRect } from '@open-pencil/scene-graph/resize'
import { markSourceFieldsEdited } from '@open-pencil/scene-graph/source-metadata'

import { keepsSavedLayout, usesDetachedDerivedLayout } from './derived'

type LayoutGeometry = Partial<Pick<SceneNode, 'x' | 'y' | 'width' | 'height'>>

export type ComputeLayoutFn = (graph: SceneGraph, frameId: string) => void

function preservesImportedHugCrossSize(
  graph: SceneGraph,
  frame: SceneNode,
  axis: 'width' | 'height'
): boolean {
  if (frame.source.format !== 'fig' || frame.counterAxisSizing !== 'HUG') return false
  const expectedMode = axis === 'width' ? 'VERTICAL' : 'HORIZONTAL'
  if (frame.layoutMode !== expectedMode) return false
  return graph
    .getChildren(frame.id)
    .some(
      (child) => child.layoutAlignSelf === 'STRETCH' && child.derivedLayout?.[axis] !== undefined
    )
}

/** The dimension layout application retains must also constrain Yoga's child placement. */
export function retainedFrameLayoutSize(
  graph: SceneGraph,
  frame: SceneNode,
  axis: 'width' | 'height',
  keepsSaved = keepsSavedLayout(graph, frame)
): number | undefined {
  const parent = frame.parentId ? graph.getNode(frame.parentId) : undefined
  // Detached Hug containers must keep the other axis assigned by their parent.
  // A saved intrinsic cache is not a constraint for that Fill/stretch dimension.
  if (usesGeneratedParentSize(graph, frame, parent, axis)) return frame[axis]
  const primary = (frame.layoutMode === 'HORIZONTAL') === (axis === 'width')
  const sizing = primary ? frame.primaryAxisSizing : frame.counterAxisSizing
  if (sizing === 'FIXED') return frame[axis]
  if (sizing !== 'HUG') return undefined
  if (!keepsSaved) return undefined
  if (!primary && preservesImportedHugCrossSize(graph, frame, axis)) return frame[axis]
  return frame.derivedLayout?.[axis]
}

/**
 * Writes only the geometry layout changed. Laying out a large page leaves most layers where they
 * were, and each write would notify every graph listener for nothing. A frame it resizes from
 * `before`, by default the size it has, places the layers its constraints govern; `constrained`
 * marks a write those constraints made, which places its own children in turn.
 */
function writeLayoutGeometry(
  graph: SceneGraph,
  id: string,
  geometry: LayoutGeometry,
  computeLayout: ComputeLayoutFn,
  before?: { width: number; height: number },
  constrained = false
): void {
  const node = graph.getNode(id)
  if (!node) return
  const from = before ?? { width: node.width, height: node.height }
  const changes: LayoutGeometry = {}
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    const value = geometry[key]
    if (value !== undefined && value !== node[key]) changes[key] = value
  }
  if (Object.keys(changes).length > 0) {
    graph.updateNode(id, changes)
    // Authored layout/constraints change the saved box, while cold import remains a projection.
    if (!graph.isApplyingDerivedLayout && node.source.format === 'fig')
      markSourceFieldsEdited(node, Object.keys(changes))
  }
  if (!CONSTRAINT_PARENT_TYPES.has(node.type)) return
  // Laying out what a file holds, as a page opens or its fonts arrive, resizes a frame only where
  // our layout differs from the one the file saved; its children keep the places it saved.
  if (graph.isApplyingDerivedLayout && !constrained) return
  if (from.width !== node.width || from.height !== node.height) {
    constrainChildren(graph, node, from, computeLayout)
  }
}

/**
 * The size each Hug frame had after layout last ran on it. Keyed by the node, so a deleted
 * frame's entry goes with it and a restored one starts afresh.
 */
const huggedSizes = new WeakMap<SceneNode, { width: number; height: number }>()

/** History restores a frame and its children together; no old constraint delta remains. */
export function resetHugLayoutSize(node: SceneNode): void {
  huggedSizes.delete(node)
}

const CONSTRAINT_PARENT_TYPES: ReadonlySet<SceneNode['type']> = new Set([
  'FRAME',
  'COMPONENT',
  'COMPONENT_SET',
  'INSTANCE'
])

/**
 * Places the children of a frame layout resized by their constraints: every child of a frame
 * without auto layout, and those that ignore an auto layout, as Figma keeps a badge pinned to the
 * right of a Hug button while its label grows. A child it resizes places its own children, and
 * lays out again when it has auto layout.
 */
function constrainChildren(
  graph: SceneGraph,
  frame: SceneNode,
  before: { width: number; height: number },
  computeLayout: ComputeLayoutFn
): void {
  for (const child of graph.getChildren(frame.id)) {
    if (frame.layoutMode !== 'NONE' && child.layoutPositioning !== 'ABSOLUTE') continue
    const size = { width: child.width, height: child.height }
    writeLayoutGeometry(
      graph,
      child.id,
      layoutConstrainedChildRect(
        child,
        before,
        frame,
        child.horizontalConstraint,
        child.verticalConstraint
      ),
      computeLayout,
      undefined,
      true
    )
    const resized = child.width !== size.width || child.height !== size.height
    if (resized && child.layoutMode !== 'NONE') computeLayout(graph, child.id)
  }
}

/**
 * The size a frame's constrained children move from as it hugs, or null when it hugs no axis.
 * An editor that resizes a Hug frame places its children for the size it sets, which layout then
 * hugs back, as when a parent stretches it; its children move only from the size it last hugged
 * to. An axis it does not hug keeps the size it has.
 */
function hugStart(frame: SceneNode): { width: number; height: number } | null {
  const row = frame.layoutMode === 'HORIZONTAL'
  const hugsWidth = (row ? frame.primaryAxisSizing : frame.counterAxisSizing) === 'HUG'
  const hugsHeight = (row ? frame.counterAxisSizing : frame.primaryAxisSizing) === 'HUG'
  if (!hugsWidth && !hugsHeight) {
    huggedSizes.delete(frame)
    return null
  }
  const hugged = huggedSizes.get(frame)
  return {
    width: hugsWidth && hugged ? hugged.width : frame.width,
    height: hugsHeight && hugged ? hugged.height : frame.height
  }
}

function applyFrameSize(
  graph: SceneGraph,
  frame: SceneNode,
  yogaNode: YogaNode,
  keepsSaved: boolean,
  computeLayout: ComputeLayoutFn
): void {
  if (frame.layoutMode === 'GRID') {
    if (frame.gridTemplateRows.length === 0) {
      writeLayoutGeometry(graph, frame.id, { height: yogaNode.getComputedHeight() }, computeLayout)
    }
    return
  }

  const before = hugStart(frame)
  if (!before) return

  const updates: LayoutGeometry = {}
  const primary = frame.layoutMode === 'HORIZONTAL' ? 'width' : 'height'
  const counter = primary === 'width' ? 'height' : 'width'
  const computed = (axis: 'width' | 'height') =>
    axis === 'width' ? yogaNode.getComputedWidth() : yogaNode.getComputedHeight()
  if (frame.primaryAxisSizing === 'HUG')
    updates[primary] =
      retainedFrameLayoutSize(graph, frame, primary, keepsSaved) ?? computed(primary)
  if (frame.counterAxisSizing === 'HUG') {
    updates[counter] =
      retainedFrameLayoutSize(graph, frame, counter, keepsSaved) ?? computed(counter)
  }

  writeLayoutGeometry(graph, frame.id, updates, computeLayout, before)
  huggedSizes.set(frame, { width: frame.width, height: frame.height })
}

function computedChildPosition(
  child: SceneNode,
  yogaChild: YogaNode,
  axis: 'x' | 'y',
  preservesImportedGeometry: boolean,
  keepsSaved: boolean
): number {
  if (preservesImportedGeometry) return child[axis]
  const computed = axis === 'x' ? yogaChild.getComputedLeft() : yogaChild.getComputedTop()
  if (child.type === 'INSTANCE' || !keepsSaved) return computed
  return child.derivedLayout?.[axis] ?? computed
}

function preservesStaleImportedTextSize(child: SceneNode, axis: 'width' | 'height'): boolean {
  const derivedSize = child.derivedLayout?.[axis]
  return (
    child.type === 'TEXT' &&
    child.source.format === 'fig' &&
    derivedSize !== undefined &&
    Math.abs(child[axis] - derivedSize) > 0.001
  )
}

export function usesGeneratedParentSize(
  graph: SceneGraph,
  child: SceneNode,
  parent: SceneNode | undefined,
  axis: 'width' | 'height'
): boolean {
  if (
    child.source.format === 'fig' ||
    child.layoutPositioning === 'ABSOLUTE' ||
    !parent ||
    (parent.layoutMode !== 'HORIZONTAL' && parent.layoutMode !== 'VERTICAL')
  )
    return false
  const primary = (axis === 'width') === (parent.layoutMode === 'HORIZONTAL')
  const stretches =
    child.layoutAlignSelf === 'STRETCH' ||
    (child.layoutAlignSelf === 'AUTO' && parent.counterAxisAlign === 'STRETCH')
  if (primary) return child.layoutGrow > 0
  if (!stretches) return false
  // Stretch cannot allocate an axis that the parent itself derives from content.
  if (parent.counterAxisSizing !== 'HUG' || parent.derivedLayout?.[axis] !== undefined) return true
  const outer = parent.parentId ? graph.getNode(parent.parentId) : undefined
  return usesGeneratedParentSize(graph, parent, outer, axis)
}

export function usesAuthoritativeGeneratedStretch(
  graph: SceneGraph,
  parent: SceneNode,
  child: SceneNode
): boolean {
  const crossAxis = parent.layoutMode === 'HORIZONTAL' ? 'height' : 'width'
  if (usesGeneratedParentSize(graph, child, parent, crossAxis)) return true
  if (
    child.layoutAlignSelf !== 'STRETCH' ||
    parent.source.format === 'fig' ||
    !parent.derivedLayout
  )
    return false
  const derivedCrossSize = parent.derivedLayout[crossAxis]
  return derivedCrossSize !== undefined && Math.abs(derivedCrossSize - parent[crossAxis]) < 0.001
}

export function needsIntrinsicHugCrossMinimum(graph: SceneGraph, parent: SceneNode): boolean {
  if (parent.counterAxisSizing !== 'HUG') return false
  const outer = parent.parentId ? graph.getNode(parent.parentId) : undefined
  const crossAxis = parent.layoutMode === 'HORIZONTAL' ? 'height' : 'width'
  return !usesGeneratedParentSize(graph, parent, outer, crossAxis)
}

function computedChildSize(
  graph: SceneGraph,
  child: SceneNode,
  yogaChild: YogaNode,
  axis: 'width' | 'height',
  preservesImportedFrameGeometry: boolean,
  parent: SceneNode,
  keepsSaved: boolean
): number {
  if (
    preservesImportedFrameGeometry ||
    (keepsSaved && preservesStaleImportedTextSize(child, axis))
  ) {
    return child[axis]
  }
  const computed = axis === 'width' ? yogaChild.getComputedWidth() : yogaChild.getComputedHeight()
  if (child.type === 'TEXT' && child.source.format === 'fig') {
    return computed > 0 ? computed : child[axis]
  }
  // Saved generated containers and leaves can both retain intrinsic geometry.
  if (usesGeneratedParentSize(graph, child, parent, axis)) return computed
  if (!keepsSaved) return computed
  return child.derivedLayout?.[axis] ?? computed
}

function updateChildFromYoga(
  graph: SceneGraph,
  frame: SceneNode,
  child: SceneNode,
  yogaChild: YogaNode,
  keepsSaved: boolean,
  computeLayout: ComputeLayoutFn,
  reflowImportedPositions: boolean
): void {
  if (!child.visible || child.layoutPositioning === 'ABSOLUTE') return

  const savedFig = (keepsSaved || reflowImportedPositions) && child.source.format === 'fig'
  const preservesImportedFrameGeometry =
    savedFig && frame.source.format === 'fig' && (child.type === 'FRAME' || child.type === 'LINE')
  const reflowImportedPosition =
    reflowImportedPositions && preservesImportedFrameGeometry && Math.abs(child.rotation) <= 0.001
  const preservesImportedPosition =
    (preservesImportedFrameGeometry && !reflowImportedPosition) ||
    (savedFig && Math.abs(child.rotation) > 0.001)
  // Insertion changes stored FIG positions, not just a transient layout projection.
  // Record only moved axes so Save cannot restore the original source coordinates.
  const authoredAxes = reflowImportedPosition
    ? (['x', 'y'] as const).filter(
        (axis) =>
          child[axis] !== (axis === 'x' ? yogaChild.getComputedLeft() : yogaChild.getComputedTop())
      )
    : []
  writeLayoutGeometry(
    graph,
    child.id,
    {
      x: reflowImportedPosition
        ? yogaChild.getComputedLeft()
        : computedChildPosition(child, yogaChild, 'x', preservesImportedPosition, keepsSaved),
      y: reflowImportedPosition
        ? yogaChild.getComputedTop()
        : computedChildPosition(child, yogaChild, 'y', preservesImportedPosition, keepsSaved),
      width: computedChildSize(
        graph,
        child,
        yogaChild,
        'width',
        preservesImportedFrameGeometry,
        frame,
        keepsSaved
      ),
      height: computedChildSize(
        graph,
        child,
        yogaChild,
        'height',
        preservesImportedFrameGeometry,
        frame,
        keepsSaved
      )
    },
    computeLayout
  )
  if (authoredAxes.length) markSourceFieldsEdited(child, authoredAxes)
}

function preservesImportedInstanceInternals(child: SceneNode): boolean {
  return child.type === 'INSTANCE' && child.source.format === 'fig'
}

function recomputeGridChild(
  graph: SceneGraph,
  child: SceneNode,
  computeLayout: ComputeLayoutFn
): void {
  const updated = graph.getNode(child.id)
  if (!updated || updated.layoutMode === 'NONE') return

  const savedPrimary = updated.primaryAxisSizing
  const savedCounter = updated.counterAxisSizing
  const updates: Partial<SceneNode> = {}

  if (savedPrimary === 'HUG') updates.primaryAxisSizing = 'FIXED'
  if (savedCounter === 'HUG') updates.counterAxisSizing = 'FIXED'
  if (Object.keys(updates).length > 0) graph.updateNode(child.id, updates)

  computeLayout(graph, child.id)

  const restore: Partial<SceneNode> = {}
  if (updates.primaryAxisSizing) restore.primaryAxisSizing = savedPrimary
  if (updates.counterAxisSizing) restore.counterAxisSizing = savedCounter
  if (Object.keys(restore).length > 0) graph.updateNode(child.id, restore)
}

export function applyYogaLayout(
  graph: SceneGraph,
  frame: SceneNode,
  yogaNode: YogaNode,
  computeLayout: ComputeLayoutFn,
  reflowImportedPositions = false
): void {
  const keepsSaved = keepsSavedLayout(graph, frame)
  applyFrameSize(graph, frame, yogaNode, keepsSaved, computeLayout)

  const children = graph.getChildren(frame.id)
  let yogaIndex = 0
  for (const child of children) {
    if (yogaIndex >= yogaNode.getChildCount()) continue
    const yogaChild = yogaNode.getChild(yogaIndex)
    yogaIndex++

    updateChildFromYoga(
      graph,
      frame,
      child,
      yogaChild,
      keepsSaved,
      computeLayout,
      reflowImportedPositions
    )

    if (!child.visible) continue
    if (preservesImportedInstanceInternals(child)) continue

    if (usesDetachedDerivedLayout(graph, child)) {
      computeLayout(graph, child.id)
      continue
    }

    if (child.layoutMode !== 'NONE') {
      if (child.layoutMode === 'GRID' && child.layoutPositioning !== 'ABSOLUTE') {
        computeLayout(graph, child.id)
      } else if (frame.layoutMode === 'GRID' && child.layoutPositioning !== 'ABSOLUTE') {
        recomputeGridChild(graph, child, computeLayout)
      } else {
        applyYogaLayout(graph, child, yogaChild, computeLayout)
      }
    }
  }
}
