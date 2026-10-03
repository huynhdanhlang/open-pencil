export type Account = 'claude' | 'codex' | 'openrouter' | 'gateway' | 'local'
export type Goal = 'editing' | 'vision' | 'vectors'
export type Spending = 'existing' | 'metered'
export interface SetupAnswers {
  accounts: Account[]
  goals: Goal[]
  spending: Spending
}
export interface ModelRoute {
  id: string
  account: Account
  connection: string
  label: string
  billing: string
  capabilities: Goal[]
}
export interface TaskProposal {
  goal: Goal
  task: string
  route: string
  billing: string
  reason: string
  requires: string | null
  options: ModelRoute[]
}
export const accounts = [
  { value: 'claude', label: 'Claude or Claude Code' },
  { value: 'codex', label: 'ChatGPT or Codex' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'gateway', label: 'Vercel AI Gateway' },
  { value: 'local', label: 'Local model or company server' }
] as const
export const goals = [
  {
    id: 'editing',
    label: 'Create and edit designs',
    description: 'Describe what you want to create or change on the canvas.'
  },
  {
    id: 'vision',
    label: 'Get design feedback',
    description: 'Find issues with spacing, alignment, typography, and visual hierarchy.'
  },
  {
    id: 'vectors',
    label: 'Generate vector artwork',
    description: 'Create editable icons and illustrations from a description.'
  }
] as const
// Fixture capabilities describe the proposed adapter contract, not measured model quality.
export const routes: ModelRoute[] = [
  {
    id: 'claude-agent',
    account: 'claude',
    connection: 'Claude Code',
    label: 'Claude Code — agent-managed model',
    billing: 'Claude Code account',
    capabilities: ['editing']
  },
  {
    id: 'codex-agent',
    account: 'codex',
    connection: 'Codex',
    label: 'Codex — agent-managed model',
    billing: 'Codex account',
    capabilities: ['editing']
  },
  {
    id: 'local-model',
    account: 'local',
    connection: 'Your server',
    label: 'qwen3-coder:30b — your server',
    billing: 'Your server configuration',
    capabilities: ['editing']
  },
  {
    id: 'router-sonnet',
    account: 'openrouter',
    connection: 'OpenRouter',
    label: 'Claude Sonnet 5 — OpenRouter',
    billing: 'OpenRouter credits',
    capabilities: ['editing', 'vision']
  },
  {
    id: 'router-fable',
    account: 'openrouter',
    connection: 'OpenRouter',
    label: 'Claude Fable 5.1 — OpenRouter',
    billing: 'OpenRouter credits',
    capabilities: ['editing', 'vision']
  },
  {
    id: 'gateway-sonnet',
    account: 'gateway',
    connection: 'Vercel AI Gateway',
    label: 'Claude Sonnet 5 — Vercel AI Gateway',
    billing: 'Vercel AI Gateway account',
    capabilities: ['editing', 'vision']
  },
  {
    id: 'gateway-quiver',
    account: 'gateway',
    connection: 'Vercel AI Gateway',
    label: 'QuiverAI — Vercel AI Gateway',
    billing: 'Vercel AI Gateway account',
    capabilities: ['vectors']
  }
]
export function proposeSetup(answers: SetupAnswers): TaskProposal[] {
  return answers.goals.map((goal) => {
    const eligible = routes.filter(
      (route) =>
        route.capabilities.includes(goal) &&
        (answers.accounts.includes(route.account) ||
          (answers.spending === 'metered' && ['openrouter', 'gateway'].includes(route.account)))
    )
    const options = [...eligible].sort(
      (a, b) =>
        Number(answers.accounts.includes(b.account)) - Number(answers.accounts.includes(a.account))
    )
    const first = options.at(0)
    let reason =
      'Your selected access does not cover this task. Add another connection or leave it unassigned.'
    if (first) {
      reason =
        'One model supports canvas edits and image input. OpenRouter provides access through a single API account.'
      if (goal === 'vectors')
        reason =
          'A vector-generation model can create editable artwork through one gateway account.'
      if (answers.accounts.includes(first.account))
        reason =
          'Start with the access you already have. We’ll verify this route before assigning the task.'
    }
    return {
      goal,
      task: goals.find((item) => item.id === goal)?.label ?? goal,
      route: first?.label ?? 'Not assigned',
      billing: first?.billing ?? 'No additional spending',
      requires: first?.connection ?? null,
      options,
      reason
    }
  })
}
