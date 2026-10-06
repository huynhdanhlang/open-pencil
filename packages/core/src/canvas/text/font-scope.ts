import type { CanvasKit, TypefaceFontProvider } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import { DEFAULT_FONT_FAMILY } from '#core/constants'
import { transformTextCase } from '#core/text/case'
import { fontManager, weightToStyle } from '#core/text/fonts'
import { glyphOutlineSourceSync } from '#core/text/opentype'

import { resolveParagraphFontFamilies } from './font-families'
import type { ParagraphNode } from './paragraph-inputs'
import type { TextPreparationCache } from './preparation-cache'

/** Current face buffers shared by authored paragraphs, saved replay and export shaping. */
export function createParagraphFontScope(canvasKit: CanvasKit, nodes: Iterable<SceneNode>) {
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
      for (const fallback of resolveParagraphFontFamilies(family, weightToStyle(weight, italic))) {
        if (fallback !== family) registerFace(fallback, 400, false)
      }
    }
    const registerParagraph = (node: ParagraphNode) => {
      const family = node.fontFamily || DEFAULT_FONT_FAMILY
      registerStyle(family, node.fontWeight, node.italic)
      for (const run of node.styleRuns) {
        registerStyle(
          run.style.fontFamily ?? family,
          run.style.fontWeight ?? node.fontWeight,
          run.style.italic ?? node.italic
        )
      }
    }
    const registerNode = (node: SceneNode) => {
      if (node.type === 'TEXT') registerParagraph(node)
    }
    for (const node of nodes) registerNode(node)
    return { provider, fontData, registerNode, registerParagraph, dispose: () => provider.delete() }
  } catch (error) {
    provider.delete()
    throw error
  }
}

export type ParagraphFontScope = ReturnType<typeof createParagraphFontScope>

/** Supplemental-only, variable or unavailable faces retain the existing renderer route. */
function hasCurrentFaceCoverage(node: ParagraphNode): boolean {
  const covers = (text: string, family: string, weight: number, italic: boolean) => {
    const characters = transformTextCase(text, node.textCase).replace(/\s/g, '')
    if (!characters) return true
    return (
      glyphOutlineSourceSync(family, weightToStyle(weight, italic))?.covers(characters) ?? false
    )
  }
  const baseCovers = (text: string) =>
    covers(text, node.fontFamily || DEFAULT_FONT_FAMILY, node.fontWeight, node.italic)
  let pos = 0
  for (const run of node.styleRuns) {
    if (pos < run.start && !baseCovers(node.text.slice(pos, run.start))) return false
    if (
      !covers(
        node.text.slice(run.start, run.start + run.length),
        run.style.fontFamily ?? (node.fontFamily || DEFAULT_FONT_FAMILY),
        run.style.fontWeight ?? node.fontWeight,
        run.style.italic ?? node.italic
      )
    )
      return false
    pos = run.start + run.length
  }
  return pos >= node.text.length || baseCovers(node.text.slice(pos))
}

export function paragraphFontProvider(
  r: {
    ck: CanvasKit
    fontProvider: TypefaceFontProvider | null
    textPreparationCache?: TextPreparationCache
  },
  node: ParagraphNode
): TypefaceFontProvider {
  if (!r.fontProvider) throw new Error('Font provider not initialized')
  const cache = r.textPreparationCache
  if (!cache || !hasCurrentFaceCoverage(node)) return r.fontProvider
  // Synchronize against the original provider before borrowing a scope that clear() may dispose.
  cache.synchronizeScope(fontManager.generation(), r.fontProvider)
  const scope = cache.shapeRuntime(() => createParagraphFontScope(r.ck, []))
  scope.registerParagraph(node)
  return scope.provider
}
