import type { CanvasKit } from 'canvaskit-wasm'
import { toUint8Array } from 'js-base64'

import { compressFigDataSync } from '@open-pencil/fig'
import {
  EMPTY_EXPORT_RUNTIME,
  placeSlotContent,
  type FigNodeChangeExportRuntime
} from '@open-pencil/fig/node-change'
import { initCodec } from '@open-pencil/kiwi/fig/codec'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import type { SceneGraph } from '@open-pencil/scene-graph'
import { fractionalPosition } from '@open-pencil/scene-graph/order-keys'
import type { GUID } from '@open-pencil/scene-graph/primitives'

import type { SkiaRenderer } from '#core/canvas'
import { withFigExportRuntime, withFigExportRuntimeForNodes } from '#core/canvas/text/shape'
import { IS_BROWSER, IS_TAURI } from '#core/constants'
import {
  exportSchema,
  figExportRecordOptions,
  figFileExtras,
  prepareFigExport,
  type FigExportSetup,
  type KiwiNodeChange
} from '#core/io/formats/fig/export-setup'
import { writePatchedFigFile } from '#core/io/formats/fig/patch-export'
import { renderThumbnail } from '#core/io/formats/raster'
import { buildFontDigestMapFromKeys } from '#core/kiwi/fig/node-change/font/digests'
import { sceneNodeToKiwi } from '#core/kiwi/fig/node-change/serialize'
import { cloneSceneGraphForFigExport } from '#core/kiwi/fig/parse/transfer'
import {
  hasPendingReaderPages,
  isReaderPagePending,
  populateFigInternalPages,
  populateReaderExport
} from '#core/kiwi/fig/session/document-state'
import { originalFigArchive } from '#core/kiwi/fig/session/original-archive'

import { exportFigInWorker, type PreparedFigResources } from './isolated-export'
import { encodeNativeFigPayload } from './native-payload'
import { findFigThumbnailPageId } from './thumbnail-page'
import {
  appendVariableNodeChanges,
  sequentialPositions,
  assignSharedStyleGuids
} from './variable-export'

const THUMBNAIL_1X1 = toUint8Array(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='
)

interface FigWriteOptions {
  rendering?: 'none'
  /** Already shaped by the host's faithful font runtime for this isolated write. */
  prepared?: PreparedFigResources & { thumbnailPNG?: Uint8Array }
  packNative?: (payload: Uint8Array) => Promise<Uint8Array>
}

const THUMBNAIL_WIDTH = 512
const THUMBNAIL_HEIGHT = 512

async function renderFigThumbnail(
  graph: SceneGraph,
  pageId: string | undefined,
  ck?: CanvasKit,
  renderer?: SkiaRenderer,
  renderHeadless = false,
  options: FigWriteOptions = {}
): Promise<Uint8Array> {
  if (options.rendering === 'none' || !pageId) return THUMBNAIL_1X1
  if (ck && renderer) {
    return (
      renderThumbnail(ck, renderer, graph, pageId, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT) ??
      THUMBNAIL_1X1
    )
  }
  if (!renderHeadless || IS_BROWSER || IS_TAURI) return THUMBNAIL_1X1
  const { headlessRenderThumbnail } = await import('#core/io/formats/raster')
  return (
    (await headlessRenderThumbnail(graph, pageId, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT)) ??
    THUMBNAIL_1X1
  )
}

type InternalResourceContext = FigExportSetup & { nodeChanges: KiwiNodeChange[] }

/**
 * Children already written under a canvas. Shared styles, variables and the canvas's own
 * layers all append to the internal canvas from separate passes, so each continues this
 * count rather than numbering from zero and handing siblings the same order key.
 */
function countCanvasChildren(changes: readonly NodeChange[], canvas: GUID): number {
  let count = 0
  for (const change of changes) {
    const parent = change.parentIndex?.guid
    if (parent?.sessionID === canvas.sessionID && parent.localID === canvas.localID) count++
  }
  return count
}

