import type { Paragraph, TypefaceFontProvider } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import { ResourceCache } from '#core/cache/resource'
import type { missingGlyphOccurrences } from '#core/text/resolver'

// Bound both the number of native paragraphs and the text retained by them.
// Source UTF-16 units are a workload bound, not an estimate of native bytes.
const MAX_PREPARED_PARAGRAPHS = 1024
const MAX_PREPARED_TEXT_UNITS = 262_144

import type { ParagraphFontScope } from './font-scope'
import { PARAGRAPH_INPUT_KEYS } from './paragraph-inputs'

type PreparationInput = SceneNode[(typeof PARAGRAPH_INPUT_KEYS)[number]]

export interface PreparedText {
  paragraph: Paragraph
  missingGlyphs?: ReturnType<typeof missingGlyphOccurrences>
  matchesSavedGlyphs?: boolean
}

interface Entry extends PreparedText {
  nodeId: string
  inputs: PreparationInput[]
  units: number
  savedGlyphs: SceneNode['derivedTextGlyphs']
  verticalAlignment: SceneNode['textAlignVertical']
}

export class TextPreparationCache {
  private readonly entries: ResourceCache<string, Entry>
  private readonly nodeKeys = new Map<string, Set<string>>()
  // A successful coverage check contains no native resources. Keep that result
  // independently of paragraph LRU eviction, weakly owned by the source node.
  private glyphCoverage = new WeakMap<SceneNode, PreparationInput[]>()
  private readonly invalidatedCoverage = new Set<string>()
  private generation = -1
  private provider: TypefaceFontProvider | null = null
  private pinnedShapeRuntime: ParagraphFontScope | null = null

  constructor(
    private readonly maxEntries = MAX_PREPARED_PARAGRAPHS,
    private readonly maxTextUnits = MAX_PREPARED_TEXT_UNITS
  ) {
    this.entries = new ResourceCache({
      maxEntries,
      maxWeight: maxTextUnits,
      weight: (entry) => entry.units,
      dispose: (entry, key) => {
        const keys = this.nodeKeys.get(entry.nodeId)
        keys?.delete(key)
        if (keys?.size === 0) this.nodeKeys.delete(entry.nodeId)
        entry.paragraph.delete()
      }
    })
  }

  /** Borrowed paragraphs must not be retained, deleted or relaid out by drawing callers. */
  use<T>(
    node: SceneNode,
    variant: string,
    generation: number,
    provider: TypefaceFontProvider,
    build: () => Paragraph | PreparedText,
    consume: (prepared: PreparedText) => T
  ): T {
    this.synchronizeScope(generation, provider)
    if (node.text.length > this.maxTextUnits || this.maxEntries <= 0) {
      const built = build()
      const prepared = 'paragraph' in built ? built : { paragraph: built }
      try {
        return consume(prepared)
      } finally {
        prepared.paragraph.delete()
      }
    }
    const key = `${node.id}\0${variant}`
    let entry = this.entries.get(key)
    if (
      entry &&
      (!PARAGRAPH_INPUT_KEYS.every((prop, index) => entry?.inputs[index] === node[prop]) ||
        entry.savedGlyphs !== node.derivedTextGlyphs ||
        entry.verticalAlignment !== node.textAlignVertical)
    ) {
      this.deleteNode(node.id)
      entry = undefined
    }
    if (!entry) {
      const built = build()
      const prepared = 'paragraph' in built ? built : { paragraph: built }
      entry = {
        ...prepared,
        nodeId: node.id,
        inputs: PARAGRAPH_INPUT_KEYS.map((prop) => node[prop]),
        units: node.text.length,
        savedGlyphs: node.derivedTextGlyphs,
        verticalAlignment: node.textAlignVertical
      }
      this.entries.set(key, entry)
      const keys = this.nodeKeys.get(node.id) ?? new Set<string>()
      keys.add(key)
      this.nodeKeys.set(node.id, keys)
    }
    return consume(entry)
  }

  /** Expire paragraphs before their pinned provider when a renderer's font scope changes. */
  synchronizeScope(generation: number, provider: TypefaceFontProvider): void {
    if (this.generation === generation && this.provider === provider) return
    this.clear()
    this.generation = generation
    this.provider = provider
  }

  /** One pinned provider per font scope, not one font-data copy per cached text node. */
  shapeRuntime(create: () => ParagraphFontScope): ParagraphFontScope {
    return (this.pinnedShapeRuntime ??= create())
  }

  hasGlyphCoverage(node: SceneNode, generation: number, provider: TypefaceFontProvider): boolean {
    if (this.generation !== generation || this.provider !== provider) return false
    if (this.invalidatedCoverage.delete(node.id)) {
      this.glyphCoverage.delete(node)
      return false
    }
    const inputs = this.glyphCoverage.get(node)
    if (!inputs) return false
    if (PARAGRAPH_INPUT_KEYS.every((prop, index) => inputs[index] === node[prop])) return true
    this.glyphCoverage.delete(node)
    return false
  }

  /** Call only after observing complete coverage with this cache's current font scope. */
  recordGlyphCoverage(node: SceneNode): void {
    this.invalidatedCoverage.delete(node.id)
    this.glyphCoverage.set(
      node,
      PARAGRAPH_INPUT_KEYS.map((prop) => node[prop])
    )
  }

  deleteNode(id: string): void {
    // Invalidation arrives by ID; don't add strong node ownership just to find
    // weak observations. Bound pending IDs and conservatively reset on overflow.
    this.invalidatedCoverage.add(id)
    if (this.invalidatedCoverage.size > this.maxEntries) {
      this.glyphCoverage = new WeakMap()
      this.invalidatedCoverage.clear()
    }
    const keys = this.nodeKeys.get(id)
    if (keys) for (const key of keys) this.entries.delete(key)
  }

  clear(): void {
    this.nodeKeys.clear()
    this.glyphCoverage = new WeakMap()
    this.invalidatedCoverage.clear()
    this.entries.clear()
    this.pinnedShapeRuntime?.dispose()
    this.pinnedShapeRuntime = null
  }
}
