import { expect, test } from 'bun:test'

import type { RequestPermissionRequest } from '@agentclientprotocol/sdk'

import {
  permissionWithToolContext,
  requestPermissionFromUser,
  permissionQueue,
  respondToPermission
} from '@/app/ai/acp/permission'

const request: RequestPermissionRequest = {
  sessionId: 'test',
  toolCall: { toolCallId: 'call', kind: 'execute', status: 'pending' },
  options: [{ optionId: 'allow', kind: 'allow_once', name: 'Allow' }]
}

test('minimal adapter approvals retain the exact previously announced tool and arguments', () => {
  const rawInput = { arguments: { document_id: 'tab-2', page_id: '0:3', id: '0:5' } }
  const result = permissionWithToolContext(request, {
    toolCallId: 'call',
    title: 'mcp.open-pencil.update_node',
    rawInput
  })
  expect(result.toolCall.title).toBe('mcp.open-pencil.update_node')
  expect(result.toolCall.rawInput).toBe(rawInput)
  expect(result.toolCall.status).toBe('pending')
})

test('stopping one agent permission removes only its own request without approving it', async () => {
  const controller = new AbortController()
  const first = requestPermissionFromUser(request, controller.signal)
  const second = requestPermissionFromUser({ ...request, sessionId: 'another' })
  controller.abort()
  expect(await first).toEqual({ outcome: { outcome: 'cancelled' } })
  expect(permissionQueue.value).toHaveLength(1)
  expect(permissionQueue.value[0]?.request.sessionId).toBe('another')
  respondToPermission('allow')
  await second
})
