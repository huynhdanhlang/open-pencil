import 'fake-indexeddb/auto'
import { expect, test } from 'bun:test'

import { computed, ref } from 'vue'

import type { AIProviderID } from '@open-pencil/core/constants'

import { createConversationHistory } from '@/app/ai/chat/history/controller'
import { createConversationStore } from '@/app/ai/chat/history/idb'
import { createChatSessionManager } from '@/app/ai/chat/transports'
import { createEditorStore } from '@/app/editor/session/create'

test('real SDK chat manager drops a closed editor before the same file is reopened', async () => {
  const first = createEditorStore()
  const reopened = createEditorStore()
  const path = `/tmp/${crypto.randomUUID()}.fig`
  first.setPlannedFilePath(path)
  reopened.setPlannedFilePath(path)
  let active = first
  let transportCreations = 0
  const manager = createChatSessionManager({
    isConfigured: computed(() => true),
    isACPProvider: computed(() => false),
    isHarnessProvider: computed(() => false),
    providerID: ref<AIProviderID>('anthropic'),
    credentialsReady: Promise.resolve(),
    getActiveEditorStore: () => active
  })
  manager.setOverrideTransport(() => {
    transportCreations++
    return {
      sendMessages: async () => {
        throw new Error('This lifecycle test must not request inference')
      },
      reconnectToStream: async () => null
    }
  })
  const history = createConversationHistory(
    {
      getEditor: () => active,
      ensureChat: manager.ensureChat,
      resetChat: manager.resetChat,
      profileId: () => null,
      backend: () => 'direct'
    },
    createConversationStore()
  )
  try {
    const original = await history.ensureChat()
    if (!original) throw new Error('Missing SDK chat')
    original.messages = [
      { id: 'saved', role: 'user', parts: [{ type: 'text', text: 'Keep transcript' }] }
    ]
    await history.releaseEditor(first)
    first.dispose()
    active = reopened
    const next = await history.ensureChat()
    expect(next).not.toBe(original)
    expect(next?.messages[0]?.id).toBe('saved')
    expect(transportCreations).toBe(2)
    await history.releaseEditor(first)
    expect(await history.ensureChat()).toBe(next)
    expect(transportCreations).toBe(2)
    await history.releaseEditor(reopened)
  } finally {
    await manager.resetChat()
    first.dispose()
    reopened.dispose()
  }
})
