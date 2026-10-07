import 'fake-indexeddb/auto'
import { expect, test } from 'bun:test'

import type { UIMessage } from 'ai'
import { reactive } from 'vue'

import { createConversationHistory } from '@/app/ai/chat/history/controller'
import type { ChatDocumentEditor } from '@/app/ai/chat/history/document'
import { createConversationStore } from '@/app/ai/chat/history/idb'

import { expectDefined } from '#tests/helpers/assert'

function editor(path: string): ChatDocumentEditor {
  const recoveryId = crypto.randomUUID()
  return {
    state: { documentName: 'Owned chat' },
    getRecoveryId: () => recoveryId,
    getSourceIdentity: () => ({ path, handle: null }),
    getDocumentFilePath: () => path,
    getStorageBinding: () => null
  }
}

function fixture() {
  let active = editor(`/tmp/${crypto.randomUUID()}.fig`)
  let resets = 0
  let stops = 0
  let failWrites = false
  const store = createConversationStore()
  const chat = reactive({
    messages: [] as UIMessage[],
    status: 'ready' as const,
    stop: async () => {
      stops++
    }
  })
  const history = createConversationHistory(
    {
      getEditor: () => active,
      ensureChat: async () => chat,
      resetChat: async () => {
        resets++
      },
      profileId: () => null,
      backend: () => 'direct'
    },
    {
      ...store,
      write: async (row) => {
        if (failWrites) throw new DOMException('Storage full', 'QuotaExceededError')
        await store.write(row)
      }
    }
  )
  return {
    history,
    store,
    chat,
    getEditor: () => active,
    setEditor: (next: ChatDocumentEditor) => {
      active = next
    },
    getResets: () => resets,
    getStops: () => stops,
    setFail: (value: boolean) => {
      failWrites = value
    }
  }
}

test('reopening the same file in a new editor detaches the old live chat', async () => {
  const f = fixture()
  await f.history.ensureChat()
  const resets = f.getResets()
  f.setEditor(editor(expectDefined(f.getEditor().getDocumentFilePath(), 'document path')))
  await f.history.initialize()
  expect(f.getResets()).toBe(resets + 1)
  expect(f.getStops()).toBe(1)
  await f.history.releaseEditor(f.getEditor())
})

test('closing a chat owner flushes its transcript and prevents new binding to that editor', async () => {
  const f = fixture()
  await f.history.ensureChat()
  const owner = f.getEditor()
  const conversation = f.history.current.value
  if (!conversation) throw new Error('Missing conversation')
  f.chat.messages = [{ id: 'owned', role: 'user', parts: [{ type: 'text', text: 'Keep this' }] }]
  const resets = f.getResets()
  await f.history.releaseEditor(owner)
  expect(f.getResets()).toBe(resets + 1)
  expect(f.getStops()).toBe(1)
  expect(f.history.current.value).toBeNull()
  expect(f.history.messages.value).toEqual([])
  expect((await f.store.read(conversation.id))?.messages[0]?.message.id).toBe('owned')
  expect(await f.history.ensureChat()).toBeNull()
  f.setEditor(editor(expectDefined(owner.getDocumentFilePath(), 'document path')))
  await f.history.initialize()
  expect(f.history.current.value?.id).toBe(conversation.id)
  await f.history.releaseEditor(f.getEditor())
})

test('closing another editor leaves the current chat attached', async () => {
  const f = fixture()
  const previous = f.getEditor()
  await f.history.ensureChat()
  f.setEditor(editor(`/tmp/${crypto.randomUUID()}.fig`))
  await f.history.ensureChat()
  const current = f.history.current.value
  const resets = f.getResets()
  const stops = f.getStops()
  await f.history.releaseEditor(previous)
  expect(f.history.current.value).toBe(current)
  expect(f.getResets()).toBe(resets)
  expect(f.getStops()).toBe(stops)
  expect(await f.history.ensureChat()).toBe(f.chat)
  await f.history.releaseEditor(f.getEditor())
})

test('a later cancelled close permits the still-open editor to bind its saved chat again', async () => {
  const f = fixture()
  await f.history.ensureChat()
  f.chat.messages = [
    { id: 'cancelled', role: 'user', parts: [{ type: 'text', text: 'Still open' }] }
  ]
  const id = f.history.current.value?.id
  await f.history.releaseEditor(f.getEditor())
  expect(await f.history.ensureChat()).toBeNull()
  f.history.cancelEditorClose(f.getEditor())
  expect(await f.history.ensureChat()).toBe(f.chat)
  expect(f.history.current.value?.id).toBe(id)
  await f.history.releaseEditor(f.getEditor())
})

