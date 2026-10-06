import type { SceneGraph } from '@open-pencil/scene-graph'

import { serializeSceneGraph } from '#core/kiwi/fig/parse/transfer'
import { readerExportState } from '#core/kiwi/fig/session/document-state'

export interface IsolatedFigExportRequest {
  graph: ReturnType<typeof serializeSceneGraph>
  reader?: ReturnType<typeof readerExportState>
  pageId?: string
}

export type IsolatedFigExportResult = { ok: true; bytes: Uint8Array } | { ok: false; error: string }

/** Own one short-lived heap; never transfer or detach the live document's buffers. */
export function exportFigInWorker(graph: SceneGraph, pageId?: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./isolated-export-worker.ts', import.meta.url), {
      type: 'module'
    })
    let timeout: ReturnType<typeof setTimeout> | undefined
    const finish = () => {
      clearTimeout(timeout)
      worker.terminate()
    }
    worker.onmessage = (event: MessageEvent<IsolatedFigExportResult>) => {
      finish()
      if (event.data.ok) resolve(event.data.bytes)
      else reject(new Error(event.data.error))
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
        pageId
      } satisfies IsolatedFigExportRequest)
    } catch (error) {
      finish()
      reject(error)
    }
  })
}
