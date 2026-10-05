import type { CanvasKit, Paragraph, TypefaceFontProvider } from 'canvaskit-wasm'

import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import type { SceneNode } from '@open-pencil/scene-graph'

import { textVerticalOffset } from '#core/canvas/scene'
import { buildParagraph } from '#core/canvas/text'
import { fontManager } from '#core/text/fonts'

export interface ClipboardShapedGlyph {
  glyphId: number
  glyphIndex: number
  firstCharacter: number
  x: number
  y: number
  advance: number
}

export interface ClipboardShapedText {
  lineHeight: number
  lineAscent: number
  lineWidth: number
  baseline: number
  baselines?: NonNullable<NodeChange['derivedTextData']>['baselines']
  glyphs: ClipboardShapedGlyph[]
  logicalIndexToCharacterOffsetMap: number[]
}

function addShapedRunGlyphs(
  run: ReturnType<Paragraph['getShapedLines']>[number]['runs'][number],
  glyphs: ClipboardShapedGlyph[],
  logicalIndexToCharacterOffsetMap: number[],
  characterOffsets: number[],
  fallbackLineY: number,
  fallbackLineWidth: number
): void {
  const positions = run.positions
  for (let index = 0; index < run.glyphs.length; index++) {
    const x = positions[index * 2] ?? 0
    const y = positions[index * 2 + 1] ?? fallbackLineY
    const nextX = positions[(index + 1) * 2] ?? x
    const glyphCharacter = characterOffsets[run.offsets[index]]
    glyphs.push({
      glyphId: run.glyphs[index],
      glyphIndex: index,
      firstCharacter: glyphCharacter,
      x,
      y,
      advance: nextX - x
    })
    if (glyphCharacter >= 0 && glyphCharacter < logicalIndexToCharacterOffsetMap.length) {
      logicalIndexToCharacterOffsetMap[glyphCharacter] = x
    }
  }

  const finalOffset = characterOffsets[run.offsets[run.offsets.length - 1]]
  const finalX = positions[positions.length - 2] ?? fallbackLineWidth
  if (finalOffset >= 0 && finalOffset < logicalIndexToCharacterOffsetMap.length) {
    logicalIndexToCharacterOffsetMap[finalOffset] = finalX
  }
}

// Shaped run clusters are UTF-8 byte offsets; line metrics/Figma text use UTF-16 indices.
function utf8CharacterOffsets(text: string): number[] {
  const offsets: number[] = []
  let index = 0
  for (const character of text) {
    const code = character.charCodeAt(0)
    let bytes = character.length === 2 ? 4 : 3
    if (code < 0x80) bytes = 1
    else if (code < 0x800) bytes = 2
    for (let byte = 0; byte < bytes; byte++) offsets.push(index)
    index += character.length
  }
  offsets.push(text.length)
  return offsets
}

function shapedCharacterOffsets(
  text: string,
  lines: ReturnType<Paragraph['getShapedLines']>
): number[] {
  return lines.at(-1)?.textRange.last === text.length
    ? Array.from({ length: text.length + 1 }, (_, index) => index)
    : utf8CharacterOffsets(text)
}

function addLineBaseline(
  metrics: ReturnType<Paragraph['getLineMetrics']>[number],
  textLength: number,
  baselines: NonNullable<ClipboardShapedText['baselines']>
): void {
  if (metrics.startIndex >= textLength) return
  baselines.push({
    firstCharacter: metrics.startIndex,
    endCharacter: metrics.endIndex,
    position: { x: 0, y: metrics.baseline },
    width: metrics.width,
    lineY: metrics.startIndex === 0 ? 0 : metrics.baseline - Math.abs(metrics.ascent),
    lineHeight: metrics.height,
    lineAscent: Math.abs(metrics.ascent)
  })
}

function applyVerticalAlignment(
  node: SceneNode,
  paragraphHeight: number,
  glyphs: ClipboardShapedGlyph[],
  baselines: NonNullable<ClipboardShapedText['baselines']>,
  alignVertical: boolean
): number {
  const offsetY = alignVertical ? textVerticalOffset(node, paragraphHeight) : 0
  if (offsetY !== 0) {
    for (const glyph of glyphs) glyph.y += offsetY
    for (const baseline of baselines) {
      baseline.position.y += offsetY
      if (baseline.lineY !== undefined) baseline.lineY += offsetY
    }
  }
  return offsetY
}

export async function shapeTextForClipboard(
  node: SceneNode,
  {
    halfLeading = false,
    alignVertical = false,
    fontProvider = fontManager.provider(),
    canvasKit = fontManager.providerCanvasKit()
  }: {
    halfLeading?: boolean
    alignVertical?: boolean
    fontProvider?: TypefaceFontProvider | null
    canvasKit?: CanvasKit | null
  } = {}
): Promise<ClipboardShapedText | null> {
  const ck = canvasKit
  if (!ck || !fontProvider) return null

  const paragraph = buildParagraph({ ck, fontProvider, fontsLoaded: true }, node, undefined, {
    halfLeading
  })
  try {
    paragraph.layout(node.textAutoResize === 'WIDTH_AND_HEIGHT' ? 1e6 : node.width)
    const shapedLines = paragraph.getShapedLines()
    const lineMetrics = paragraph.getLineMetrics()
    if (shapedLines.length === 0 || lineMetrics.length === 0) {
      return null
    }
    const firstMetrics = lineMetrics[0]

    const glyphs: ClipboardShapedGlyph[] = []
    const baselines: NonNullable<ClipboardShapedText['baselines']> = []
    const characterOffsets = shapedCharacterOffsets(node.text, shapedLines)
    const logicalIndexToCharacterOffsetMap = Array.from(
      { length: node.text.length + 1 },
      () => Number.NaN
    )
    logicalIndexToCharacterOffsetMap[0] = 0

    for (let lineIndex = 0; lineIndex < shapedLines.length; lineIndex++) {
      const line = shapedLines[lineIndex]
      const metrics = lineMetrics[lineIndex] ?? firstMetrics
      for (const run of line.runs) {
        addShapedRunGlyphs(
          run,
          glyphs,
          logicalIndexToCharacterOffsetMap,
          characterOffsets,
          metrics.baseline,
          metrics.width
        )
      }
      addLineBaseline(metrics, node.text.length, baselines)
    }

    for (let index = 1; index < logicalIndexToCharacterOffsetMap.length; index++) {
      if (Number.isNaN(logicalIndexToCharacterOffsetMap[index])) {
        logicalIndexToCharacterOffsetMap[index] = logicalIndexToCharacterOffsetMap[index - 1]
      }
    }

    const offsetY = applyVerticalAlignment(
      node,
      paragraph.getHeight(),
      glyphs,
      baselines,
      alignVertical
    )

    return {
      lineHeight: firstMetrics.height,
      lineAscent: Math.abs(firstMetrics.ascent),
      lineWidth: firstMetrics.width,
      baseline: firstMetrics.baseline + offsetY,
      baselines,
      glyphs,
      logicalIndexToCharacterOffsetMap
    }
  } finally {
    paragraph.delete()
  }
}
