import { ACP_AGENTS, IS_TAURI, type ACPAgentID } from '@open-pencil/core/constants'

import { MCP_INSTALL_TARGET } from '@/app/automation/mcp/failure'

/** What a coding agent needs on this computer to edit the canvas. */
export interface ACPAgentInstall {
  /** The agent's ACP executable. */
  agent: boolean
  /** OpenPencil's MCP server, through which agents reach the canvas tools. */
  automation: boolean
}

export const MCP_INSTALL_COMMAND = `npm i -g ${MCP_INSTALL_TARGET}`

/** Looks for an agent and the MCP server on the desktop; `null` where agents cannot run. */
export async function checkACPAgentInstall(agentID: ACPAgentID): Promise<ACPAgentInstall | null> {
  const agent = ACP_AGENTS.find((candidate) => candidate.id === agentID)
  if (!IS_TAURI || !agent) return null
  const { invoke } = await import('@tauri-apps/api/core')
  const [agentFound, automation] = await Promise.all([
    invoke<boolean>('agent_lookup', { command: agent.command }),
    invoke<{ available: boolean }>('mcp_lookup')
  ])
  return { agent: agentFound, automation: automation.available }
}
