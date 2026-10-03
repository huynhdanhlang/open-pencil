import { AI_PROVIDERS, type AIProviderID, type ModelOption } from '@open-pencil/core/constants'

import { modelProviderName } from '@/app/ai/models/provider-name'
import type { AIModelCapability } from '@/app/ai/models/types'

/** Roles onboarding asks about; review and fast stay in the advanced settings. */
export const ONBOARDING_GOALS = ['design', 'vision'] as const
export type OnboardingGoal = (typeof ONBOARDING_GOALS)[number]

/** Coding agents that run on this computer and bring their own subscription and model. */
export const ONBOARDING_AGENTS = ['acp:claude-code', 'acp:codex', 'acp:gemini-cli'] as const
/** API accounts, in the order onboarding prefers them when several are available. */
export const ONBOARDING_API_PROVIDERS = ['anthropic', 'openai', 'google', 'openrouter'] as const
/** A local model server or a company proxy that speaks the OpenAI API. */
export const ONBOARDING_SERVER_PROVIDER = 'openai-compatible'
/** One account for models from several vendors, recommended when no API account exists yet. */
export const ONBOARDING_METERED_PROVIDER = 'openrouter'

export type OnboardingAccess =
  | (typeof ONBOARDING_AGENTS)[number]
  | (typeof ONBOARDING_API_PROVIDERS)[number]
  | typeof ONBOARDING_SERVER_PROVIDER

export type OnboardingSpending = 'existing' | 'metered'

export interface OnboardingAnswers {
  goals: OnboardingGoal[]
  access: OnboardingAccess[]
  spending: OnboardingSpending
}

export interface PlannedModel {
  providerID: OnboardingAccess
  /** Catalog model ID; empty when the connection supplies its own model (server, agent). */
  modelID: string
  name: string
  capabilities: AIModelCapability[]
}

export type PlannedVision = PlannedModel | 'design' | null

export interface OnboardingPlan {
  design: PlannedModel | null
  vision: PlannedVision
  /** Providers to connect before the plan can be applied, in the order they are used. */
  connections: OnboardingAccess[]
}

export interface PlanOptions {
  /** Agents run as local processes, so only the desktop app can use them. */
  agentsAvailable: boolean
}

export function isOnboardingAgent(providerID: string): boolean {
  return providerID.startsWith('acp:')
}

function defaultModel(providerID: AIProviderID): ModelOption | null {
  const provider = AI_PROVIDERS.find((definition) => definition.id === providerID)
  return provider?.models.find((model) => model.id === provider.defaultModel) ?? null
}

function plannedModel(providerID: OnboardingAccess): PlannedModel {
  if (isOnboardingAgent(providerID) || providerID === ONBOARDING_SERVER_PROVIDER) {
    return {
      providerID,
      modelID: '',
      name: modelProviderName(providerID),
      capabilities: ['tools']
    }
  }
  const model = defaultModel(providerID)
  return {
    providerID,
    modelID: model?.id ?? '',
    name: model?.name ?? modelProviderName(providerID),
    capabilities: model?.capabilities ? [...model.capabilities] : ['tools']
  }
}

function hasVision(model: PlannedModel): boolean {
  return model.capabilities.includes('vision')
}

function availableAccess(answers: OnboardingAnswers, options: PlanOptions): OnboardingAccess[] {
  return answers.access.filter((access) => options.agentsAvailable || !isOnboardingAgent(access))
}

function planDesign(access: OnboardingAccess[], spending: OnboardingSpending) {
  const preferred: OnboardingAccess[] = [
    ...ONBOARDING_AGENTS,
    ...ONBOARDING_API_PROVIDERS,
    ONBOARDING_SERVER_PROVIDER
  ]
  const existing = preferred.find((providerID) => access.includes(providerID))
  if (existing) return plannedModel(existing)
  return spending === 'metered' ? plannedModel(ONBOARDING_METERED_PROVIDER) : null
}

function planVision(
  design: PlannedModel | null,
  access: OnboardingAccess[],
  spending: OnboardingSpending
): PlannedVision {
  if (design && !isOnboardingAgent(design.providerID) && hasVision(design)) return 'design'
  const existing = ONBOARDING_API_PROVIDERS.map(plannedModel).find(
    (model) => access.includes(model.providerID) && hasVision(model)
  )
  if (existing) return existing
  const metered = plannedModel(ONBOARDING_METERED_PROVIDER)
  return spending === 'metered' && hasVision(metered) ? metered : null
}

/**
 * Proposes models for the roles onboarding covers, preferring access the person already has.
 * Agents choose their own model and cannot review images, so vision falls back to an API model.
 */
export function planOnboarding(answers: OnboardingAnswers, options: PlanOptions): OnboardingPlan {
  const access = availableAccess(answers, options)
  const design = answers.goals.includes('design') ? planDesign(access, answers.spending) : null
  const vision = answers.goals.includes('vision')
    ? planVision(design, access, answers.spending)
    : null
  const connections = [design, vision === 'design' ? null : vision]
    .filter((model) => model !== null)
    .map((model) => model.providerID)
  return { design, vision, connections: [...new Set(connections)] }
}