function appendInternalResources(context: InternalResourceContext): void {
  const { graph, internalCanvasGuid, nodeChanges } = context
  if (!internalCanvasGuid) return
  const written = countCanvasChildren(nodeChanges, internalCanvasGuid)
  const sharedStyleNodes = [...graph.nodes.values()].filter((node) => node.sharedStyleType !== null)
  assignSharedStyleGuids(
    sharedStyleNodes,
    context.localIdCounter,
    context.nodeIdToGuid,
    context.assignedGuidValues
  )
  for (let index = 0; index < sharedStyleNodes.length; index++) {
    nodeChanges.push(
      ...sceneNodeToKiwi(
        sharedStyleNodes[index],
        internalCanvasGuid,
        written + index,
        context.localIdCounter,
        graph,
        context.blobs,
        {
          nodeIdToGuid: context.nodeIdToGuid,
          fontDigestMap: context.fontDigestMap,
          varIdToGuid: context.varIdToGuid,
          glyphBlobMap: context.glyphBlobMap,
          blobIndexByHex: context.blobIndexByHex,
          assignedGuidValues: context.assignedGuidValues,
          componentPropertyDefinitionsById: context.componentPropertyDefinitionsById,
          modeIdToGuid: context.modeIdToGuid,
          propertyIdToGuid: context.propertyIdToGuid,
          pluginDataOverrides: context.pluginDataOverrides,
          runtime: context.runtime
        }
      )
    )
  }
  if (graph.variableCollections.size > 0) {
    appendVariableNodeChanges(
      graph,
      nodeChanges,
      internalCanvasGuid,
      context.varIdToGuid,
      context.modeIdToGuid,
      sequentialPositions(written + sharedStyleNodes.length)
    )
  }
}

export async function exportFigFile(
  sourceGraph: SceneGraph,
  ck?: CanvasKit,
  renderer?: SkiaRenderer,
  pageId?: string,
  renderHeadlessThumbnail = false,
  options: FigWriteOptions = {}
): Promise<Uint8Array> {
  const originalArchive = await originalFigArchive(sourceGraph)
  if (originalArchive) return originalArchive.slice()
  if (options.rendering !== 'none') {
    const patched = await withFigExportRuntime(sourceGraph, ck, (runtime) =>
      writePatchedFigFile(sourceGraph, runtime, { ck, renderer, pageId, renderHeadlessThumbnail })
    )
    if (patched) return patched
  }
  if (options.rendering === 'none') {
    if (canUseWorker()) return exportFigInWorker(sourceGraph, pageId)
    return writeFigFile(
      sourceGraph,
      EMPTY_EXPORT_RUNTIME,
      undefined,
      undefined,
      pageId,
      false,
      options
    )
  }
  const thumbnailPage = pageId ?? findFigThumbnailPageId(sourceGraph.getPages())
  // The editor supplies its shown page. An API-selected unopened cover still needs
  // the existing isolated full-graph renderer to preserve its exact thumbnail.
  const pendingThumbnail = !!thumbnailPage && isReaderPagePending(sourceGraph, thumbnailPage)
  if (canUseWorker() && !pendingThumbnail) {
    const thumbnailPNG = await renderFigThumbnail(sourceGraph, thumbnailPage, ck, renderer)
    return exportFigInWorker(sourceGraph, pageId, {
      thumbnailPNG,
      prepare: (nodes, fontKeys) =>
        withFigExportRuntimeForNodes(nodes, ck, async (runtime) => {
          const shapedText: PreparedFigResources['shapedText'] = new Map()
          for (const node of nodes) {
            try {
              shapedText.set(node.id, runtime.shapeText(node))
            } catch (error) {
              // Match the writer's existing derived-glyph policy, preserving editable text.
              console.warn(`Writing "${node.name}" without glyphs; text shaping failed:`, error)
              shapedText.set(node.id, null)
            }
          }
          return { shapedText, fontDigests: await buildFontDigestMapFromKeys(fontKeys) }
        }),
      packNative: IS_TAURI
        ? async (payload) => {
            const { invoke } = await import('@tauri-apps/api/core')
            return new Uint8Array(await invoke<ArrayBuffer>('build_fig_file_binary', payload))
          }
        : undefined
    })
  }
  if (canUseWorker() && pendingThumbnail)
    console.info('[FIG] Unopened thumbnail page uses the existing isolated renderer export')
  return withFigExportRuntime(sourceGraph, ck, (runtime) =>
    writeFigFile(sourceGraph, runtime, ck, renderer, pageId, renderHeadlessThumbnail)
  )
}

