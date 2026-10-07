import 'fake-indexeddb/auto'
import { describe, expect, mock, spyOn, test } from 'bun:test'

import { Chat } from '@ai-sdk/vue'
import type { UIMessage } from 'ai'
import { ref, shallowRef } from 'vue'

import { AgentSetupError } from '@/app/ai/agents/readiness'
import * as analyze from '@/app/ai/attachment/image/analyze'
import * as prepare from '@/app/ai/attachment/image/prepare'
import { useChatSubmission } from '@/app/ai/chat/submission/use'
import type { EditorStore } from '@/app/editor/active-store'
import { createEditorStore } from '@/app/editor/session/create'

import { asDouble } from '#tests/helpers/doubles'

test('ACP composer sends the prepared image without Vision even when provider changes during preparation', async () => {
  const editor = createEditorStore()
  const data = new Uint8Array([137, 80, 78, 71])
  const image = {
    data,
    blob: new Blob([data]),
    mediaType: 'image/png' as const,
    width: 1,
    height: 1,
    originalWidth: 1,
    originalHeight: 1
  }
  let complete: (value: typeof image) => void = () => undefined
  let ready: () => void = () => undefined
  const preparing = new Promise<void>((resolve) => {
    ready = resolve
  })
  const preparation = spyOn(prepare, 'prepareImageAttachment').mockImplementation(() => {
    ready()
    return new Promise((resolve) => {
      complete = resolve
    })
  })
  const revoke = spyOn(prepare, 'revokeImagePreviewURL').mockImplementation(() => undefined)
  const vision = spyOn(analyze, 'analyzeAttachedImages')
  const sent: UIMessage[] = []
  const chat = new Chat<UIMessage>({
    transport: {
      sendMessages: async ({ messages }) => {
        sent.push(...messages)
        return new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'start' })
            controller.enqueue({ type: 'finish', finishReason: 'stop' })
            controller.close()
          }
        })
      },
      reconnectToStream: async () => null
    }
  })
  let agent = true
  const errors: string[] = []
  const submission = useChatSubmission({
    chat: shallowRef(chat),
    ensureChat: async () => chat,
    clearFailure: () => undefined,
    getEditor: () => editor,
    useAgentImages: () => agent,
    messages,
    reportError: (message) => errors.push(message),
    openModelSettings: () => undefined,
    openSetup: () => undefined
  })
  try {
    const pending = submission.submit({
      modelText: 'Inspect',
      displayText: 'Inspect',
      nodes: [],
      images: [
        { file: new File([data], 'image.png', { type: 'image/png' }), previewURL: 'blob:test' }
      ]
    })
    await preparing
    agent = false
    complete(image)
    expect(await pending).toBe(true)
    expect(errors).toEqual([])
    expect(vision).not.toHaveBeenCalled()
    expect(sent.at(-1)?.parts).toContainEqual({
      type: 'file',
      mediaType: 'image/png',
      url: 'data:image/png;base64,iVBORw=='
    })
  } finally {
    preparation.mockRestore()
    revoke.mockRestore()
    vision.mockRestore()
    editor.dispose()
  }
})
const messages = ref({
  openSettings: 'Open settings',
  requestFailed: 'Request failed',
  visionUnavailable: 'Vision unavailable',
  runSetup: 'Run guided setup',
  agentSetup: {
    'companion-missing': 'Companion missing',
    'companion-outdated': 'Companion outdated',
    'mcp-outdated': 'MCP outdated',
    'pi-sign-in': 'Pi sign-in',
    'pi-model': 'Pi model'
  }
})

