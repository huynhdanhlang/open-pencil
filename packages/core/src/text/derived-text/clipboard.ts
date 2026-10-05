import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext'

import {
  buildDerivedTextData,
  appendGlyphBlob,
  encodePathCommandsBlob,
  weightToFigmaStyle
} from '@open-pencil/fig/node-change'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import { normalizeFontFamily, weightToStyle } from '@open-pencil/scene-graph'
import type { SceneNode } from '@open-pencil/scene-graph'

import {
  type GlyphOutlineMetrics,
  getGlyphOutlineMetricsSync,
  getGlyphOutlineByIdSync
} from '#core/text/opentype'

function computeWordWrapBreaks(
  text: string,
  glyphMetrics: Array<Pick<GlyphOutlineMetrics, 'advance'>>,
  fallbackAdvance: number,
  maxWidth: number,
  fontSize: number,
  fontFamily: string
): number[] {
  try {
    const font = `${fontSize}px ${fontFamily}`
    const prepared = prepareWithSegments(text, font)
    const lineHeight = Math.ceil(fontSize * 1.2)
    const { lines } = layoutWithLines(prepared, maxWidth, lineHeight)
    const breaks: number[] = []
    let charOffset = 0
    for (const line of lines) {
      if (charOffset > 0) breaks.push(charOffset)
      charOffset += line.text.length
    }
    return breaks
  } catch {
    return computeFallbackBreaks(text, glyphMetrics, fallbackAdvance, maxWidth)
  }
}

function computeFallbackBreaks(
  text: string,
  glyphMetrics: Array<Pick<GlyphOutlineMetrics, 'advance'>>,
  fallbackAdvance: number,
  maxWidth: number
): number[] {
  const breaks: number[] = []
  let x = 0
  let lastBreak = 0
  let lastBreakX = 0

  for (let i = 0; i < glyphMetrics.length; i++) {
    const advance = glyphMetrics[i].advance || fallbackAdvance
    const ch = text[i]
    if (ch === ' ' || ch === '\t' || (ch === '-' && i + 1 < text.length)) {
      lastBreak = i + 1
      lastBreakX = x + advance
    }
    if (x > 0 && x + advance > maxWidth + 0.5) {
      const lineStart = breaks.length > 0 ? breaks[breaks.length - 1] : 0
      if (lastBreak > lineStart) {
        breaks.push(lastBreak)
        x -= lastBreakX
      } else {
        breaks.push(i)
        x = 0
      }
      lastBreak = breaks[breaks.length - 1]
      lastBreakX = 0
    }
    x += advance
  }
  return breaks
}

export interface ShapedClipboardText {
  lineHeight: number
  lineAscent: number
  lineWidth: number
  baseline: number
  baselines?: NonNullable<NodeChange['derivedTextData']>['baselines']
  glyphs: Array<{
    glyphId?: number
    firstCharacter: number
    x: number
    y: number
    advance: number
  }>
  logicalIndexToCharacterOffsetMap: number[]
}

type DerivedGlyphMetric = {
  advance: number
  commands: GlyphOutlineMetrics['commands']
  shapedGlyph?: ShapedClipboardText['glyphs'][number]
}

function buildShapedGlyphs(
  node: SceneNode,
  shaped: ShapedClipboardText,
  fontData?: ArrayBuffer
): DerivedGlyphMetric[] {
  return shaped.glyphs.map((shapedGlyph) => {
    if (shapedGlyph.glyphId === undefined)
      throw new Error(`Missing shaped glyph identity for ${node.id}`)
    const metric = getGlyphOutlineByIdSync(
      node.fontFamily,
      weightToStyle(node.fontWeight, node.italic),
      shapedGlyph.glyphId,
      node.fontSize,
      fontData
    )
    if (!metric)
      throw new Error(`Cannot extract shaped glyph ${shapedGlyph.glyphId} for ${node.id}`)
    return { commands: metric.commands, advance: shapedGlyph.advance, shapedGlyph }
  })
}

function selectTextGlyphs(
  node: SceneNode,
  glyphMetrics: GlyphOutlineMetrics[],
  fallbackAdvance: number,
  shaped: ShapedClipboardText | null | undefined,
  useShapedGlyphs: boolean,
  fontData?: ArrayBuffer
): DerivedGlyphMetric[] {
  return shaped && useShapedGlyphs
    ? buildShapedGlyphs(node, shaped, fontData)
    : buildTextGlyphs(node.text, glyphMetrics, fallbackAdvance, node.fontSize)
}

function shapedGlyphPlacement(
  glyph: DerivedGlyphMetric,
  index: number,
  shapedByChar: Map<number, ShapedClipboardText['glyphs'][number]>
): ShapedClipboardText['glyphs'][number] | undefined {
  return glyph.shapedGlyph ?? shapedByChar.get(index)
}

function buildTextGlyphs(
  text: string,
  glyphMetrics: GlyphOutlineMetrics[],
  fallbackAdvance: number,
  fontSize: number
): DerivedGlyphMetric[] {
  if (glyphMetrics.length > 0) {
    return glyphMetrics.map((glyph) => ({
      advance: glyph.advance || fallbackAdvance,
      commands: glyph.commands
    }))
  }
  return Array.from({ length: text.length }, () => ({
    advance: fallbackAdvance || fontSize * 0.6,
    commands: []
  }))
}

