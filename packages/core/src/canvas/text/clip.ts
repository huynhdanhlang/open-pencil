import type { Canvas, CanvasKit } from 'canvaskit-wasm'

import { hasTextList, type SceneNode } from '@open-pencil/scene-graph'

export interface TextClipRects {
  body: Float32Array
  marker: Float32Array
}

export function hasHangingListBox(node: SceneNode): boolean {
  return (
    node.hangingList &&
    hasTextList(node) &&
    !node.textPathData &&
    (node.textAutoResize === 'NONE' || node.textAutoResize === 'TRUNCATE')
  )
}

/** Markers keep the ancestor/surface clip horizontally and the text box vertically. */
export function hangingListClipRects(
  ck: CanvasKit,
  canvas: Canvas,
  node: SceneNode
): TextClipRects | undefined {
  if (!hasHangingListBox(node)) return undefined
  const body = ck.LTRBRect(0, 0, node.width, node.height)
  const inverse = ck.Matrix.invert(canvas.getTotalMatrix())
  // A singular transform cannot produce visible marker ink.
  if (!inverse) return { body, marker: body }
  const [left, top, right, bottom] = canvas.getDeviceClipBounds()
  const corners = ck.Matrix.mapPoints(inverse, [left, top, right, top, right, bottom, left, bottom])
  return {
    body,
    marker: ck.LTRBRect(
      Math.min(corners[0], corners[2], corners[4], corners[6]),
      0,
      Math.max(corners[0], corners[2], corners[4], corners[6]),
      node.height
    )
  }
}
