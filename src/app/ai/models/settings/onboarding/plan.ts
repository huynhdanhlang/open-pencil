import { AI_PROVIDERS, type AIProviderID, type ModelOption } from '@open-pencil/core/constants'

import { modelProviderName } from '@/app/ai/models/provider-name'
import type { AIModelCapability, AIModelProfileId } from '@/app/ai/models/types'

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

const ONBOARDING_ACCESS = new Set<string>([
  ...ONBOARDING_AGENTS,
  ...ONBOARDING_API_PROVIDERS,
  ONBOARDING_SERVER_PROVIDER
])

export function isOnboardingAccess(providerID: string): providerID is OnboardingAccess {
  return ONBOARDING_ACCESS.has(providerID)
}

export type OnboardingSpending = 'existing' | 'metered'

export interface OnboardingAnswers {
  goals: OnboardingGoal[]
  access: OnboardingAccess[]
  spending: OnboardingSpending
}

export interface PlannedModel {
  providerID: AIProviderID
  /** Catalog model ID; empty when the connection supplies its own model (server, agent). */
  modelID: string
  name: string
  capabilities: AIModelCapability[]
  /** Set when the plan keeps a model that is already configured. */
  profileId?: AIModelProfileId
}

export type PlannedVision = PlannedModel | 'design' | null

export interface OnboardingPlan {
  design: PlannedModel | null
  vision: PlannedVision
  /** Providers to connect before the plan can be applied, in the order they are used. */
  connections: OnboardingAccess[]
}

/** The models currently assigned to the roles onboarding covers. */
export interface CurrentOnboardingModels {
  design: PlannedModel | null
  vision: PlannedVision
}

export interface PlanOptions {
  /** Agents run as local processes, so only the desktop app can use them. */
  agentsAvailable: boolean
  current?: CurrentOnboardingModels
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

/** A configured model stays while its access is still selected or onboarding cannot offer it. */
function keepable(model: PlannedModel | null, access: OnboardingAccess[]): model is PlannedModel {
  if (!model) return false
  return !isOnboardingAccess(model.providerID) || access.includes(model.providerID)
}

function planDesign(
  access: OnboardingAccess[],
  spending: OnboardingSpending,
  current: PlannedModel | null
) {
  if (keepable(current, access)) return current
  const preferred: OnboardingAccess[] = [
    ...ONBOARDING_AGENTS,
    ...ONBOARDING_API_PROVIDERS,
    ONBOARDING_SERVER_PROVIDER
  ]
  const existing = preferred.find((providerID) => access.includes(providerID))
  if (existing) return plannedModel(existing)
  return spending === 'metered' ? plannedModel(ONBOARDING_METERED_PROVIDER) : null
}

function canInherit(design: PlannedModel | null): boolean {
  return Boolean(design && !isOnboardingAgent(design.providerID) && hasVision(design))
}

function planVision(
  design: PlannedModel | null,
  access: OnboardingAccess[],
  spending: OnboardingSpending,
  current: PlannedVision
): PlannedVision {
  if (current !== null && current !== 'design' && keepable(current, access)) return current
  if (canInherit(design)) return 'design'
  const existing = ONBOARDING_API_PROVIDERS.filter((providerID) => access.includes(providerID))
    .map(plannedModel)
    .find(hasVision)
  if (existing) return existing
  const metered = plannedModel(ONBOARDING_METERED_PROVIDER)
  if (spending === 'metered' && hasVision(metered)) return metered
  // Nothing new covers visual review, so a configured vision model stays as it is; inheriting
  // from a design model that cannot accept images is not possible.
  return current === 'design' ? null : current
}

/**
 * Proposes models for the roles onboarding covers, preferring what is already configured and
 * then access the person already has. Agents choose their own model and cannot review images,
 * so vision falls back to an API model.
 */
export function planOnboarding(answers: OnboardingAnswers, options: PlanOptions): OnboardingPlan {
  const access = availableAccess(answers, options)
  const current = options.current ?? { design: null, vision: null }
  const design = answers.goals.includes('design')
    ? planDesign(access, answers.spending, current.design)
    : null
  const vision = answers.goals.includes('vision')
    ? planVision(design ?? current.design, access, answers.spending, current.vision)
    : null
  const connections = [design, vision === 'design' ? null : vision]
    .filter((model) => model !== null && !model.profileId)
    .map((model) => model?.providerID ?? '')
    .filter(isOnboardingAccess)
  return { design, vision, connections: [...new Set(connections)] }
}
