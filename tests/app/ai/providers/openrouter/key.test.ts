import { describe, expect, test } from 'bun:test'

import {
  fetchOpenRouterKeyInfo,
  OPENROUTER_KEY_INFO_URL,
  OpenRouterKeyError
} from '@/app/ai/providers/openrouter/key'

describe('fetchOpenRouterKeyInfo', () => {
  test('reports the key label and free tier with the key as a bearer token', async () => {
    const requests: { url: string; authorization: string | null }[] = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      requests.push({ url, authorization: new Headers(init?.headers).get('authorization') })
      return Response.json({ data: { label: 'OpenPencil', is_free_tier: true, usage: 0 } })
    }) as typeof fetch
    expect(await fetchOpenRouterKeyInfo('sk-or-v1-test', fetchImpl)).toEqual({
      label: 'OpenPencil',
      freeTier: true
    })
    expect(requests).toEqual([
      { url: OPENROUTER_KEY_INFO_URL, authorization: 'Bearer sk-or-v1-test' }
    ])
  })

  test('rejects a key OpenRouter does not accept', async () => {
    const rejected = (async () =>
      Response.json(
        { error: { code: 401, message: 'Invalid credentials' } },
        { status: 401 }
      )) as typeof fetch
    await expect(fetchOpenRouterKeyInfo('sk-or-bad', rejected)).rejects.toBeInstanceOf(
      OpenRouterKeyError
    )
  })
})
