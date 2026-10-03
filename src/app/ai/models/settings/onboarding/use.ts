import { computed, reactive, ref } from 'vue'

import { IS_TAURI } from '@open-pencil/core/constants'

import { refreshAIProviderStatus } from '@/app/ai/chat/storage'
import {
  aiModelSettings,
  modelSettingsSnapshot,
  replaceAIModelSettings,
  setModelConnectionAPIKey
} from '@/app/ai/models'
import type { SettingsSaveResult } from '@/app/settings/save-result'

import { applyOnboardingPlan } from './apply'
import { existingOnboardingConnection, useOnboardingConnections } from './connections'
import {
  ONBOARDING_AGENTS,
  ONBOARDING_API_PROVIDERS,
  ONBOARDING_SERVER_PROVIDER,
  planOnboarding,
  type OnboardingAccess,
  type OnboardingAnswers,
  type PlannedModel
} from './plan'

export const AI_SETUP_STEPS = ['goals', 'access', 'spending', 'connect', 'review'] as const
export type AISetupStep = (typeof AI_SETUP_STEPS)[number]

const ONBOARDING_ACCESS = new Set<string>([
  ...ONBOARDING_AGENTS,
  ...ONBOARDING_API_PROVIDERS,
  ONBOARDING_SERVER_PROVIDER
])

function isOnboardingAccess(providerID: string): providerID is OnboardingAccess {
  return ONBOARDING_ACCESS.has(providerID)
}

/** Starts from what is already configured, so running setup again adjusts instead of resets. */
function initialAnswers(): OnboardingAnswers {
  const access = aiModelSettings.value.connections
    .map((connection) => connection.providerID)
    .filter(isOnboardingAccess)
    .filter((providerID) => existingOnboardingConnection(providerID))
  return {
    goals: aiModelSettings.value.assignments.vision === null ? ['design'] : ['design', 'vision'],
    access: [...new Set(access)],
    spending: 'existing'
  }
}

interface AIOnboardingOptions {
  /** Agents run as local processes, so only the desktop app offers them. */
  agentsAvailable?: boolean
}

export function useAIOnboarding({ agentsAvailable = IS_TAURI }: AIOnboardingOptions = {}) {
  const answers = reactive<OnboardingAnswers>(initialAnswers())
  const step = ref<AISetupStep>('goals')
  const busy = ref(false)
  const saveResult = ref<SettingsSaveResult | null>(null)

  const plan = computed(() => planOnboarding(answers, { agentsAvailable }))
  const hasProposal = computed(() => plan.value.design !== null || plan.value.vision !== null)

  function plannedModel(providerID: OnboardingAccess): PlannedModel | null {
    const { design, vision } = plan.value
    if (design?.providerID === providerID) return design
    return vision !== null && vision !== 'design' && vision.providerID === providerID
      ? vision
      : null
  }

  const connections = useOnboardingConnections({ plannedModel })
  const { connection, ready } = connections

  const canContinue = computed(() => {
    if (step.value === 'goals') return answers.goals.length > 0
    if (step.value === 'connect') return hasProposal.value && plan.value.connections.every(ready)
    return true
  })

  function next(): void {
    const index = AI_SETUP_STEPS.indexOf(step.value)
    if (canContinue.value && index < AI_SETUP_STEPS.length - 1) {
      step.value = AI_SETUP_STEPS[index + 1]
    }
  }

  /** Returns false on the first step, where going back leaves setup. */
  function back(): boolean {
    const index = AI_SETUP_STEPS.indexOf(step.value)
    if (index === 0) return false
    step.value = AI_SETUP_STEPS[index - 1]
    return true
  }

  async function apply(): Promise<SettingsSaveResult> {
    if (busy.value) return 'failed'
    busy.value = true
    saveResult.value = null
    let persisted = false
    try {
      const details = Object.fromEntries(
        plan.value.connections.map((providerID) => {
          const { customBaseURL, customModelID } = connection(providerID)
          return [providerID, { customBaseURL, customModelID }]
        })
      )
      const { settings, connectionIds } = applyOnboardingPlan({
        settings: modelSettingsSnapshot(),
        plan: plan.value,
        goals: [...answers.goals],
        details,
        createId: () => crypto.randomUUID()
      })
      replaceAIModelSettings(settings)
      // Applying again is idempotent, so a retry after a credential failure adds nothing.
      persisted = true
      for (const providerID of plan.value.connections) {
        const state = connection(providerID)
        const connectionId = connectionIds[providerID]
        if (!state.apiKey.trim() || !connectionId) continue
        await setModelConnectionAPIKey(connectionId, state.apiKey)
        state.apiKey = ''
        state.keyStatus = 'configured'
      }
      await refreshAIProviderStatus()
      saveResult.value = 'saved'
    } catch {
      saveResult.value = persisted ? 'partial' : 'failed'
    } finally {
      busy.value = false
    }
    return saveResult.value
  }

  return {
    agentsAvailable,
    answers,
    step,
    plan,
    hasProposal,
    busy,
    saveResult,
    canContinue,
    plannedModel,
    ...connections,
    next,
    back,
    apply
  }
}