function computeLineBreaks(
  node: SceneNode,
  glyphMetrics: GlyphOutlineMetrics[],
  textGlyphs: DerivedGlyphMetric[],
  fallbackAdvance: number,
  shaped?: ShapedClipboardText | null
): number[] {
  if (shaped) return []
  if (glyphMetrics.length > 0) {
    return computeWordWrapBreaks(
      node.text,
      textGlyphs,
      fallbackAdvance,
      node.width,
      node.fontSize,
      node.fontFamily
    )
  }
  return computeFallbackBreaks(node.text, textGlyphs, fallbackAdvance, node.width)
}

function appendOutlineBlob(
  glyph: DerivedGlyphMetric,
  fontSize: number,
  blobs: Uint8Array[] | undefined,
  glyphBlobMap: Map<string, number>
): number | undefined {
  return blobs && glyph.commands.length > 0
    ? appendGlyphBlob(blobs, glyphBlobMap, encodePathCommandsBlob(glyph.commands, fontSize))
    : undefined
}

function computeFallbackAdvance(node: SceneNode): number {
  return node.text.length > 0 ? node.width / Math.max(node.text.length, 1) : 0
}

export async function buildDerivedTextDataV4(
  node: SceneNode,
  digestMap: Map<string, Uint8Array>,
  shaped?: ShapedClipboardText | null,
  blobs?: Uint8Array[],
  {
    useShapedGlyphs = false,
    fontData,
    glyphBlobMap = new Map<string, number>()
  }: {
    useShapedGlyphs?: boolean
    fontData?: ArrayBuffer
    glyphBlobMap?: Map<string, number>
  } = {}
): Promise<NodeChange['derivedTextData']> {
  const style = weightToStyle(node.fontWeight, node.italic)
  const normalizedFamily = normalizeFontFamily(node.fontFamily)
  const key = `${normalizedFamily}|${style}`
  const lineHeightFallback = node.lineHeight ?? Math.ceil(node.fontSize * 1.2)
  const glyphMetrics =
    getGlyphOutlineMetricsSync(node.fontFamily, style, node.text, node.fontSize) ?? []

  const fallbackAdvance = computeFallbackAdvance(node)
  const textGlyphs = selectTextGlyphs(
    node,
    glyphMetrics,
    fallbackAdvance,
    shaped,
    useShapedGlyphs,
    fontData
  )
  const lineAscent = Math.max(lineHeightFallback - node.fontSize * 0.2, 0)
  const lineBreaks = computeLineBreaks(node, glyphMetrics, textGlyphs, fallbackAdvance, shaped)
  const lineBreakSet = new Set(lineBreaks)

  const shapedByChar = new Map(shaped?.glyphs.map((glyph) => [glyph.firstCharacter, glyph]))

  const fallbackBaselines: NonNullable<NodeChange['derivedTextData']>['baselines'] = []
  const fallbackOffsets = Array.from({ length: node.text.length + 1 }, () => 0)
  let fallbackX = 0
  let fallbackY = lineHeightFallback
  let lineStart = 0

  const glyphs = textGlyphs.map((glyph, index) => {
    const shapedGlyph = shapedGlyphPlacement(glyph, index, shapedByChar)
    const fallbackGlyphAdvance = glyph.advance || fallbackAdvance
    if (!shapedGlyph && lineBreakSet.has(index)) {
      fallbackBaselines.push({
        firstCharacter: lineStart,
        endCharacter: index,
        position: { x: 0, y: fallbackY },
        width: fallbackX,
        lineHeight: lineHeightFallback,
        lineAscent
      })
      lineStart = index
      fallbackX = 0
      fallbackY += lineHeightFallback
    }
    const glyphX = fallbackX
    fallbackOffsets[index] = glyphX
    fallbackX += fallbackGlyphAdvance
    const commandsBlob = appendOutlineBlob(glyph, node.fontSize, blobs, glyphBlobMap)
    return {
      commandsBlob,
      position: {
        x: shapedGlyph?.x ?? glyphX,
        y: shapedGlyph?.y ?? shaped?.baseline ?? fallbackY
      },
      fontSize: node.fontSize,
      firstCharacter: shapedGlyph?.firstCharacter ?? index,
      advance: (shapedGlyph?.advance ?? fallbackGlyphAdvance) / node.fontSize,
      rotation: 0
    }
  })
  fallbackOffsets[node.text.length] = fallbackX
  if (node.text.length > 0) {
    fallbackBaselines.push({
      firstCharacter: lineStart,
      endCharacter: node.text.length,
      position: { x: 0, y: fallbackY },
      width: fallbackX,
      lineHeight: lineHeightFallback,
      lineAscent
    })
  }

  return buildDerivedTextData({
    node,
    glyphs,
    fontMetaData: [
      {
        key: {
          family: normalizedFamily,
          style: weightToFigmaStyle(node.fontWeight, node.italic),
          postscript: ''
        },
        fontLineHeight: 1.2,
        fontDigest: digestMap.get(key),
        fontStyle: node.italic ? 'ITALIC' : 'NORMAL',
        fontWeight: node.fontWeight
      }
    ],
    baseline: shaped?.baseline ?? lineHeightFallback,
    width: shaped?.lineWidth ?? node.width,
    lineHeight: shaped?.lineHeight ?? lineHeightFallback,
    lineAscent: shaped?.lineAscent ?? lineAscent,
    baselines: shaped ? shaped.baselines : fallbackBaselines,
    logicalIndexToCharacterOffsetMap: shaped?.logicalIndexToCharacterOffsetMap ?? fallbackOffsets
  })
}
