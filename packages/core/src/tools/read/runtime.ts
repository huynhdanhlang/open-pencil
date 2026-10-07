import * as v from 'valibot'

import { defineTool } from '#core/tools/schema'

export const getRuntimeStatus = defineTool({
  name: 'get_runtime_status',
  description:
    'Read document counts, shared CanvasKit WASM heap capacity, Gr GPU resource-cache bytes, retained renderer resources and Undo counts. No content or credentials. Capacity is not live allocation; GPU cache bytes and ownership counts are not total process memory. Unavailable GPU metrics are null.',
  execution: { kind: 'sync', mutation: 'none' },
  exposure: { webmcp: false },
  input: v.object({}),
  execute: (figma) => figma.getRuntimeStatus()
})
