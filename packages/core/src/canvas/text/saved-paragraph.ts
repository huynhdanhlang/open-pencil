import type { Canvas } from 'canvaskit-wasm'

import { encodePathCommandsBlob } from '@open-pencil/fig/node-change'
import type { SceneNode } from '@open-pencil/scene-graph'

import type { SkiaRenderer } from '#core/canvas/renderer'
import { fontManager, weightToStyle } from '#core/text/fonts'

import { buildParagraph, textVerticalOffset } from './index'
import { createTextShapeRuntime, shapeParagraph } from './shape'

const warnedNodes = new WeakSet<SceneNode>()

function matchesSavedGlyphs(node: SceneNode, shaped: ReturnType<typeof shapeParagraph>): boolean {
  const saved = node.derivedTextGlyphs
  if (!saved || !shaped || saved.length !== shaped.glyphs.length) return false
  const near = (a: number, b: number) => Math.abs(a - b) <= 0.0001
  return shaped.glyphs.every((glyph, index) => {
    const old = saved[index]
    if (
      !glyph.commands ||
      glyph.firstCharacter !== old.firstCharacter ||
      !near(glyph.x, old.x) ||
      !near(glyph.y, old.y) ||
      !near(glyph.fontSize, old.fontSize)
    )
      return false
    const blob = encodePathCommandsBlob(
      glyph.commands.length ? glyph.commands : [{ type: 'Z' }],
      glyph.fontSize
    )
    return (
      blob.length === old.commandsBlob.length &&
      blob.every((byte, i) => byte === old.commandsBlob[i])
    )
  })
}

/** Keep the imported outline route unless the exact paragraph proves identical saved geometry. */
export function drawMatchingSavedParagraph(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  if (
    !r.fontsLoaded ||
    !r.fontProvider ||
    !r.textPreparationCache ||
    !node.derivedTextGlyphs?.length ||
    node.styleRuns.length !== 0 ||
    node.textDecoration !== 'NONE' ||
    node.textPathData ||
    node.textTruncation === 'ENDING' ||
    node.fills.some(
      (fill) =>
        fill.visible && (fill.type !== 'SOLID' || (fill.blendMode && fill.blendMode !== 'NORMAL'))
    ) ||
    !fontManager.isStyleLoaded(node.fontFamily, weightToStyle(node.fontWeight, node.italic)) ||
    node.derivedTextGlyphs.some(
      (glyph) =>
        (glyph.rotation ?? 0) !== 0 || (glyph.scaleX ?? 1) !== 1 || (glyph.scaleY ?? 1) !== 1
    )
  )
    return false
  const color = r.fillPaint.getColor()
  try {
    return r.textPreparationCache.use(
      node,
      `saved-match:${color.join(',')}`,
      fontManager.generation(),
      r.fontProvider,
      () => {
        const runtime = r.textPreparationCache.shapeRuntime(() => createTextShapeRuntime(r.ck, []))
        runtime.registerNode(node)
        const paragraph = buildParagraph(
          { ck: r.ck, fontProvider: runtime.provider, fontsLoaded: true },
          node,
          color,
          { halfLeading: true }
        )
        try {
          return {
            paragraph,
            matchesSavedGlyphs: matchesSavedGlyphs(
              node,
              shapeParagraph(node, paragraph, runtime.fontData)
            )
          }
        } catch (error) {
          paragraph.delete()
          throw error
        }
      },
      ({ paragraph, matchesSavedGlyphs }) => {
        if (!matchesSavedGlyphs) return false
        warnedNodes.delete(node)
        canvas.drawParagraph(paragraph, 0, textVerticalOffset(node, paragraph.getHeight()))
        return true
      }
    )
  } catch (error) {
    if (!warnedNodes.has(node)) {
      warnedNodes.add(node)
      console.warn(`Keeping saved glyphs for "${node.name}": paragraph preparation failed`, error)
    }
    // Imported glyphs remain the faithful fallback if preparation cannot prove equivalence.
    return false
  }
}
