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
import { currentOnboardingModels } from './current'
import {
  coversGoals,
  isOnboardingAccess,
  planOnboarding,
  type OnboardingAccess,
  type OnboardingAnswers,
  type PlannedModel
} from './plan'
import { useOnboardingRoles } from './roles'
import { useOnboardingSignIn } from './sign-in'

export type AISetupStep = 'goals' | 'access' | 'spending' | 'connect' | 'review'

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
  const current = currentOnboardingModels(aiModelSettings.value)
  const configured = [current.design, current.vision, current.review, current.fast].filter(
    (model): model is PlannedModel => model !== null && model !== 'design'
  )
  const step = ref<AISetupStep>('goals')
  const busy = ref(false)
  const saveResult = ref<SettingsSaveResult | null>(null)

  const recommended = computed(() => planOnboarding(answers, { agentsAvailable, current }))
  const roles = useOnboardingRoles(recommended, configured)
  const { plan } = roles
  const hasProposal = computed(() => coversGoals(recommended.value, answers.goals))

  /** Pay-as-you-go only matters when the access already selected leaves a goal uncovered. */
  const needsSpending = computed(
    () =>
      !coversGoals(
        planOnboarding({ ...answers, spending: 'existing' }, { agentsAvailable, current }),
        answers.goals
      )
  )
  const steps = computed<AISetupStep[]>(() => [
    'goals',
    'access',
    ...(needsSpending.value ? (['spending'] as const) : []),
    'connect',
    'review'
  ])

  function plannedModel(providerID: OnboardingAccess): PlannedModel | null {
    const { design, vision, review, fast } = recommended.value
    return (
      [design, vision, review, fast].find(
        (model): model is PlannedModel =>
          model !== null && model !== 'design' && model.providerID === providerID
      ) ?? null
    )
  }

  const connections = useOnboardingConnections({ plannedModel })
  const { connection, ready, markKeySaved } = connections
  const signIn = useOnboardingSignIn(connections)

  const canContinue = computed(() => {
    if (step.value === 'goals') return answers.goals.length > 0
    if (step.value === 'connect') {
      return hasProposal.value && recommended.value.connections.every(ready)
    }
    return true
  })

  function next(): void {
    const index = steps.value.indexOf(step.value)
    if (canContinue.value && index < steps.value.length - 1) step.value = steps.value[index + 1]
  }

  /** Returns false on the first step, where going back leaves setup. */
  function back(): boolean {
    const index = steps.value.indexOf(step.value)
    if (index <= 0) return false
    step.value = steps.value[index - 1]
    return true
  }

  async function apply(): Promise<SettingsSaveResult> {
    if (busy.value) return 'failed'
    busy.value = true
    saveResult.value = null
    let persisted = false
    try {
      // Copied first: closing setup clears entered keys while the saves below are pending.
      const keys = plan.value.connections.map(
        (providerID) => [providerID, connection(providerID).apiKey.trim()] as const
      )
      const details = Object.fromEntries(
        plan.value.connections.map((providerID) => {
          const { customBaseURL, customModelID } = connection(providerID)
          return [providerID, { customBaseURL, customModelID }]
        })
      )
      const { settings, connectionIds } = applyOnboardingPlan({
        settings: modelSettingsSnapshot(),
        plan: plan.value,
        details,
        createId: () => crypto.randomUUID()
      })
      replaceAIModelSettings(settings)
      // Applying again is idempotent, so a retry after a credential failure adds nothing.
      persisted = true
      for (const [providerID, key] of keys) {
        const connectionId = connectionIds[providerID]
        if (!key || !connectionId) continue
        await setModelConnectionAPIKey(connectionId, key)
        connection(providerID).apiKey = ''
        markKeySaved(connectionId)
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
    steps,
    recommended,
    plan,
    roles,
    hasProposal,
    busy,
    saveResult,
    canContinue,
    plannedModel,
    ...connections,
    ...signIn,
    next,
    back,
    apply
  }
}