async function writeFigFile(
  sourceGraph: SceneGraph,
  runtime: FigNodeChangeExportRuntime,
  ck: CanvasKit | undefined,
  renderer: SkiaRenderer | undefined,
  pageId: string | undefined,
  renderHeadlessThumbnail: boolean,
  options: FigWriteOptions = {}
): Promise<Uint8Array> {
  await initCodec()
  populateFigInternalPages(sourceGraph)
  // The export reads the document itself and writes nothing to it. Only pages still in the
  // archive need a copy, which they load into instead of the document.
  let graph = sourceGraph
  if (hasPendingReaderPages(sourceGraph)) {
    graph = cloneSceneGraphForFigExport(sourceGraph)
    populateReaderExport(sourceGraph, graph)
  }
  if (options.prepared)
    runtime = { shapeText: (node) => options.prepared!.shapedText.get(node.id) ?? null }
  const setup = await prepareFigExport(graph, runtime, {
    fontDigestMap: options.prepared?.fontDigests
  })
  const { compiled, schemaDeflated } = exportSchema(graph)
  const { canvasEntries, internalCanvasGuid, localIdCounter, blobs } = setup
  const nodeChanges: KiwiNodeChange[] = [setup.documentNc]
  for (const entry of canvasEntries) nodeChanges.push(entry.canvasNc)

  appendInternalResources({ ...setup, nodeChanges })

  const orderedCanvasEntries = [
    ...canvasEntries.filter((entry) => entry.page.internalOnly),
    ...canvasEntries.filter((entry) => !entry.page.internalOnly)
  ]
  const slotContentRecords: KiwiNodeChange[] = []
  const recordOptions = { ...figExportRecordOptions(setup), slotContentRecords }
  for (const { page, canvasGuid } of orderedCanvasEntries) {
    const children = graph
      .getChildren(page.id)
      .filter((child) => !child.internalOnly && child.sharedStyleType === null)
    const base = countCanvasChildren(nodeChanges, canvasGuid)
    for (let i = 0; i < children.length; i++) {
      nodeChanges.push(
        ...sceneNodeToKiwi(
          children[i],
          canvasGuid,
          base + i,
          localIdCounter,
          graph,
          blobs,
          recordOptions
        )
      )
    }
  }
  if (internalCanvasGuid) {
    const first = countCanvasChildren(nodeChanges, internalCanvasGuid)
    placeSlotContent(slotContentRecords, internalCanvasGuid, first, fractionalPosition)
    nodeChanges.push(...slotContentRecords)
  }

  const msg: Record<string, unknown> = {
    type: 'NODE_CHANGES',
    sessionID: 0,
    ackID: 0,
    nodeChanges
  }

  if (blobs.length > 0) {
    msg.blobs = blobs.map((bytes) => ({ bytes }))
  }

  const kiwiData = compiled.encodeMessage(msg)
  const extras = await figFileExtras(graph, pageId, ck, renderer, renderHeadlessThumbnail, options)

  const version = graph.figKiwiVersion ?? undefined

  const nativePayload = () =>
    encodeNativeFigPayload(
      schemaDeflated,
      kiwiData,
      extras.thumbnailPNG,
      extras.metaJSON,
      extras.images,
      version
    )
  if (options.packNative) return options.packNative(nativePayload())
  if (IS_TAURI) {
    const { invoke } = await import('@tauri-apps/api/core')
    return new Uint8Array(await invoke<ArrayBuffer>('build_fig_file_binary', nativePayload()))
  }

  return compressFigData(
    schemaDeflated,
    kiwiData,
    extras.thumbnailPNG,
    extras.metaJSON,
    extras.images,
    version
  )
}

export { compressFigDataSync } from '@open-pencil/fig'

function canUseWorker(): boolean {
  return typeof Worker !== 'undefined' && IS_BROWSER
}

function compressViaWorker(
  schemaDeflated: Uint8Array,
  kiwiData: Uint8Array,
  thumbnailPNG: Uint8Array,
  metaJSON: string,
  imageEntries: Array<{ name: string; data: Uint8Array }>,
  figKiwiVersion?: number
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./export-worker.ts', import.meta.url), {
      type: 'module'
    })

    worker.onmessage = (e: MessageEvent<Uint8Array>) => {
      resolve(e.data)
      worker.terminate()
    }
    worker.onerror = (err) => {
      reject(new Error(err.message))
      worker.terminate()
    }

    // Do NOT use transferables here. toUint8Array() in ByteBuffer returns a view of the
    // internal buffer, so transferring kiwiData.buffer or schemaDeflated.buffer detaches
    // buffers that may be shared with other views, causing "already detached" errors on
    // subsequent saves. Structured clone (the default) copies the data safely.
    worker.postMessage({
      schemaDeflated,
      kiwiData,
      thumbnailPNG,
      metaJSON,
      images: imageEntries,
      figKiwiVersion
    })
  })
}

export function compressFigData(
  schemaDeflated: Uint8Array,
  kiwiData: Uint8Array,
  thumbnailPNG: Uint8Array,
  metaJSON: string,
  imageEntries: Array<{ name: string; data: Uint8Array }>,
  figKiwiVersion?: number
): Promise<Uint8Array> {
  if (canUseWorker()) {
    return compressViaWorker(
      schemaDeflated,
      kiwiData,
      thumbnailPNG,
      metaJSON,
      imageEntries,
      figKiwiVersion
    )
  }
  return Promise.resolve(
    compressFigDataSync(
      schemaDeflated,
      kiwiData,
      thumbnailPNG,
      metaJSON,
      imageEntries,
      figKiwiVersion
    )
  )
}
