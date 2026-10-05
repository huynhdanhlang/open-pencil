import { expect, test } from 'bun:test'

import { ACPChatTransport } from '@/app/ai/acp/transport'

test('helper sends only its own instructions and supplied review snapshot', async () => {
  const transport = new ACPChatTransport({
    agentDef: { id: 'codex', name: 'Codex', command: 'codex-acp', args: [] },
    mode: 'snapshot-helper',
    instructions: 'SNAPSHOT_REVIEW_ONLY'
  })
  let prompt: unknown
  Reflect.set(transport, 'session', {
    sessionId: 'test',
    supportsImages: false,
    dead: false,
    onUpdate: null,
    modelId: 'gpt-6.1-sol',
    child: { kill: async () => undefined },
    connection: {
      prompt: async (input: unknown) => {
        prompt = input
        return { stopReason: 'end_turn' }
      }
    }
  })
  const stream = await transport.sendMessages({
    trigger: 'submit-message',
    chatId: 'helper',
    messageId: undefined,
    abortSignal: undefined,
    messages: [
      { id: 'user', role: 'user', parts: [{ type: 'text', text: 'Review selected button' }] }
    ]
  })
  await Array.fromAsync(stream)
  expect(JSON.stringify(prompt)).toContain('SNAPSHOT_REVIEW_ONLY')
  expect(JSON.stringify(prompt)).not.toContain('You are OpenPencil')
  expect(transport.getAgentIdentity()).toEqual({ model: 'gpt-6.1-sol', effort: null })
  await transport.destroy()
})

test('helper verifies configured model and effort before prompt and fixes launcher profile args', () => {
  const transport = new ACPChatTransport({
    agentDef: { id: 'codex', name: 'Codex', command: 'codex-acp', args: [] },
    mode: 'snapshot-helper',
    expectedModel: 'gpt-6.1-sol',
    expectedEffort: 'high'
  })
  const verify = Reflect.get(transport, 'checkHelperSession').bind(transport)
  const session = {
    modes: { currentModeId: 'read-only' },
    models: { currentModelId: 'gpt-6.1-sol[high]' }
  }
  expect(() => verify(session)).not.toThrow()
  expect(() => verify({ ...session, models: { currentModelId: 'gpt-6.1-sol[low]' } })).toThrow(
    'configured_effort_mismatch'
  )
  expect(() => verify({ ...session, models: { currentModelId: 'another[high]' } })).toThrow(
    'configured_model_mismatch'
  )
  const args = Reflect.get(transport, 'processArgs').call(transport)
  expect(JSON.parse(args[1])).toEqual({ model: 'gpt-6.1-sol', effort: 'high' })
})
