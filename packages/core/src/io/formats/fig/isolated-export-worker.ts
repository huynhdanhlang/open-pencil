import { deserializeSceneGraph } from '#core/kiwi/fig/parse/transfer'
import { registerReaderRecovery } from '#core/kiwi/fig/session/document-state'

import { exportFigFile } from './export'
import type { IsolatedFigExportRequest, IsolatedFigExportResult } from './isolated-export'

self.onmessage = async (event: MessageEvent<IsolatedFigExportRequest>) => {
  try {
    const { graph: data, reader, pageId } = event.data
    const graph = deserializeSceneGraph(data)
    if (reader) registerReaderRecovery(graph, reader.bytes, reader.checkpoint)
    const bytes = await exportFigFile(graph, undefined, undefined, pageId, false, {
      rendering: 'none'
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
