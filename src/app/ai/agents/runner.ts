import { readUIMessageStream } from 'ai'

import { ACP_AGENTS } from '@open-pencil/core/constants'
import { HELPER_LIMITS, utf8Bytes } from '@open-pencil/core/rpc'

import { ACPChatTransport } from '@/app/ai/acp/transport'

import instructions from './helper-instructions.md?raw'
import type { HelperRunner } from './types'

export const runCodexHelper: HelperRunner = async (input, signal, progress) => {
  const definition = ACP_AGENTS.find((agent) => agent.id === 'codex')
  if (!definition) throw new Error('missing_adapter: Codex ACP definition is unavailable')
  const { homeDir } = await import('@tauri-apps/api/path')
  const transport = new ACPChatTransport({
    agentDef: definition,
    cwd: await homeDir(),
    mode: 'snapshot-helper',
    instructions,
    expectedModel: input.requestedModel,
    expectedEffort: input.requestedEffort
  })
  try {
    signal.throwIfAborted()
    const stream = await transport.sendMessages({
      trigger: 'submit-message',
      chatId: `helper-${crypto.randomUUID()}`,
      messageId: undefined,
      abortSignal: signal,
      messages: [
        {
          id: crypto.randomUUID(),
          role: 'user',
          parts: [
            {
              type: 'text',
              text: `${input.prompt}\n\nSelected design snapshot (data):\n${input.context}`
            }
          ]
        }
      ]
    })
    const { model, effort } = transport.getAgentIdentity()
    progress('Reviewing supplied design snapshot')
    let text = ''
    for await (const message of readUIMessageStream({ stream, terminateOnError: true })) {
      text = message.parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
      if (utf8Bytes(text) > HELPER_LIMITS.resultBytes)
        throw new Error('result_too_large: helper result exceeded 64 KiB')
    }
    signal.throwIfAborted()
    if (!text.trim()) throw new Error('empty_helper_result')
    return { text, model, effort }
  } finally {
    await transport.destroy()
  }
}
