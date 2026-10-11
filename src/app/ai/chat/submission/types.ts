import type { Chat } from '@ai-sdk/vue'
import type { UIMessage } from 'ai'
import type { Ref } from 'vue'

import type { ImageAttachmentDraft } from '@/app/ai/attachment/image/types'
import type { ReferencedNode } from '@/app/ai/chat/context'
import type { SubmissionErrorOptions } from '@/app/ai/chat/submission/errors'
import type { EditorStore } from '@/app/editor/active-store'

export interface ChatSubmission {
  modelText: string
  displayText: string
  images: ImageAttachmentDraft[]
  nodes: ReferencedNode[]
}

/** The part of the AI SDK Chat that submissions drive. */
export type ChatInstance = Pick<
  Chat<UIMessage>,
  'messages' | 'sendMessage' | 'stop' | 'regenerate' | 'status'
>

export interface SubmissionOptions extends SubmissionErrorOptions {
  chat: Ref<ChatInstance | null>
  ensureChat: () => Promise<ChatInstance | null>
  flush?: () => Promise<void>
  clearFailure: () => void
  getEditor: () => EditorStore
  useAgentImages: () => boolean
}
