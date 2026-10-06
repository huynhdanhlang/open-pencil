import {
  buildComponent,
  createElement,
  encodeTreeForTransport,
  resolveToTree,
  type TreeNode
} from '@open-pencil/design-jsx'

export function preprocessRPC(body: Record<string, unknown>): Record<string, unknown> {
  if (body.command !== 'tool') return body
  const args = body.args as { name?: string; args?: Record<string, unknown> } | undefined
  if (args?.name !== 'render' || !args.args?.jsx) return body
  let tree: TreeNode | null
  try {
    const Component = buildComponent(args.args.jsx as string)
    const element = createElement(Component, null)
    tree = resolveToTree(element)
  } catch (e) {
    console.warn('JSX preprocessing failed, passing raw:', e instanceof Error ? e.message : e)
    return body
  }
  // Codec failures must not silently send an unencoded variable through the raw-JSX path.
  return {
    ...body,
    args: {
      ...args,
      args: { ...args.args, jsx: undefined, tree: tree && encodeTreeForTransport(tree) }
    }
  }
}
