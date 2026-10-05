import { expect, test } from 'bun:test'

import { buildACPPrompt } from '@/app/ai/acp/prompt'
import { preparedImageFiles } from '@/app/ai/attachment/image/message'

test('prepared composer bytes reach the ACP agent as an image block', () => {
  const data = new Uint8Array([137, 80, 78, 71])
  const files = preparedImageFiles([
    {
      data,
      blob: new Blob([data]),
      mediaType: 'image/png',
      width: 1,
      height: 1,
      originalWidth: 1,
      originalHeight: 1
    }
  ])
  expect(
    buildACPPrompt(
      { id: 'u', role: 'user', parts: [{ type: 'text', text: 'Inspect this' }, ...files] },
      true
    )
  ).toEqual([
    { type: 'text', text: 'Inspect this' },
    { type: 'image', mimeType: 'image/png', data: 'iVBORw==' }
  ])
})
