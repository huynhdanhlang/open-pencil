import { fontKeysForGraph } from '#core/kiwi/fig/node-change/font/digests'
import { deserializeSceneGraph } from '#core/kiwi/fig/parse/transfer'
import {
  populateReaderExport,
  registerReaderRecovery,
  releaseReaderRecovery
} from '#core/kiwi/fig/session/document-state'

import { exportFigFile } from './export'
import type {
  IsolatedFigExportRequest,
  IsolatedFigExportResult,
  PreparedFigResources
} from './isolated-export'

type PreparedReply = { type: 'prepared'; resources: PreparedFigResources }
let resolvePreparation: ((resources: PreparedFigResources) => void) | undefined
self.onmessage = async (event: MessageEvent<IsolatedFigExportRequest | PreparedReply>) => {
  if ('type' in event.data) {
    resolvePreparation?.(event.data.resources)
    resolvePreparation = undefined
    return
  }
  try {
    const { graph: data, reader, pageId, prepare, thumbnailPNG, nativePacking } = event.data
    const graph = deserializeSceneGraph(data)
    if (reader) registerReaderRecovery(graph, reader.bytes, reader.checkpoint)
    let resources: PreparedFigResources | undefined
    if (prepare) {
      // This graph is owned solely by the worker; populate once, including internal pages.
      populateReaderExport(graph, graph)
      releaseReaderRecovery(graph)
      const pending = new Promise<PreparedFigResources>((resolve) => {
        resolvePreparation = resolve
      })
      self.postMessage({
        type: 'prepare',
        nodes: [...graph.nodes.values()].filter(
          (node) => node.type === 'TEXT' && !node.derivedTextGlyphs?.length
        ),
        fontKeys: fontKeysForGraph(graph)
      } satisfies IsolatedFigExportResult)
      resources = await pending
    }
    const bytes = await exportFigFile(graph, undefined, undefined, pageId, false, {
      rendering: 'none',
      prepared: resources && { ...resources, thumbnailPNG },
      packNative: nativePacking
        ? (payload) => {
            self.postMessage({ type: 'pack', payload } satisfies IsolatedFigExportResult, {
              transfer: [payload.buffer]
            })
            // The host terminates this heap before invoking the native packer.
            return new Promise<Uint8Array>(() => {})
          }
        : undefined
    })
    self.postMessage({ ok: true, bytes } satisfies IsolatedFigExportResult, {
      transfer: [bytes.buffer]
    })
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    } satisfies IsolatedFigExportResult)
  }
}
