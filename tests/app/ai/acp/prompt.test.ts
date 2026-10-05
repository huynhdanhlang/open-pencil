import { describe, expect, test } from 'bun:test'

import { buildACPPrompt } from '@/app/ai/acp/prompt'

describe('ACP prompt content', () => {
  test('preserves text and attached image in order, with separate design context', () => {
    expect(
      buildACPPrompt(
        {
          id: 'u',
          role: 'user',
          parts: [
            { type: 'text', text: 'Use this reference' },
            { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AQID' }
          ]
        },
        true,
        'Design context'
      )
    ).toEqual([
      { type: 'text', text: 'Design context' },
      { type: 'text', text: 'Use this reference' },
      { type: 'image', mimeType: 'image/png', data: 'AQID' }
    ])
  })

  test('rejects an image when the agent did not negotiate image support', () => {
    expect(() =>
      buildACPPrompt(
        {
          id: 'u',
          role: 'user',
          parts: [{ type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AQID' }]
        },
        false
      )
    ).toThrow('does not support image')
  })

  test('rejects mismatched or unsupported attachments instead of dropping them', () => {
    expect(() =>
      buildACPPrompt(
        {
          id: 'u',
          role: 'user',
          parts: [{ type: 'file', mediaType: 'image/png', url: 'data:image/jpeg;base64,AQID' }]
        },
        true
      )
    ).toThrow('image attachment')
    expect(() =>
      buildACPPrompt(
        {
          id: 'u',
          role: 'user',
          parts: [
            { type: 'file', mediaType: 'application/pdf', url: 'data:application/pdf;base64,AQID' }
          ]
        },
        true
      )
    ).toThrow('image attachment')
  })
})
