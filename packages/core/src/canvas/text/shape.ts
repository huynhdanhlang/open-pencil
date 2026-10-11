import type { CanvasKit, Paragraph, TypefaceFontProvider } from 'canvaskit-wasm'

import {
  EMPTY_EXPORT_RUNTIME,
  type FigNodeChangeExportRuntime,
  type PlacedTextGlyph,
  type ShapedText,
  type ShapedTextGlyph,
  type TextDecorationRecord
} from '@open-pencil/fig/node-change'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { buildParagraph, textVerticalOffset } from '#core/canvas/text'
import { textDecorationRects, type DecoratedGlyph } from '#core/canvas/text/decorations'
import { outlineInk, savedGlyphInk } from '#core/canvas/text/ink'
import type { TextLayout, TextLayoutMarker } from '#core/canvas/text/layout'
import { utf16IndicesByUtf8 } from '#core/canvas/text/utf8'
import { getCanvasKit } from '#core/canvaskit'
import { transformTextCase } from '#core/text/case'
import { fontManager, weightToStyle } from '#core/text/fonts'
import { glyphOutlineSourceSync, type GlyphOutlineSource } from '#core/text/opentype'

import { createParagraphFontScope } from './font-scope'

type GlyphRun = ReturnType<Paragraph['getShapedLines']>[number]['runs'][number]

function fontStyleAt(node: SceneNode, index: number): { family: string; style: string } {
  const run = node.styleRuns.find((item) => index >= item.start && index < item.start + item.length)
  return {
    family: run?.style.fontFamily ?? node.fontFamily,
    style: weightToStyle(run?.style.fontWeight ?? node.fontWeight, run?.style.italic ?? node.italic)
  }
}

/**
 * The font a run was shaped with. CanvasKit leaves `GlyphRun.typeface` null, so the run's
 * glyph IDs are trusted only when the style's own font covers every character of the run and
 * so the paragraph had no reason to fall back to another font.
 */
function runOutlineSource(
  node: SceneNode,
  text: string,
  run: GlyphRun,
  characterAt: (offset: number) => number,
  fontData?: ReadonlyMap<string, ArrayBuffer>
): GlyphOutlineSource | null {
  if (run.fakeBold || run.fakeItalic || run.glyphs.length === 0) return null
  const offsets = Array.from(run.offsets, characterAt)
  const start = Math.min(...offsets)
  const end = Math.max(...offsets)
  const { family, style } = fontStyleAt(node, start)
  const source = glyphOutlineSourceSync(family, style, fontData?.get(`${family}|${style}`))
  const characters = text.slice(start, end).replace(/\s/g, '')
  return source?.covers(characters) ? source : null
}

/**
 * Whether saved glyphs could stand for this text: truncation and case changes that alter its
 * length move glyphs off the characters they came from, and path text is placed along its path.
 */
function canShape(node: SceneNode, text: string): boolean {
  return (
    node.text.length > 0 &&
    node.textTruncation !== 'ENDING' &&
    text.length === node.text.length &&
    !node.textPathData
  )
}

function shapedRunGlyphs(
  run: GlyphRun,
  source: GlyphOutlineSource | null,
  line: { left: number; baseline: number },
  characterOffsets: Array<number | undefined>,
  characterAt: (offset: number) => number
): ShapedTextGlyph[] {
  const glyphs: ShapedTextGlyph[] = []
  for (let index = 0; index < run.glyphs.length; index++) {
    const commands = source?.outline(run.glyphs[index], run.size) ?? null
    const x = run.positions[index * 2]
    const nextX = run.positions[(index + 1) * 2]
    const firstCharacter = characterAt(run.offsets[index])
    glyphs.push({
      commands,
      x,
      // Run positions round the baseline to whole pixels; line metrics keep it exact.
      y: line.baseline,
      fontSize: run.size,
      firstCharacter,
      advance: nextX - x
    })
    characterOffsets[firstCharacter] ??= x - line.left
  }
  const end = characterAt(run.offsets[run.offsets.length - 1])
  if (end < characterOffsets.length) {
    characterOffsets[end] ??= run.positions[run.positions.length - 2] - line.left
  }
  return glyphs
}

/**
 * A list marker's glyphs as Figma saves them: placed beside their item and drawing no
 * character of the text.
 */
function markerGlyphs(
  marker: TextLayoutMarker,
  offsetY: number,
  fontData?: ReadonlyMap<string, ArrayBuffer>
): ShapedTextGlyph[] {
  const source = glyphOutlineSourceSync(
    marker.face.family,
    marker.face.style,
    fontData?.get(`${marker.face.family}|${marker.face.style}`)
  )
  const baseline = marker.paragraph.getLineMetrics().at(0)?.baseline ?? 0
  const glyphs: ShapedTextGlyph[] = []
  for (const line of marker.paragraph.getShapedLines()) {
    for (const run of line.runs) {
      const trusted = !run.fakeBold && !run.fakeItalic && source?.covers(marker.text)
      for (let index = 0; index < run.glyphs.length; index++) {
        const x = run.positions[index * 2]
        glyphs.push({
          commands: trusted ? (source?.outline(run.glyphs[index], run.size) ?? null) : null,
          x: marker.x + x,
          y: marker.y + baseline + offsetY,
          fontSize: run.size,
          advance: run.positions[(index + 1) * 2] - x
        })
      }
    }
  }
  return glyphs
}

/** Characters inside a glyph cluster or without a glyph take the offset of the one before. */
function completeCharacterOffsets(offsets: Array<number | undefined>): number[] {
  let previous = 0
  return offsets.map((offset) => {
    previous = offset ?? previous
    return previous
  })
}

