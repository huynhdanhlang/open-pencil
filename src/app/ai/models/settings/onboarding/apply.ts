import { AI_PROVIDERS } from '@open-pencil/core/constants'

import type {
  AIModelConnection,
  AIModelProfile,
  AIModelProfileId,
  AIModelSettings
} from '@/app/ai/models/types'

import {
  isOnboardingAgent,
  ONBOARDING_SERVER_PROVIDER,
  type OnboardingAccess,
  type OnboardingGoal,
  type OnboardingPlan,
  type PlannedModel
} from './plan'

const DEFAULT_MAX_OUTPUT_TOKENS = 16_384
/** The profile a fresh install starts with before anything is configured. */
const PLACEHOLDER_PROFILE_ID = 'model-default'

/** Details entered while connecting; only a server needs an address and its own model ID. */
export interface OnboardingConnectionDetails {
  customBaseURL: string
  customModelID: string
}

export interface ApplyOnboardingInput {
  settings: AIModelSettings
  plan: OnboardingPlan
  /** Roles the person answered for; other assignments are left as they are. */
  goals: OnboardingGoal[]
  details: Partial<Record<OnboardingAccess, OnboardingConnectionDetails>>
  createId: () => string
}

export interface ApplyOnboardingResult {
  settings: AIModelSettings
  /** Connection used for each planned provider, so the caller can store its API key. */
  connectionIds: Partial<Record<OnboardingAccess, string>>
}

function effectiveModelID(profile: Pick<AIModelProfile, 'modelID' | 'customModelID'>): string {
  return profile.customModelID || profile.modelID
}

function recommendedMaxOutputTokens(providerID: string, modelID: string): number {
  const provider = AI_PROVIDERS.find((definition) => definition.id === providerID)
  const model = provider?.models.find((candidate) => candidate.id === modelID)
  return model?.recommendedMaxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS
}

function isUnusedPlaceholder(settings: AIModelSettings, profile: AIModelProfile): boolean {
  if (profile.id !== PLACEHOLDER_PROFILE_ID || effectiveModelID(profile)) return false
  const connection = settings.connections.find((candidate) => candidate.id === profile.connectionId)
  if (connection?.providerID !== ONBOARDING_SERVER_PROVIDER || connection.customBaseURL) {
    return false
  }
  return !Object.values(settings.assignments).includes(profile.id)
}

/**
 * Merges a confirmed onboarding plan into the current settings. Matching connections and
 * profiles are reused, and anything configured in the advanced settings is kept.
 */
export function applyOnboardingPlan({
  settings: current,
  plan,
  goals,
  details,
  createId
}: ApplyOnboardingInput): ApplyOnboardingResult {
  const settings = structuredClone(current)
  const connectionIds: ApplyOnboardingResult['connectionIds'] = {}

  function connectionFor(providerID: OnboardingAccess): AIModelConnection {
    const customBaseURL = details[providerID]?.customBaseURL.trim() ?? ''
    const existing = settings.connections.find(
      (connection) =>
        connection.providerID === providerID && connection.customBaseURL === customBaseURL
    )
    const connection = existing ?? {
      id: `connection-${createId()}`,
      providerID,
      customBaseURL,
      customAPIType: 'completions' as const,
      credentialProfileId: ''
    }
    if (!existing) {
      connection.credentialProfileId = connection.id
      settings.connections.push(connection)
    }
    connectionIds[providerID] = connection.id
    return connection
  }

  function profileFor(model: PlannedModel): AIModelProfileId {
    const connection = connectionFor(model.providerID)
    const customModelID = details[model.providerID]?.customModelID.trim() ?? ''
    const wanted = customModelID || model.modelID
    const existing = settings.models.find(
      (profile) => profile.connectionId === connection.id && effectiveModelID(profile) === wanted
    )
    if (existing) return existing.id
    const profile: AIModelProfile = {
      id: `model-${createId()}`,
      name: customModelID || model.name,
      connectionId: connection.id,
      modelID: model.modelID,
      customModelID,
      maxOutputTokens: recommendedMaxOutputTokens(model.providerID, model.modelID),
      thinkingLevel: 'default',
      capabilities: [...model.capabilities]
    }
    settings.models.push(profile)
    return profile.id
  }

  if (goals.includes('design') && plan.design) {
    settings.assignments.design = profileFor(plan.design)
  }
  if (goals.includes('vision')) {
    const { vision } = plan
    settings.assignments.vision =
      vision === null || vision === 'design' ? vision : profileFor(vision)
  }

  const design = settings.models.find((profile) => profile.id === settings.assignments.design)
  const designConnection = settings.connections.find(
    (connection) => connection.id === design?.connectionId
  )
  const designIsAgent =
    !designConnection ||
    isOnboardingAgent(designConnection.providerID) ||
    designConnection.providerID === 'harness:pi'
  // Agents can only take the design role, and vision needs a model that accepts images.
  for (const role of ['review', 'fast', 'vision'] as const) {
    if (settings.assignments[role] !== 'design') continue
    if (designIsAgent || (role === 'vision' && !design?.capabilities.includes('vision'))) {
      settings.assignments[role] = null
    }
  }

  const placeholder = settings.models.find((profile) => isUnusedPlaceholder(settings, profile))
  if (placeholder) {
    settings.models = settings.models.filter((profile) => profile !== placeholder)
    if (!settings.models.some((profile) => profile.connectionId === placeholder.connectionId)) {
      settings.connections = settings.connections.filter(
        (connection) => connection.id !== placeholder.connectionId
      )
    }
  }

  return { settings, connectionIds }
}
