import type { ContentBlock } from '@agentclientprotocol/sdk'
import type { UIMessage } from 'ai'

import { IMAGE_ATTACHMENT_MEDIA_TYPES } from '@/app/ai/attachment/image/types'

/** Carry the composer's prepared images; never silently turn an image request into text-only. */
export function buildACPPrompt(
  message: UIMessage | undefined,
  supportsImages: boolean,
  context?: string
): ContentBlock[] {
  const prompt: ContentBlock[] = context ? [{ type: 'text', text: context }] : []
  for (const part of message?.parts ?? []) {
    if (part.type === 'text') {
      prompt.push({ type: 'text', text: part.text })
    } else if (part.type === 'file') {
      if (!supportsImages) throw new Error('This agent does not support image attachments.')
      const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(part.url)
      const mimeType = match?.[1]
      const data = match?.[2]
      if (
        !mimeType ||
        !data ||
        mimeType !== part.mediaType ||
        !IMAGE_ATTACHMENT_MEDIA_TYPES.some((type) => type === mimeType)
      ) {
        throw new Error('Invalid image attachment. Attach a prepared PNG, JPEG, or WebP image.')
      }
      prompt.push({ type: 'image', mimeType, data })
    }
  }
  return prompt
}
