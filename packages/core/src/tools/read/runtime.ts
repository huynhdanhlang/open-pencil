import * as v from 'valibot'

import { defineTool } from '#core/tools/schema'

export const getRuntimeStatus = defineTool({
  name: 'get_runtime_status',
  description:
    'Read document counts, shared CanvasKit WASM heap capacity, retained renderer resources and Undo counts. No content or credentials. Capacity is not live allocation; cache counts are not total native memory.',
  execution: { kind: 'sync', mutation: 'none' },
  exposure: { webmcp: false },
  input: v.object({}),
  execute: (figma) => figma.getRuntimeStatus()
})
