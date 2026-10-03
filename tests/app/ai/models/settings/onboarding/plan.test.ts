import { describe, expect, test } from 'bun:test'

import { planOnboarding, type OnboardingAnswers } from '@/app/ai/models/settings/onboarding/plan'

const desktop = { agentsAvailable: true }
const browser = { agentsAvailable: false }

function answers(overrides: Partial<OnboardingAnswers>): OnboardingAnswers {
  return { goals: ['design'], access: [], spending: 'existing', ...overrides }
}

describe('planOnboarding', () => {
  test('uses an agent the person already has for design', () => {
    const plan = planOnboarding(answers({ access: ['acp:codex'] }), desktop)
    expect(plan.design).toMatchObject({ providerID: 'acp:codex', modelID: '' })
    expect(plan.connections).toEqual(['acp:codex'])
  })

  test('ignores agents outside the desktop app', () => {
    const plan = planOnboarding(answers({ access: ['acp:claude-code', 'openai'] }), browser)
    expect(plan.design).toMatchObject({ providerID: 'openai', modelID: 'gpt-5.6' })
  })

  test('reuses a vision-capable design model for visual review', () => {
    const plan = planOnboarding(
      answers({ goals: ['design', 'vision'], access: ['anthropic'] }),
      desktop
    )
    expect(plan.design).toMatchObject({ providerID: 'anthropic', modelID: 'claude-sonnet-5' })
    expect(plan.vision).toBe('design')
    expect(plan.connections).toEqual(['anthropic'])
  })

  test('takes visual review from an API account when design runs on an agent', () => {
    const plan = planOnboarding(
      answers({ goals: ['design', 'vision'], access: ['acp:claude-code', 'google'] }),
      desktop
    )
    expect(plan.design).toMatchObject({ providerID: 'acp:claude-code' })
    expect(plan.vision).toMatchObject({ providerID: 'google', modelID: 'gemini-3.8-flash' })
    expect(plan.connections).toEqual(['acp:claude-code', 'google'])
  })

  test('leaves visual review unassigned without pay-as-you-go access', () => {
    const plan = planOnboarding(
      answers({ goals: ['design', 'vision'], access: ['acp:codex'] }),
      desktop
    )
    expect(plan.vision).toBeNull()
    expect(plan.connections).toEqual(['acp:codex'])
  })

  test('recommends OpenRouter when pay-as-you-go is allowed and nothing else covers a role', () => {
    const plan = planOnboarding(
      answers({ goals: ['design', 'vision'], access: ['acp:codex'], spending: 'metered' }),
      desktop
    )
    expect(plan.vision).toMatchObject({ providerID: 'openrouter' })
    expect(planOnboarding(answers({ spending: 'metered' }), browser).design).toMatchObject({
      providerID: 'openrouter',
      modelID: 'anthropic/claude-sonnet-5'
    })
  })

  test('proposes nothing when no access is selected and spending is not allowed', () => {
    const plan = planOnboarding(answers({ goals: ['design', 'vision'] }), desktop)
    expect(plan).toEqual({ design: null, vision: null, connections: [] })
  })

  test('uses a server with a model it names itself and no assumed vision', () => {
    const plan = planOnboarding(
      answers({ goals: ['design', 'vision'], access: ['openai-compatible'] }),
      desktop
    )
    expect(plan.design).toMatchObject({ providerID: 'openai-compatible', modelID: '' })
    expect(plan.vision).toBeNull()
  })

  test('plans only the roles that were asked for', () => {
    const plan = planOnboarding(answers({ goals: ['vision'], access: ['openai'] }), desktop)
    expect(plan.design).toBeNull()
    expect(plan.vision).toMatchObject({ providerID: 'openai' })
  })
})