test('a failed final transcript write preserves ownership for a close retry', async () => {
  const f = fixture()
  await f.history.ensureChat()
  f.chat.messages = [{ id: 'retry', role: 'user', parts: [{ type: 'text', text: 'Recover me' }] }]
  const conversation = f.history.current.value
  if (!conversation) throw new Error('Missing conversation')
  const resets = f.getResets()
  f.setFail(true)
  await expect(f.history.releaseEditor(f.getEditor())).rejects.toThrow('Storage full')
  expect(f.getResets()).toBe(resets)
  expect(f.history.current.value?.id).toBe(conversation.id)
  expect(f.history.storageError.value).toBe(true)
  expect(await f.history.ensureChat()).toBe(f.chat)
  f.setFail(false)
  await f.history.releaseEditor(f.getEditor())
  expect((await f.store.read(conversation.id))?.messages[0]?.message.id).toBe('retry')
  expect(f.history.current.value).toBeNull()
})

test('closing during transport initialization rejects its late completion', async () => {
  const owner = editor(`/tmp/${crypto.randomUUID()}.fig`)
  const started = Promise.withResolvers<undefined>()
  const pending = Promise.withResolvers<{
    messages: UIMessage[]
    status: 'ready'
    stop(): Promise<void>
  }>()
  let stops = 0
  const history = createConversationHistory(
    {
      getEditor: () => owner,
      ensureChat: () => {
        started.resolve(undefined)
        return pending.promise
      },
      resetChat: async () => undefined,
      profileId: () => null,
      backend: () => 'direct'
    },
    createConversationStore()
  )
  const initializing = history.ensureChat()
  await started.promise
  const closing = history.releaseEditor(owner)
  pending.resolve({
    messages: [],
    status: 'ready',
    stop: async () => {
      stops++
    }
  })
  expect(await initializing).toBeNull()
  await closing
  expect(stops).toBe(1)
  expect(history.current.value).toBeNull()
  expect(await history.ensureChat()).toBeNull()
})

for (const stage of ['selection', 'read'] as const) {
  test(`closing during a deferred ${stage} cannot bind the old transcript to another tab`, async () => {
    const first = editor(`/tmp/${crypto.randomUUID()}.fig`)
    const second = editor(`/tmp/${crypto.randomUUID()}.fig`)
    let active = first
    const store = createConversationStore()
    const id = crypto.randomUUID()
    const documentId = `file:${first.getDocumentFilePath()}`
    const now = new Date().toISOString()
    await store.write({
      id,
      documentId,
      documentName: 'First tab',
      title: 'Private A',
      titleSource: 'manual',
      createdAt: now,
      updatedAt: now,
      profileId: null,
      backend: 'direct',
      interrupted: false,
      messages: [
        {
          message: { id: 'private-a', role: 'user', parts: [{ type: 'text', text: 'Only A' }] },
          attachments: []
        }
      ]
    })
    await store.select(documentId, id)
    const started = Promise.withResolvers<undefined>()
    const ready = Promise.withResolvers<undefined>()
    const bindings: Array<{ editor: ChatDocumentEditor; messages: UIMessage[] }> = []
    const history = createConversationHistory(
      {
        getEditor: () => active,
        ensureChat: async (messages) => {
          bindings.push({ editor: active, messages: messages ?? [] })
          return reactive({
            messages: messages ?? [],
            status: 'ready' as const,
            stop: async () => undefined
          })
        },
        resetChat: async () => undefined,
        profileId: () => null,
        backend: () => 'direct'
      },
      {
        ...store,
        getSelected: async (target) => {
          if (stage === 'selection' && target === documentId) {
            started.resolve(undefined)
            await ready.promise
          }
          return store.getSelected(target)
        },
        read: async (target) => {
          if (stage === 'read' && target === id) {
            started.resolve(undefined)
            await ready.promise
          }
          return store.read(target)
        }
      }
    )
    const initializing = history.ensureChat()
    await started.promise
    active = second
    const closing = history.releaseEditor(first)
    ready.resolve(undefined)
    expect(await initializing).toBeNull()
    await closing
    expect(bindings).toEqual([])
    expect((await history.ensureChat())?.messages).toEqual([])
    expect(bindings).toEqual([{ editor: second, messages: [] }])
    expect((await store.read(id))?.messages[0]?.message.id).toBe('private-a')
    await history.releaseEditor(second)
  })
}