test.each(['cancel', 'switch'] as const)(
  'returns an unsent image draft after %s during preparation',
  async (action) => {
    const editor = createEditorStore()
    const target = fakeChat()
    const current = shallowRef(target)
    const image = {
      data: new Uint8Array([137]),
      blob: new Blob(),
      mediaType: 'image/png' as const,
      width: 1,
      height: 1,
      originalWidth: 1,
      originalHeight: 1
    }
    let ready: () => void = () => undefined
    let complete: (value: typeof image) => void = () => undefined
    const preparing = new Promise<void>((resolve) => {
      ready = resolve
    })
    const preparation = spyOn(prepare, 'prepareImageAttachment').mockImplementation(() => {
      ready()
      return new Promise((resolve) => {
        complete = resolve
      })
    })
    const revoke = spyOn(prepare, 'revokeImagePreviewURL').mockImplementation(() => undefined)
    const send = spyOn(target, 'sendMessage')
    const handler = useChatSubmission({
      chat: current,
      ensureChat: async () => target,
      clearFailure: () => undefined,
      getEditor: () => editor,
      useAgentImages: () => true,
      messages,
      reportError: () => undefined,
      openModelSettings: () => undefined,
      openSetup: () => undefined
    })
    try {
      const pending = handler.submit({
        modelText: 'Inspect',
        displayText: 'Inspect',
        nodes: [],
        images: [{ file: new File(['png'], 'card.png'), previewURL: 'blob:card' }]
      })
      await preparing
      if (action === 'cancel') handler.cancel()
      else current.value = fakeChat()
      complete(image)
      expect(await pending).toBe(false)
      expect(target.messages).toEqual([])
      expect(send).not.toHaveBeenCalled()
      expect(revoke).not.toHaveBeenCalled()
    } finally {
      preparation.mockRestore()
      revoke.mockRestore()
      send.mockRestore()
      editor.dispose()
    }
  }
)

function submission(ensureChat: () => Promise<Chat<UIMessage> | null>) {
  const reportError = mock(() => undefined)
  const openSetup = mock(() => undefined)
  const chat = useChatSubmission({
    chat: shallowRef<Chat<UIMessage> | null>(null),
    ensureChat,
    clearFailure: () => undefined,
    getEditor: () => ({}) as EditorStore,
    useAgentImages: () => false,
    messages,
    reportError,
    openModelSettings: () => undefined,
    openSetup
  })
  return { chat, reportError, openSetup }
}

const message = { modelText: 'Draw a card', displayText: 'Draw a card', images: [], nodes: [] }

describe('useChatSubmission', () => {
  test('reports an unsent message so the composer can keep it', async () => {
    const { chat } = submission(async () => null)
    expect(await chat.submit(message)).toBe(false)
  })

  test('names the setup problem that stopped an agent chat and offers guided setup', async () => {
    const { chat, reportError, openSetup } = submission(async () => {
      throw new AgentSetupError('mcp-outdated')
    })
    expect(await chat.submit(message)).toBe(false)
    expect(reportError).toHaveBeenCalledWith('MCP outdated', {
      label: 'Run guided setup',
      run: openSetup
    })
  })

  test('keeps the previews of an unsent message for the composer to take back', async () => {
    const revoke = spyOn(URL, 'revokeObjectURL')
    try {
      const { chat } = submission(async () => null)
      const image = { file: new File(['png'], 'card.png'), previewURL: 'blob:card' }
      expect(await chat.submit({ ...message, images: [image] })).toBe(false)
      expect(revoke).not.toHaveBeenCalled()
    } finally {
      revoke.mockRestore()
    }
  })

  test('hands back a message that failed before reaching the chat', async () => {
    const target = fakeChat()
    const { chat } = submission(async () => target)
    // The editor stand-in cannot snapshot the referenced layer, which fails before sending.
    const node = { id: '1:2', name: 'Card', type: 'FRAME' as const }
    expect(await chat.submit({ ...message, nodes: [node] })).toBe(false)
    expect(target.messages).toEqual([])
  })

  test('takes back a message whose images could not be prepared', async () => {
    const revoke = spyOn(URL, 'revokeObjectURL')
    try {
      const target = fakeChat()
      const { chat } = submission(async () => target)
      const image = { file: new File(['not an image'], 'card.png'), previewURL: 'blob:card' }
      expect(await chat.submit({ ...message, images: [image] })).toBe(false)
      expect(target.messages).toEqual([])
      expect(revoke).not.toHaveBeenCalled()
    } finally {
      revoke.mockRestore()
    }
  })
})

function fakeChat(sendMessage: () => Promise<void> = async () => undefined): Chat<UIMessage> {
  return asDouble<Chat<UIMessage>>({ messages: [], status: 'ready', sendMessage })
}
