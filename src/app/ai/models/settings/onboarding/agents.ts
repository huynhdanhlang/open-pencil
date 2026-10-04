import { agentDiscovery, type DetectedAgent } from '@/app/ai/agents/discovery'

import { isOnboardingAgent, type OnboardingAccess } from './plan'

type AgentDiscovery = typeof agentDiscovery

/** What guided setup knows about one coding agent and the MCP server it needs. */
export interface AgentSetupState {
  /** False where agents cannot run, so only manual instructions apply. */
  supported: boolean
  scanning: boolean
  detected: DetectedAgent | null
  /** OpenPencil's MCP server, through which agents reach the canvas. */
  bridge: boolean
  /** npm, which one-click installation runs. */
  npm: boolean
  installingAgent: boolean
  installingBridge: boolean
  error: AgentDiscovery['error']['value']
}

/** Coding agent setup in guided setup, backed by the desktop agent discovery. */
export function useOnboardingAgents(discovery: AgentDiscovery = agentDiscovery) {
  function agentID(providerID: OnboardingAccess) {
    return isOnboardingAgent(providerID) ? providerID.slice('acp:'.length) : null
  }

  function agentSetup(providerID: OnboardingAccess): AgentSetupState {
    const id = agentID(providerID)
    return {
      supported: discovery.supported,
      scanning: discovery.scanning.value,
      detected: discovery.agents.value.find((agent) => agent.definition.id === id) ?? null,
      bridge: discovery.canvasBridgeAvailable.value,
      npm: discovery.npmAvailable.value,
      installingAgent: discovery.installing.value === id,
      installingBridge: discovery.installing.value === 'canvas',
      error: discovery.error.value
    }
  }

  function installAgent(providerID: OnboardingAccess): Promise<void> {
    const detected = agentSetup(providerID).detected
    return detected ? discovery.install(detected.definition.id) : Promise.resolve()
  }

  return {
    agentSetup,
    installAgent,
    refreshAgents: () => discovery.refresh(true),
    setupCanvasBridge: () => discovery.setupCanvasBridge()
  }
}
