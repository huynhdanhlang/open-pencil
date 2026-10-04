import { describe, expect, test } from 'bun:test'

import { diagnosticsMessages } from '@open-pencil/vue'

import { summarizeDiagnosticEvent } from '@/app/diagnostics'
import type { DiagnosticEvent } from '@/app/diagnostics/types'

function event(fields: Partial<DiagnosticEvent>): DiagnosticEvent {
  return {
    id: 'event',
    timestamp: 0,
    category: 'ai',
    level: 'info',
    name: 'chat.completed',
    attributes: {},
    ...fields
  }
}

const summarize = (fields: Partial<DiagnosticEvent>) =>
  summarizeDiagnosticEvent(event(fields), diagnosticsMessages.get())

describe('diagnostic event summaries', () => {
  test.each([
    [
      {
        name: 'tool.completed',
        attributes: { tool: 'render', durationMs: 161.6, mutates: true, failed: false }
      },
      'Tool: render',
      '162 ms'
    ],
    [
      {
        name: 'tool.completed',
        attributes: { tool: 'eval', durationMs: 3, mutates: true, failed: true }
      },
      'Tool failed: eval',
      '3 ms'
    ],
    [
      {
        name: 'model.step.completed',
        attributes: { model: 'claude', inputTokens: 120, outputTokens: 30 }
      },
      'Model step · claude',
      '120 in · 30 out tokens'
    ],
    [
      {
        name: 'chat.failed',
        level: 'error' as const,
        attributes: { errorName: 'TypeError', message: 'not extensible' }
      },
      'AI chat failed',
      'TypeError: not extensible'
    ],
    [
      {
        name: 'runtime.error',
        category: 'runtime' as const,
        level: 'error' as const,
        attributes: { errorName: 'TypeError', message: 'boom' }
      },
      'Error: TypeError',
      'boom'
    ],
    [{ name: 'preparation.outcome', attributes: {} }, 'preparation.outcome', null]
  ])('%#: %o', (fields, label, detail) => {
    expect(summarize(fields)).toMatchObject({ label, detail })
  })

  test('lists the recorded fields and keeps the stack apart', () => {
    const summary = summarize({
      name: 'runtime.error',
      runId: 'run-1',
      attributes: {
        errorName: 'TypeError',
        message: 'boom',
        stack: 'TypeError: boom\n  at x',
        info: null
      }
    })
    expect(summary.fields).toEqual([
      ['errorName', 'TypeError'],
      ['message', 'boom'],
      ['runId', 'run-1']
    ])
    expect(summary.stack).toBe('TypeError: boom\n  at x')
  })
})
