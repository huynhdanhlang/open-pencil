import type { SceneGraph } from '@open-pencil/scene-graph'

/** Terminal automation bridge closures; transient/graceful server closes may retry. */
export const AUTOMATION_CLOSE_CODES = {
  unauthorized: 1008,
  replaced: 4001
} as const

export interface RPCCommand<A = unknown, R = unknown> {
  name: string
  execute: (graph: SceneGraph, args: A) => R | Promise<R>
}
