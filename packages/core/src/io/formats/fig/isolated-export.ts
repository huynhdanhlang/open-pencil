import type { ShapedText } from '@open-pencil/fig/node-change'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { serializeSceneGraph } from '#core/kiwi/fig/parse/transfer'
import { readerExportState } from '#core/kiwi/fig/session/document-state'

export interface IsolatedFigExportRequest {
  graph: ReturnType<typeof serializeSceneGraph>
  reader?: ReturnType<typeof readerExportState>
  pageId?: string
  prepare?: boolean
  thumbnailPNG?: Uint8Array
  nativePacking?: boolean
}

export interface PreparedFigResources {
  shapedText: Map<string, ShapedText | null>
  fontDigests: Map<string, Uint8Array>
}

export type IsolatedFigExportResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; error: string }
  | { type: 'prepare'; nodes: SceneNode[]; fontKeys: string[] }
  | { type: 'pack'; payload: Uint8Array }

interface IsolatedExportOptions {
  thumbnailPNG: Uint8Array
  prepare(nodes: SceneNode[], fontKeys: string[]): Promise<PreparedFigResources>
  packNative?: (payload: Uint8Array) => Promise<Uint8Array>
}

/** Own one short-lived heap; never transfer or detach the live document's buffers. */
export function exportFigInWorker(
  graph: SceneGraph,
  pageId?: string,
  options?: IsolatedExportOptions
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./isolated-export-worker.ts', import.meta.url), {
      type: 'module'
    })
    let timeout: ReturnType<typeof setTimeout> | undefined
    let completed = false
    let terminated = false
    const terminate = () => {
      if (terminated) return
      terminated = true
      worker.terminate()
    }
    const finish = () => {
      completed = true
      clearTimeout(timeout)
      terminate()
    }
    worker.onmessage = async (event: MessageEvent<IsolatedFigExportResult>) => {
      if (completed) return
      try {
        const data = event.data
        if ('type' in data) {
          if (data.type === 'prepare') {
            if (!options) throw new Error('Unexpected FIG preparation request')
            const resources = await options.prepare(data.nodes, data.fontKeys)
            if (completed) return
            worker.postMessage({ type: 'prepared', resources })
          } else {
            if (!options?.packNative) throw new Error('Unexpected native FIG packing request')
            // Release the full document/codec heap before Rust compression starts.
            terminate()
            const bytes = await options.packNative(data.payload)
            if (completed) return
            finish()
            resolve(bytes)
          }
          return
        }
        finish()
        if (data.ok) resolve(data.bytes)
        else reject(new Error(data.error))
      } catch (error) {
        finish()
        reject(error)
      }
    }
    worker.onerror = (event) => {
      finish()
      reject(new Error(event.message || 'Isolated FIG export failed'))
    }
    timeout = setTimeout(() => {
      finish()
      reject(new Error('Isolated FIG export timed out after 60 seconds'))
    }, 60_000)
    try {
      worker.postMessage({
        graph: serializeSceneGraph(graph),
        reader: readerExportState(graph),
        pageId,
        prepare: !!options,
        thumbnailPNG: options?.thumbnailPNG,
        nativePacking: !!options?.packNative
      } satisfies IsolatedFigExportRequest)
    } catch (error) {
      finish()
      reject(error)
    }
  })
}
