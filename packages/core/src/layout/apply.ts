import type { Node as YogaNode } from 'yoga-layout'

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { usesDetachedDerivedLayout } from './derived'

export type ComputeLayoutFn = (graph: SceneGraph, frameId: string) => void

/** Equal computed values must not invalidate pictures, text geometry and instance sync. */
function updateComputedGeometry(
  graph: SceneGraph,
  node: SceneNode,
  computed: Partial<Pick<SceneNode, 'x' | 'y' | 'width' | 'height'>>
): void {
  const updates: Partial<SceneNode> = {}
  for (const field of ['x', 'y', 'width', 'height'] as const) {
    const value = computed[field]
    if (value !== undefined && value !== node[field]) updates[field] = value
  }
  if (Object.keys(updates).length > 0) graph.updateNode(node.id, updates)
}

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
  axis: 'width' | 'height'
): number | undefined {
  const parent = frame.parentId ? graph.getNode(frame.parentId) : undefined
  // Detached Hug containers must keep the other axis assigned by their parent.
  // A saved intrinsic cache is not a constraint for that Fill/stretch dimension.
  if (usesGeneratedParentSize(frame, parent, axis)) return frame[axis]
  const primary = (frame.layoutMode === 'HORIZONTAL') === (axis === 'width')
  const sizing = primary ? frame.primaryAxisSizing : frame.counterAxisSizing
  if (sizing === 'FIXED') return frame[axis]
  if (sizing !== 'HUG') return undefined
  if (!primary && preservesImportedHugCrossSize(graph, frame, axis)) return frame[axis]
  return frame.derivedLayout?.[axis]
}

function applyFrameSize(graph: SceneGraph, frame: SceneNode, yogaNode: YogaNode): void {
  if (frame.layoutMode === 'GRID') {
    if (frame.gridTemplateRows.length === 0) {
      updateComputedGeometry(graph, frame, { height: yogaNode.getComputedHeight() })
    }
    return
  }

  if (frame.primaryAxisSizing !== 'HUG' && frame.counterAxisSizing !== 'HUG') return

  const computedW = yogaNode.getComputedWidth()
  const computedH = yogaNode.getComputedHeight()
  const updates: Partial<SceneNode> = {}

  if (frame.primaryAxisSizing === 'HUG') {
    if (frame.layoutMode === 'HORIZONTAL')
      updates.width = retainedFrameLayoutSize(graph, frame, 'width') ?? computedW
    else updates.height = retainedFrameLayoutSize(graph, frame, 'height') ?? computedH
  }
  if (frame.counterAxisSizing === 'HUG') {
    if (frame.layoutMode === 'HORIZONTAL') {
      updates.height = retainedFrameLayoutSize(graph, frame, 'height') ?? computedH
    } else {
      updates.width = retainedFrameLayoutSize(graph, frame, 'width') ?? computedW
    }
  }

  updateComputedGeometry(graph, frame, updates)
}

function frameSourceIsFig(graph: SceneGraph, parentId: string | null): boolean {
  return parentId ? graph.getNode(parentId)?.source.format === 'fig' : false
}

function computedChildPosition(
  child: SceneNode,
  yogaChild: YogaNode,
  axis: 'x' | 'y',
  preservesImportedGeometry: boolean
): number {
  if (preservesImportedGeometry) return child[axis]
  const computed = axis === 'x' ? yogaChild.getComputedLeft() : yogaChild.getComputedTop()
  if (child.type === 'INSTANCE') return computed
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
  return primary ? child.layoutGrow > 0 : stretches
}

function computedChildSize(
  child: SceneNode,
  yogaChild: YogaNode,
  axis: 'width' | 'height',
  preservesImportedFrameGeometry: boolean,
  parent: SceneNode | undefined
): number {
  if (preservesImportedFrameGeometry || preservesStaleImportedTextSize(child, axis)) {
    return child[axis]
  }
  const computed = axis === 'width' ? yogaChild.getComputedWidth() : yogaChild.getComputedHeight()
  if (child.type === 'TEXT' && child.source.format === 'fig') {
    return computed > 0 ? computed : child[axis]
  }
  // Saved generated containers and leaves can both retain intrinsic geometry.
  if (usesGeneratedParentSize(child, parent, axis)) return computed
  return child.derivedLayout?.[axis] ?? computed
}

function updateChildFromYoga(graph: SceneGraph, child: SceneNode, yogaChild: YogaNode): void {
  if (!child.visible || child.layoutPositioning === 'ABSOLUTE') return

  const preservesImportedFrameGeometry =
    child.source.format === 'fig' &&
    frameSourceIsFig(graph, child.parentId) &&
    (child.type === 'FRAME' || child.type === 'LINE')
  const preservesImportedPosition =
    preservesImportedFrameGeometry ||
    (child.source.format === 'fig' && Math.abs(child.rotation) > 0.001)
  const parent = child.parentId ? graph.getNode(child.parentId) : undefined
  updateComputedGeometry(graph, child, {
    x: computedChildPosition(child, yogaChild, 'x', preservesImportedPosition),
    y: computedChildPosition(child, yogaChild, 'y', preservesImportedPosition),
    width: computedChildSize(child, yogaChild, 'width', preservesImportedFrameGeometry, parent),
    height: computedChildSize(child, yogaChild, 'height', preservesImportedFrameGeometry, parent)
  })
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
  computeLayout: ComputeLayoutFn
): void {
  applyFrameSize(graph, frame, yogaNode)

  const children = graph.getChildren(frame.id)
  let yogaIndex = 0
  for (const child of children) {
    if (yogaIndex >= yogaNode.getChildCount()) continue
    const yogaChild = yogaNode.getChild(yogaIndex)
    yogaIndex++

    updateChildFromYoga(graph, child, yogaChild)

    if (!child.visible) continue
    if (preservesImportedInstanceInternals(child)) continue

    if (usesDetachedDerivedLayout(child)) {
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
