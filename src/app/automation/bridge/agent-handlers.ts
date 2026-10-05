import * as v from 'valibot'

import { agentDispatchSchema, agentTaskIdSchema } from '@open-pencil/core/rpc'

import { getAgentTaskService } from '@/app/ai/agents'
import { captureHelperSnapshot } from '@/app/ai/agents/context'
import { resolveAIModelRole } from '@/app/ai/models/store'
import type { EditorStore } from '@/app/editor/active-store'
import { IS_TAURI } from '@/constants'

import { resolveAutomationTarget } from './target'

export async function handleAgentCommand(
  store: EditorStore,
  command: string,
  args: unknown
): Promise<unknown> {
  if (!IS_TAURI)
    throw new Error(
      'unsupported_helper_boundary: dispatch requires the verified native Codex installation'
    )
  const service = getAgentTaskService()
  if (command === 'agent_status' || command === 'agent_cancel') {
    const { task_id } = v.parse(agentTaskIdSchema, args)
    return {
      ok: true,
      result:
        command === 'agent_status' ? await service.status(task_id) : await service.cancel(task_id)
    }
  }
  const input = v.parse(agentDispatchSchema, args)
  return {
    ok: true,
    result: await service.dispatch(input, async () => {
      const target = resolveAutomationTarget(store, input)
      if (!(await target.store.preparePageNodes(target.pageId)))
        throw new Error('invalid_target: page closed while loading')
      const role = resolveAIModelRole('design')
      if (role?.connection.providerID !== 'acp:codex')
        throw new Error(
          'unsupported_provider: choose Codex as the design model before dispatching a helper'
        )
      let effort: string | null = role.profile.thinkingLevel
      if (effort === 'default') effort = null
      if (effort === 'off') effort = 'none'
      return captureHelperSnapshot(
        target.store.graph,
        { document_id: target.documentId, page_id: target.pageId },
        input.node_ids,
        {
          provider: role.connection.providerID,
          requested_model: role.profile.customModelID || role.profile.modelID || null,
          requested_effort: effort
        }
      )
    })
  }
}
