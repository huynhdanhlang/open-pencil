import { tryOnScopeDispose } from '@vueuse/core'
import { reactive } from 'vue'

import {
  testProviderConnection,
  type ProviderConnectionTestFailureReason
} from '@/app/ai/chat/connection-test'
import {
  aiModelSettings,
  modelConnectionCredentialStatus,
  resolveModelConnectionAPIKey,
  type AIModelConnection
} from '@/app/ai/models'
import type { CredentialStatus } from '@/app/settings/credentials/types'

import {
  isOnboardingAgent,
  ONBOARDING_SERVER_PROVIDER,
  type OnboardingAccess,
  type PlannedModel
} from './plan'

export type ConnectionTestStatus = 'idle' | 'testing' | 'success' | 'error'

export interface OnboardingConnectionState {
  /** A newly entered key; kept only until it is saved or setup closes. */
  apiKey: string
  customBaseURL: string
  customModelID: string
  keyStatus: CredentialStatus
  test: ConnectionTestStatus
  reason: ProviderConnectionTestFailureReason | null
}

/** Details the person edits while connecting. */
export type OnboardingConnectionPatch = Partial<
  Pick<OnboardingConnectionState, 'apiKey' | 'customBaseURL' | 'customModelID'>
>

/** The configured connection onboarding would reuse; a server is the one with an address. */
export function existingOnboardingConnection(
  providerID: OnboardingAccess
): AIModelConnection | null {
  return (
    aiModelSettings.value.connections.find(
      (connection) =>
        connection.providerID === providerID &&
        (providerID === ONBOARDING_SERVER_PROVIDER) === Boolean(connection.customBaseURL)
    ) ?? null
  )
}

interface OnboardingConnectionsOptions {
  plannedModel: (providerID: OnboardingAccess) => PlannedModel | null
}

/** Connection details, saved-key status, and connection tests for the providers being set up. */
export function useOnboardingConnections({ plannedModel }: OnboardingConnectionsOptions) {
  const states = reactive<Partial<Record<OnboardingAccess, OnboardingConnectionState>>>({})
  const testVersions = new Map<OnboardingAccess, number>()
  let disposed = false

  tryOnScopeDispose(() => {
    disposed = true
    clearKeys()
  })

  function clearKeys(): void {
    for (const state of Object.values(states)) state.apiKey = ''
  }

  async function refreshKeyStatus(
    state: OnboardingConnectionState,
    connectionId: string
  ): Promise<void> {
    try {
      const status = await modelConnectionCredentialStatus(connectionId)
      if (!disposed) state.keyStatus = status
    } catch {
      if (!disposed) state.keyStatus = 'unavailable'
    }
  }

  function connection(providerID: OnboardingAccess): OnboardingConnectionState {
    const current = states[providerID]
    if (current) return current
    const existing = existingOnboardingConnection(providerID)
    const server = providerID === ONBOARDING_SERVER_PROVIDER
    const serverProfile =
      server && existing
        ? aiModelSettings.value.models.find((profile) => profile.connectionId === existing.id)
        : undefined
    states[providerID] = {
      apiKey: '',
      customBaseURL: existing?.customBaseURL ?? '',
      customModelID: serverProfile?.customModelID ?? '',
      keyStatus: 'missing',
      test: 'idle',
      reason: null
    }
    const state = states[providerID]
    if (existing && !isOnboardingAgent(providerID)) void refreshKeyStatus(state, existing.id)
    return state
  }

  function ready(providerID: OnboardingAccess): boolean {
    if (isOnboardingAgent(providerID)) return true
    const state = connection(providerID)
    if (state.test === 'success') return true
    return (
      providerID !== ONBOARDING_SERVER_PROVIDER &&
      state.keyStatus === 'configured' &&
      !state.apiKey.trim()
    )
  }

  /** Invalidates a finished or running test after the details it checked change. */
  function resetTest(providerID: OnboardingAccess): void {
    testVersions.set(providerID, (testVersions.get(providerID) ?? 0) + 1)
    const state = connection(providerID)
    state.test = 'idle'
    state.reason = null
  }

  async function testConnection(providerID: OnboardingAccess): Promise<void> {
    const request = (testVersions.get(providerID) ?? 0) + 1
    testVersions.set(providerID, request)
    const state = connection(providerID)
    const current = () => !disposed && testVersions.get(providerID) === request
    state.test = 'testing'
    state.reason = null
    try {
      const existing = existingOnboardingConnection(providerID)
      const savedKey =
        !state.apiKey.trim() && existing ? await resolveModelConnectionAPIKey(existing.id) : null
      if (!current()) return
      const result = await testProviderConnection({
        providerID,
        apiKey: state.apiKey.trim() || savedKey || '',
        modelID: plannedModel(providerID)?.modelID ?? '',
        customModelID: state.customModelID.trim(),
        customBaseURL: state.customBaseURL.trim(),
        customAPIType: 'completions'
      })
      if (!current()) return
      state.test = result.ok ? 'success' : 'error'
      state.reason = result.ok ? null : result.reason
    } catch {
      if (!current()) return
      state.test = 'error'
      state.reason = 'unknown'
    }
  }

  return { connection, ready, resetTest, testConnection, clearKeys }
}
