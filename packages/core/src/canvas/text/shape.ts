import type { CanvasKit, Paragraph, TypefaceFontProvider } from 'canvaskit-wasm'

import {
  EMPTY_EXPORT_RUNTIME,
  type FigNodeChangeExportRuntime,
  type ShapedText,
  type ShapedTextGlyph
} from '@open-pencil/fig/node-change'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { buildParagraph, textVerticalOffset } from '#core/canvas/text'
import { resolveParagraphFontFamilies } from '#core/canvas/text/font-families'
import { getCanvasKit } from '#core/canvaskit'
import { transformTextCase } from '#core/text/case'
import { fontManager, weightToStyle } from '#core/text/fonts'
import { glyphOutlineSourceSync, type GlyphOutlineSource } from '#core/text/opentype'

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
  offsetsToCharacters: readonly number[],
  fontData?: ReadonlyMap<string, ArrayBuffer>
): GlyphOutlineSource | null {
  if (run.fakeBold || run.fakeItalic || run.glyphs.length === 0) return null
  const offsets = Array.from(run.offsets, (offset) => offsetsToCharacters[offset])
  const start = Math.min(...offsets)
  const end = Math.max(...offsets)
  const { family, style } = fontStyleAt(node, start)
  const source = glyphOutlineSourceSync(family, style, fontData?.get(`${family}|${style}`))
  const characters = text.slice(start, end).replace(/\s/g, '')
  return source?.covers(characters) ? source : null
}

function hasDecoration(node: SceneNode): boolean {
  return (
    node.textDecoration !== 'NONE' ||
    node.styleRuns.some((run) => run.style.textDecoration && run.style.textDecoration !== 'NONE')
  )
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
  offsetsToCharacters: readonly number[]
): ShapedTextGlyph[] {
  const glyphs: ShapedTextGlyph[] = []
  for (let index = 0; index < run.glyphs.length; index++) {
    const commands = source?.outline(run.glyphs[index], run.size) ?? null
    const x = run.positions[index * 2]
    const nextX = run.positions[(index + 1) * 2]
    const firstCharacter = offsetsToCharacters[run.offsets[index]]
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
  const end = offsetsToCharacters[run.offsets[run.offsets.length - 1]]
  if (end < characterOffsets.length) {
    characterOffsets[end] ??= run.positions[run.positions.length - 2] - line.left
  }
  return glyphs
}

/** CanvasKit builds can expose UTF-8 run offsets; FIG text and line metrics use UTF-16. */
function shapedCharacterOffsets(
  text: string,
  lines: ReturnType<Paragraph['getShapedLines']>
): number[] {
  if (lines.at(-1)?.textRange.last === text.length) {
    return Array.from({ length: text.length + 1 }, (_, index) => index)
  }
  const offsets: number[] = []
  let index = 0
  for (const character of text) {
    const code = character.charCodeAt(0)
    const bytes = code < 0x80 ? 1 : code < 0x800 ? 2 : character.length === 2 ? 4 : 3
    for (let byte = 0; byte < bytes; byte++) offsets.push(index)
    index += character.length
  }
  offsets.push(text.length)
  return offsets
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
 * font is missing, variable, or a fallback, or the glyphs could not draw the text's decorations,
 * no glyph gets an outline: the layout still stands, and readers draw the text themselves.
 * Returns `null` for text saved glyphs cannot represent at all.
 */
export function shapeText(
  ck: CanvasKit,
  fontProvider: TypefaceFontProvider,
  node: SceneNode,
  fontData?: ReadonlyMap<string, ArrayBuffer>
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
  paragraph: Paragraph,
  fontData?: ReadonlyMap<string, ArrayBuffer>
): ShapedText | null {
  const text = transformTextCase(node.text, node.textCase)
  if (!canShape(node, text)) return null
  const lines = paragraph.getShapedLines()
  const metrics = paragraph.getLineMetrics()
  if (lines.length === 0 || lines.length !== metrics.length) return null

  const offsetY = textVerticalOffset(node, paragraph.getHeight())
  const glyphs: ShapedTextGlyph[] = []
  const offsetsToCharacters = shapedCharacterOffsets(text, lines)
  const characterOffsets: Array<number | undefined> = Array.from({
    length: text.length
  })
  for (const [lineIndex, line] of lines.entries()) {
    for (const run of line.runs) {
      glyphs.push(
        ...shapedRunGlyphs(
          run,
          runOutlineSource(node, text, run, offsetsToCharacters, fontData),
          {
            left: metrics[lineIndex].left,
            baseline: metrics[lineIndex].baseline + offsetY
          },
          characterOffsets,
          offsetsToCharacters
        )
      )
    }
  }
  // Outlines from some runs only would draw the text with characters missing, and saved
  // glyphs draw decorations on one baseline.
  const outlined =
    glyphs.every((glyph) => glyph.commands) && !(lines.length > 1 && hasDecoration(node))
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

function needsShaping(graph: SceneGraph): boolean {
  for (const node of graph.nodes.values()) {
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
  if (!needsShaping(graph)) return write(EMPTY_EXPORT_RUNTIME)
  const canvasKit = ck ?? fontManager.providerCanvasKit() ?? (await getCanvasKit())
  const runtime = createTextShapeRuntime(canvasKit, graph.nodes.values())
  try {
    return await write(runtime)
  } finally {
    runtime.dispose()
  }
}

/** One clean font scope, shared by export and bounded saved-paragraph preparation. */
export function createTextShapeRuntime(canvasKit: CanvasKit, nodes: Iterable<SceneNode>) {
  const provider = canvasKit.TypefaceFontProvider.Make()
  const fontData = new Map<string, ArrayBuffer>()
  try {
    const registerFace = (family: string, weight: number, italic: boolean) => {
      const style = weightToStyle(weight, italic)
      const key = `${family}|${style}`
      if (fontData.has(key)) return
      const data = fontManager.loadedData(family, style)
      if (!data) return
      fontData.set(key, data)
      provider.registerFont(data, family)
    }
    const registerStyle = (family: string, weight: number, italic: boolean) => {
      registerFace(family, weight, italic)
      // Use the renderer's existing fallback stack, while missing requested-face outlines
      // remain unavailable rather than assigning fallback glyph IDs to that requested font.
      for (const fallback of resolveParagraphFontFamilies(family, weightToStyle(weight, italic))) {
        if (fallback !== family) registerFace(fallback, 400, false)
      }
    }
    const registerNode = (node: SceneNode) => {
      if (node.type !== 'TEXT') return
      registerStyle(node.fontFamily, node.fontWeight, node.italic)
      for (const run of node.styleRuns) {
        registerStyle(
          run.style.fontFamily ?? node.fontFamily,
          run.style.fontWeight ?? node.fontWeight,
          run.style.italic ?? node.italic
        )
      }
    }
    for (const node of nodes) registerNode(node)
    return {
      provider,
      fontData,
      registerNode,
      shapeText: (node: SceneNode) => shapeText(canvasKit, provider, node, fontData),
      dispose: () => provider.delete()
    }
  } catch (error) {
    provider.delete()
    throw error
  }
}

export type TextShapeRuntime = ReturnType<typeof createTextShapeRuntime>
