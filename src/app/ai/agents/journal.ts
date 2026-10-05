import type { DBSchema } from 'idb'
import * as v from 'valibot'

import {
  agentDispatchSchema,
  agentTaskReceiptSchema,
  HELPER_LIMITS,
  helperTaskTerminal,
  utf8Bytes
} from '@open-pencil/core/rpc'

import { APP_DATABASE_NAMES, defineAppDatabase, openAppDatabase } from '@/app/storage/idb'

import type { AgentTaskJournal, StoredAgentTask } from './types'

const storedSchema = v.object({
  receipt: agentTaskReceiptSchema,
  fingerprint: v.string(),
  input: agentDispatchSchema,
  context: v.pipe(
    v.string(),
    v.check((text) => utf8Bytes(text) <= HELPER_LIMITS.contextBytes)
  ),
  prompt: v.pipe(
    v.string(),
    v.check((text) => utf8Bytes(text) <= HELPER_LIMITS.contextBytes + HELPER_LIMITS.promptBytes)
  )
})
interface AgentDatabase extends DBSchema {
  tasks: { key: string; value: StoredAgentTask; indexes: { request: string } }
}
export function createAgentTaskJournal(
  name: string = APP_DATABASE_NAMES.agentTasks
): AgentTaskJournal {
  const definition = defineAppDatabase<AgentDatabase>({
    name,
    version: 1,
    callbacks: {
      upgrade(db) {
        db.createObjectStore('tasks', { keyPath: 'receipt.task_id' }).createIndex(
          'request',
          'receipt.request_id',
          { unique: true }
        )
      }
    }
  })
  let database: ReturnType<typeof openAppDatabase<AgentDatabase>> | undefined
  const getDatabase = () => (database ??= openAppDatabase(definition))
  const parse = (record: StoredAgentTask | undefined): StoredAgentTask | undefined =>
    record === undefined ? undefined : v.parse(storedSchema, record)
  return {
    async reserve(record) {
      const tx = (await getDatabase()).transaction('tasks', 'readwrite')
      const existing = parse(await tx.store.index('request').get(record.receipt.request_id))
      if (existing) {
        await tx.done
        return existing
      }
      const rows = await tx.store.getAll()
      if (rows.some((row) => !helperTaskTerminal(v.parse(storedSchema, row).receipt.status))) {
        await tx.done
        throw new Error('helper_busy: one dispatched helper is already active')
      }
      const validated = v.parse(storedSchema, record)
      await tx.store.add(validated)
      await tx.done
      return validated
    },
    async findRequest(id) {
      return parse(await (await getDatabase()).getFromIndex('tasks', 'request', id))
    },
    async read(id) {
      return parse(await (await getDatabase()).get('tasks', id))
    },
    async update(record) {
      const tx = (await getDatabase()).transaction('tasks', 'readwrite')
      const existing = parse(await tx.store.get(record.receipt.task_id))
      if (!existing) {
        await tx.done
        throw new Error('task_not_found: helper task expired')
      }
      if (helperTaskTerminal(existing.receipt.status)) {
        await tx.done
        return existing
      }
      const validated = v.parse(storedSchema, record)
      await tx.store.put(validated)
      await tx.done
      return validated
    },
    async recover(now) {
      const tx = (await getDatabase()).transaction('tasks', 'readwrite')
      for (const row of await tx.store.getAll()) {
        const record = v.parse(storedSchema, row)
        if (!helperTaskTerminal(record.receipt.status))
          await tx.store.put({
            ...record,
            receipt: {
              ...record.receipt,
              status: 'interrupted',
              updated_at: new Date(now).toISOString(),
              completed_at: new Date(now).toISOString(),
              error: {
                code: 'interrupted',
                message:
                  'Editor restarted; inference was not retried. Dispatch a new request to retry.'
              }
            }
          })
      }
      await tx.done
    },
    async prune(now) {
      const tx = (await getDatabase()).transaction('tasks', 'readwrite')
      const terminal = (await tx.store.getAll())
        .map((row) => v.parse(storedSchema, row))
        .filter((row) => helperTaskTerminal(row.receipt.status))
        .toSorted((a, b) => b.receipt.updated_at.localeCompare(a.receipt.updated_at))
      for (const [index, row] of terminal.entries()) {
        if (
          index >= HELPER_LIMITS.receipts ||
          now - Date.parse(row.receipt.updated_at) > HELPER_LIMITS.retentionMs
        )
          await tx.store.delete(row.receipt.task_id)
      }
      await tx.done
    }
  }
}
