import { expect, test } from 'bun:test'

import { assertSnapshotHelperHandshake } from '@/app/ai/agents/policy'

test('unverified ordinary ACP adapter cannot become a snapshot helper', () => {
  expect(() =>
    assertSnapshotHelperHandshake({ agentInfo: { name: 'codex-acp', version: '2.1.1' } })
  ).toThrow('unsupported_helper_boundary')
})

test('helper accepts only the pinned enforced bootstrap policy', () => {
  const init = {
    agentInfo: { name: 'codex-acp', version: '2.1.1' },
    _meta: {
      openpencilSnapshotHelper: {
        version: 1,
        codexVersion: '0.159.3',
        shell: false,
        applyPatch: false,
        localImages: false,
        mcp: false,
        recursiveAgents: false,
        sandbox: 'read-only',
        approvals: 'deny-all'
      }
    }
  }
  expect(() => assertSnapshotHelperHandshake(init)).not.toThrow()
  expect(() =>
    assertSnapshotHelperHandshake({
      ...init,
      _meta: { openpencilSnapshotHelper: { ...init._meta.openpencilSnapshotHelper, mcp: true } }
    })
  ).toThrow('unsupported_helper_boundary')
})
