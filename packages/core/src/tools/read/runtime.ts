import * as v from 'valibot'

import { defineTool } from '#core/tools/schema'

export const getRuntimeStatus = defineTool({
  name: 'get_runtime_status',
  description:
    'Read document counts, shared CanvasKit WASM heap capacity, Gr GPU resource-cache bytes, retained renderer resources, Undo counts and bounded redacted WASM error frames from existing diagnostics. No design content or credentials. Capacity is not live allocation; GPU cache bytes and ownership counts are not total process memory. Unavailable metrics are null; diagnostics storageBackend identifies the selected backend, not a successful durable write.',
  execution: { kind: 'sync', mutation: 'none' },
  exposure: { webmcp: false },
  input: v.strictObject({}),
  execute: (figma) => figma.getRuntimeStatus()
})
