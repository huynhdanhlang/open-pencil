import * as v from 'valibot'

const policySchema = v.object({
  agentInfo: v.object({ version: v.literal('2.1.1') }),
  _meta: v.object({
    openpencilSnapshotHelper: v.object({
      version: v.literal(1),
      codexVersion: v.literal('0.159.3'),
      shell: v.literal(false),
      applyPatch: v.literal(false),
      localImages: v.literal(false),
      mcp: v.literal(false),
      recursiveAgents: v.literal(false),
      sandbox: v.literal('read-only'),
      approvals: v.literal('deny-all')
    })
  })
})

export function assertSnapshotHelperHandshake(initialized: unknown): void {
  if (!v.safeParse(policySchema, initialized).success) {
    throw new Error(
      'unsupported_helper_boundary: install the verified Codex snapshot helper launcher'
    )
  }
}
