import { describe, expect, test } from 'bun:test'

import { parseAIModelSettings, type AIModelSettings } from '@/app/ai/models'
import { applyOnboardingPlan } from '@/app/ai/models/settings/onboarding/apply'
import { planOnboarding, type OnboardingAnswers } from '@/app/ai/models/settings/onboarding/plan'

function freshInstall(): AIModelSettings {
  return {
    version: 1,
    connections: [
      {
        id: 'connection-default',
        providerID: 'openai-compatible',
        customBaseURL: '',
        customAPIType: 'completions',
        credentialProfileId: 'default'
      }
    ],
    models: [
      {
        id: 'model-default',
        name: 'Design model',
        connectionId: 'connection-default',
        modelID: '',
        customModelID: '',
        maxOutputTokens: 16_384,
        thinkingLevel: 'default',
        capabilities: ['tools']
      }
    ],
    assignments: { design: 'model-default', review: 'design', fast: 'design', vision: null }
  }
}

function configured(): AIModelSettings {
  return {
    version: 1,
    connections: [
      {
        id: 'connection-anthropic',
        providerID: 'anthropic',
        customBaseURL: '',
        customAPIType: 'completions',
        credentialProfileId: 'connection-anthropic'
      }
    ],
    models: [
      {
        id: 'model-opus',
        name: 'Claude Opus 5',
        connectionId: 'connection-anthropic',
        modelID: 'claude-opus-5',
        customModelID: '',
        maxOutputTokens: 32_000,
        thinkingLevel: 'high',
        capabilities: ['tools', 'vision']
      }
    ],
    assignments: { design: 'model-opus', review: 'model-opus', fast: null, vision: 'design' }
  }
}

function sequentialIds() {
  let next = 0
  return () => `id-${++next}`
}

function apply(
  settings: AIModelSettings,
  answers: OnboardingAnswers,
  details: Parameters<typeof applyOnboardingPlan>[0]['details'] = {}
) {
  return applyOnboardingPlan({
    settings,
    plan: planOnboarding(answers, { agentsAvailable: true }),
    goals: answers.goals,
    details,
    createId: sequentialIds()
  })
}

describe('applyOnboardingPlan', () => {
  test('replaces the empty fresh-install profile with the planned model', () => {
    const { settings, connectionIds } = apply(freshInstall(), {
      goals: ['design', 'vision'],
      access: ['openrouter'],
      spending: 'existing'
    })
    expect(settings.models).toEqual([
      expect.objectContaining({
        id: 'model-id-2',
        connectionId: 'connection-id-1',
        modelID: 'anthropic/claude-sonnet-5',
        capabilities: ['tools', 'vision']
      })
    ])
    expect(settings.connections.map((connection) => connection.id)).toEqual(['connection-id-1'])
    expect(settings.assignments).toEqual({
      design: 'model-id-2',
      review: 'design',
      fast: 'design',
      vision: 'design'
    })
    expect(connectionIds).toEqual({ openrouter: 'connection-id-1' })
  })

  test('produces settings the store accepts unchanged', () => {
    const { settings } = apply(freshInstall(), {
      goals: ['design', 'vision'],
      access: ['acp:claude-code', 'google'],
      spending: 'existing'
    })
    expect(parseAIModelSettings(settings)).toEqual(settings)
  })

  test('clears roles an agent cannot take when design moves to an agent', () => {
    const { settings } = apply(freshInstall(), {
      goals: ['design'],
      access: ['acp:codex'],
      spending: 'existing'
    })
    expect(settings.assignments).toMatchObject({ review: null, fast: null, vision: null })
    expect(parseAIModelSettings(settings)?.assignments).toEqual(settings.assignments)
  })

  test('reuses a matching connection and profile and keeps advanced settings', () => {
    const before = configured()
    const { settings, connectionIds } = apply(before, {
      goals: ['design'],
      access: ['anthropic'],
      spending: 'existing'
    })
    expect(settings.connections).toEqual(before.connections)
    expect(settings.models).toEqual([
      ...before.models,
      expect.objectContaining({ modelID: 'claude-sonnet-5', connectionId: 'connection-anthropic' })
    ])
    expect(settings.assignments.review).toBe('model-opus')
    expect(connectionIds).toEqual({ anthropic: 'connection-anthropic' })

    const again = apply(settings, { goals: ['design'], access: ['anthropic'], spending: 'existing' })
    expect(again.settings).toEqual(settings)
  })

  test('leaves roles that were not asked about as they were', () => {
    const before = configured()
    const { settings } = apply(before, {
      goals: ['vision'],
      access: ['openai'],
      spending: 'existing'
    })
    expect(settings.assignments.design).toBe('model-opus')
    expect(settings.assignments.vision).toMatch(/^model-id-/)
  })

  test('stores the server address and model the person entered', () => {
    const { settings } = apply(
      freshInstall(),
      { goals: ['design'], access: ['openai-compatible'], spending: 'existing' },
      {
        'openai-compatible': {
          customBaseURL: ' http://localhost:11434/v1 ',
          customModelID: 'qwen3-coder:30b'
        }
      }
    )
    expect(settings.connections).toEqual([
      expect.objectContaining({
        providerID: 'openai-compatible',
        customBaseURL: 'http://localhost:11434/v1'
      })
    ])
    expect(settings.models).toEqual([
      expect.objectContaining({ name: 'qwen3-coder:30b', customModelID: 'qwen3-coder:30b' })
    ])
  })
})
