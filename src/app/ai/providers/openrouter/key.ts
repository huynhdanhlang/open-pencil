/** Describes the key it is called with, without using credits. */
export const OPENROUTER_KEY_INFO_URL = 'https://openrouter.ai/api/v1/key'

export interface OpenRouterKeyInfo {
  label: string
  /** The account has never bought credits, so only free models will answer. */
  freeTier: boolean
}

export class OpenRouterKeyError extends Error {
  constructor(readonly status: number) {
    super(`OpenRouter rejected the key with status ${status}`)
    this.name = 'OpenRouterKeyError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Checks that OpenRouter accepts a key and reports what it belongs to. */
export async function fetchOpenRouterKeyInfo(
  key: string,
  fetchImpl: typeof fetch = fetch
): Promise<OpenRouterKeyInfo> {
  const response = await fetchImpl(OPENROUTER_KEY_INFO_URL, {
    headers: { authorization: `Bearer ${key}` }
  })
  if (!response.ok) throw new OpenRouterKeyError(response.status)
  const body: unknown = await response.json()
  const data = isRecord(body) && isRecord(body.data) ? body.data : {}
  return {
    label: typeof data.label === 'string' ? data.label : '',
    freeTier: data.is_free_tier === true
  }
}
