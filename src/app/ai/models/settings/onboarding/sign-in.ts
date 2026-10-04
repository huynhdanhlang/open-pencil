import { tryOnScopeDispose } from '@vueuse/core'
import { reactive } from 'vue'

import {
  signInWithOpenRouter,
  type OpenRouterSignIn,
  type OpenRouterSignInFailure,
  type OpenRouterSignInOptions
} from '@/app/ai/providers/openrouter/sign-in'

import type { OnboardingConnectionState } from './connections'
import type { OnboardingAccess } from './plan'

export type OnboardingSignInStatus = 'idle' | 'waiting' | OpenRouterSignInFailure

interface OnboardingSignInOptions {
  connection: (providerID: OnboardingAccess) => OnboardingConnectionState
  resetTest: (providerID: OnboardingAccess) => void
  testConnection: (providerID: OnboardingAccess) => Promise<void>
}

/** Provider sign-in that fills the API key, then tests it like a pasted key. */
export function useOnboardingSignIn({
  connection,
  resetTest,
  testConnection
}: OnboardingSignInOptions) {
  const statuses = reactive<Partial<Record<OnboardingAccess, OnboardingSignInStatus>>>({})
  const attempts = new Map<
    OnboardingAccess,
    { controller: AbortController; sign: OpenRouterSignIn }
  >()

  tryOnScopeDispose(() => {
    for (const { controller } of attempts.values()) controller.abort()
    attempts.clear()
  })

  function signInStatus(providerID: OnboardingAccess): OnboardingSignInStatus {
    return statuses[providerID] ?? 'idle'
  }

  async function complete(providerID: OnboardingAccess, sign: OpenRouterSignIn): Promise<void> {
    const result = await sign.result
    if (attempts.get(providerID)?.sign !== sign) return
    attempts.delete(providerID)
    if (!result.ok) {
      statuses[providerID] = result.reason
      return
    }
    statuses[providerID] = 'idle'
    connection(providerID).apiKey = result.key
    resetTest(providerID)
    await testConnection(providerID)
  }

  /** Call directly from the click that starts sign-in, so the browser allows its popup. */
  function signIn(
    providerID: OnboardingAccess,
    labels: Pick<OpenRouterSignInOptions, 'keyLabel' | 'page'>
  ): void {
    if (providerID !== 'openrouter') return
    attempts.get(providerID)?.controller.abort()
    const controller = new AbortController()
    const sign = signInWithOpenRouter({ ...labels, signal: controller.signal })
    attempts.set(providerID, { controller, sign })
    statuses[providerID] = 'waiting'
    void complete(providerID, sign)
  }

  function reopenSignIn(providerID: OnboardingAccess): void {
    attempts.get(providerID)?.sign.reopen()
  }

  function cancelSignIn(providerID: OnboardingAccess): void {
    attempts.get(providerID)?.controller.abort()
  }

  return { signInStatus, signIn, reopenSignIn, cancelSignIn }
}
