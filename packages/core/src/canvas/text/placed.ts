import type { Paragraph } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import type { TextLayout, TextLayoutMarker } from '#core/canvas/text/layout'
import { utf16IndicesByUtf8 } from '#core/canvas/text/utf8'
import { weightToStyle } from '#core/text/fonts'
import { glyphOutlineSourceSync, type GlyphOutlineSource } from '#core/text/opentype'

type GlyphRun = ReturnType<Paragraph['getShapedLines']>[number]['runs'][number]

/** A glyph of laid-out text where the renderer draws it, with the font its outline comes from. */
export interface LaidOutGlyph {
  /** The glyph ID the shaper chose. */
  id: number
  x: number
  /** The baseline of its line. */
  y: number
  fontSize: number
  /** The character it draws, left out for a list marker. */
  firstCharacter?: number
  advance: number
  /** Where its line starts. */
  lineLeft: number
  /** The font that drew it, or `null` when the shaper may have used another. */
  source: GlyphOutlineSource | null
}

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
  characterAt: (offset: number) => number
): GlyphOutlineSource | null {
  if (run.fakeBold || run.fakeItalic || run.glyphs.length === 0) return null
  const offsets = Array.from(run.offsets, characterAt)
  const start = Math.min(...offsets)
  const end = Math.max(...offsets)
  const { family, style } = fontStyleAt(node, start)
  const source = glyphOutlineSourceSync(family, style)
  const characters = text.slice(start, end).replace(/\s/g, '')
  return source?.covers(characters) ? source : null
}

/**
 * A list marker's glyphs as Figma saves them: placed beside their item and drawing no
 * character of the text.
 */
function markerGlyphs(marker: TextLayoutMarker, offsetY: number): LaidOutGlyph[] {
  const source = glyphOutlineSourceSync(marker.face.family, marker.face.style)
  const baseline = marker.paragraph.getLineMetrics().at(0)?.baseline ?? 0
  const glyphs: LaidOutGlyph[] = []
  for (const line of marker.paragraph.getShapedLines()) {
    for (const run of line.runs) {
      const trusted = !run.fakeBold && !run.fakeItalic
      for (let index = 0; index < run.glyphs.length; index++) {
        const x = run.positions[index * 2]
        glyphs.push({
          id: run.glyphs[index],
          x: marker.x + x,
          y: marker.y + baseline + offsetY,
          fontSize: run.size,
          advance: run.positions[(index + 1) * 2] - x,
          lineLeft: marker.x,
          source: trusted ? source : null
        })
      }
    }
  }
  return glyphs
}

/**
 * Every glyph of laid-out `text`, `offsetY` below the layout's top, in drawing order: an item's
 * marker before the glyphs of its first line, as Figma saves them. Returns `null` when the
 * layout's lines do not match its shaped lines.
 */
export function laidOutGlyphs(
  node: SceneNode,
  layout: TextLayout,
  text: string,
  offsetY: number
): LaidOutGlyph[] | null {
  const lines = layout.getShapedLines()
  const metrics = layout.getLineMetrics()
  if (lines.length === 0 || lines.length !== metrics.length) return null
  const characterAt = utf16IndicesByUtf8(text)
  const markers = new Map(layout.getMarkers().map((marker) => [marker.lineNumber, marker]))
  const glyphs: LaidOutGlyph[] = []
  for (const [lineIndex, line] of lines.entries()) {
    const marker = markers.get(lineIndex)
    if (marker) glyphs.push(...markerGlyphs(marker, offsetY))
    const { left, baseline } = metrics[lineIndex]
    for (const run of line.runs) {
      const source = runOutlineSource(node, text, run, characterAt)
      for (let index = 0; index < run.glyphs.length; index++) {
        const x = run.positions[index * 2]
        glyphs.push({
          id: run.glyphs[index],
          x,
          // Run positions round the baseline to whole pixels; line metrics keep it exact.
          y: baseline + offsetY,
          fontSize: run.size,
          firstCharacter: characterAt(run.offsets[index]),
          advance: run.positions[(index + 1) * 2] - x,
          lineLeft: left,
          source
        })
      }
    }
  }
  return glyphs
}
