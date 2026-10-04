import { tryOnScopeDispose } from '@vueuse/core'
import { reactive } from 'vue'

import type { ACPAgentID } from '@open-pencil/core/constants'

import { checkACPAgentInstall, type ACPAgentInstall } from '@/app/ai/acp/install'

import { isOnboardingAgent, type OnboardingAccess } from './plan'

export type AgentInstallStatus = 'checking' | 'unknown' | ACPAgentInstall

/** Checks whether the coding agents being connected, and the MCP server they need, are installed. */
export function useOnboardingAgents() {
  const statuses = reactive<Partial<Record<OnboardingAccess, AgentInstallStatus>>>({})
  const requests = new Map<OnboardingAccess, number>()
  let disposed = false
  tryOnScopeDispose(() => {
    disposed = true
  })

  async function checkAgent(providerID: OnboardingAccess): Promise<void> {
    if (!isOnboardingAgent(providerID)) return
    const request = (requests.get(providerID) ?? 0) + 1
    requests.set(providerID, request)
    statuses[providerID] = 'checking'
    const agentID = providerID.slice('acp:'.length) as ACPAgentID
    const install = await checkACPAgentInstall(agentID).catch(() => null)
    if (disposed || requests.get(providerID) !== request) return
    statuses[providerID] = install ?? 'unknown'
  }

  /** The last result, starting a check the first time an agent is shown. */
  function agentStatus(providerID: OnboardingAccess): AgentInstallStatus {
    const status = statuses[providerID]
    if (status === undefined) void checkAgent(providerID)
    return statuses[providerID] ?? 'checking'
  }

  return { agentStatus, checkAgent }
}