/**
 * Lay a text node out as the renderer draws it and pair each shaped glyph with the outline of
 * the glyph ID CanvasKit chose, so ligatures and contextual forms keep their shapes. When a run's
 * font is missing, variable, or a fallback, no glyph gets an outline: the layout still stands,
 * and readers draw the text themselves.
 * Returns `null` for text saved glyphs cannot represent at all.
 */
export function shapeText(
  ck: CanvasKit,
  fontProvider: TypefaceFontProvider,
  node: SceneNode,
  {
    fontData
  }: {
    fontData?: ReadonlyMap<string, ArrayBuffer>
  } = {}
): ShapedText | null {
  const text = transformTextCase(node.text, node.textCase)
  if (!canShape(node, text)) return null

  const paragraph = buildParagraph({ ck, fontProvider, fontsLoaded: true }, node, undefined, {
    halfLeading: true
  })
  try {
    return shapeParagraph(node, paragraph, fontData)
  } finally {
    paragraph.delete()
  }
}

/** Outline the same paragraph that will be painted, using its provider's pinned face buffers. */
export function shapeParagraph(
  node: SceneNode,
  paragraph: TextLayout,
  fontData?: ReadonlyMap<string, ArrayBuffer>
): ShapedText | null {
  const text = transformTextCase(node.text, node.textCase)
  if (!canShape(node, text)) return null
  const lines = paragraph.getShapedLines()
  const metrics = paragraph.getLineMetrics()
  if (lines.length === 0 || lines.length !== metrics.length) return null

  const offsetY = textVerticalOffset(node, paragraph.getHeight())
  const glyphs: ShapedTextGlyph[] = []
  const characterAt = utf16IndicesByUtf8(text)
  const markers = new Map(paragraph.getMarkers().map((marker) => [marker.lineNumber, marker]))
  const characterOffsets: Array<number | undefined> = Array.from({
    length: text.length
  })
  for (const [lineIndex, line] of lines.entries()) {
    const marker = markers.get(lineIndex)
    if (marker) glyphs.push(...markerGlyphs(marker, offsetY, fontData))
    for (const run of line.runs) {
      glyphs.push(
        ...shapedRunGlyphs(
          run,
          runOutlineSource(node, text, run, characterAt, fontData),
          {
            left: metrics[lineIndex].left,
            baseline: metrics[lineIndex].baseline + offsetY
          },
          characterOffsets,
          characterAt
        )
      )
    }
  }
  // Outlines from some runs only would draw the text with characters missing.
  const outlined = glyphs.every((glyph) => glyph.commands)
  return {
    glyphs: outlined ? glyphs : glyphs.map((glyph) => ({ ...glyph, commands: null })),
    baselines: metrics.map((line) => ({
      firstCharacter: line.startIndex,
      endCharacter: Math.min(line.endIncludingNewline, text.length),
      position: { x: line.left, y: line.baseline + offsetY },
      width: line.width,
      lineY: line.baseline - line.ascent + offsetY,
      lineHeight: line.height,
      lineAscent: line.ascent
    })),
    logicalIndexToCharacterOffsetMap: completeCharacterOffsets(characterOffsets)
  }
}

function decoratedGlyph(glyph: PlacedTextGlyph): DecoratedGlyph {
  const { commandsBlob, commands } = glyph
  return {
    ...glyph,
    ink: (top, bottom) => {
      if (commandsBlob) return savedGlyphInk(commandsBlob, glyph, top, bottom)
      return commands ? outlineInk(commands, glyph.x, glyph.y, top, bottom) : null
    }
  }
}

function textDecorations(
  node: SceneNode,
  glyphs: readonly PlacedTextGlyph[]
): TextDecorationRecord[] {
  return textDecorationRects(node, glyphs.map(decoratedGlyph)).map(
    ({ firstCharacter, x, y, width, height }) => ({ firstCharacter, x, y, width, height })
  )
}

function needsShaping(nodes: Iterable<SceneNode>): boolean {
  for (const node of nodes) {
    if (node.type === 'TEXT' && node.text && !node.derivedTextGlyphs?.length) return true
  }
  return false
}

/**
 * Shape with a provider owned by this write and exact face buffers also used for outlines.
 * Renderer providers can retain older same-family shards with incompatible glyph IDs.
 */
export async function withFigExportRuntime<T>(
  graph: SceneGraph,
  ck: CanvasKit | undefined,
  write: (runtime: FigNodeChangeExportRuntime) => Promise<T>
): Promise<T> {
  return withFigExportRuntimeForNodes([...graph.nodes.values()], ck, write)
}

/** Includes newly populated worker-owned text before registering faithful font faces. */
export async function withFigExportRuntimeForNodes<T>(
  nodes: readonly SceneNode[],
  ck: CanvasKit | undefined,
  write: (runtime: FigNodeChangeExportRuntime) => Promise<T>
): Promise<T> {
  if (!needsShaping(nodes)) return write({ ...EMPTY_EXPORT_RUNTIME, textDecorations })
  const canvasKit = ck ?? fontManager.providerCanvasKit() ?? (await getCanvasKit())
  const runtime = createTextShapeRuntime(canvasKit, nodes)
  try {
    return await write(runtime)
  } finally {
    runtime.dispose()
  }
}

/** One clean font scope, shared by export and bounded saved-paragraph preparation. */
export function createTextShapeRuntime(canvasKit: CanvasKit, nodes: Iterable<SceneNode>) {
  const scope = createParagraphFontScope(canvasKit, nodes)
  return {
    ...scope,
    textDecorations,
    shapeText: (node: SceneNode) =>
      shapeText(canvasKit, scope.provider, node, { fontData: scope.fontData })
  }
}

export type TextShapeRuntime = ReturnType<typeof createTextShapeRuntime>
