import 'fake-indexeddb/auto'
import { expect, spyOn, test } from 'bun:test'

import { Chat } from '@ai-sdk/vue'
import type { UIMessage } from 'ai'
import { shallowRef } from 'vue'

import * as analyze from '@/app/ai/attachment/image/analyze'
import * as prepare from '@/app/ai/attachment/image/prepare'
import { useChatSubmission } from '@/app/ai/chat/submission/use'
import { createEditorStore } from '@/app/editor/session/create'

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
    messages: shallowRef({
      openSettings: 'Settings',
      requestFailed: 'Failed',
      visionUnavailable: 'No vision'
    }),
    reportError: (message) => errors.push(message),
    openModelSettings: () => undefined
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
    await pending
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
