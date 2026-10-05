import { recordDiagnostic } from '@/app/diagnostics/recorder'

import { createAgentTaskJournal } from './journal'
import { runCodexHelper } from './runner'
import { AgentTaskService } from './service'

let service: AgentTaskService | undefined
export function getAgentTaskService(): AgentTaskService {
  if (service) return service
  service = new AgentTaskService({
    journal: createAgentTaskJournal(),
    run: runCodexHelper,
    event: (name, receipt) => {
      recordDiagnostic({
        name: 'tool.completed',
        category: 'ai',
        level:
          name === 'helper.persistence_failed' || receipt.status === 'failed' ? 'error' : 'info',
        runId: receipt.task_id,
        attributes: {
          tool: name,
          status: receipt.status,
          provider: receipt.provider,
          model: receipt.actual_model,
          errorCode: receipt.error?.code ?? null
        }
      })
    }
  })
  return service
}
