import { beforeEach, describe, expect, test } from 'bun:test'

import { diagnostics, recordChatCompleted, recordRuntimeError } from '@/app/diagnostics'
import { recordModelStepCompleted, recordToolCompleted } from '@/app/diagnostics/events/ai'
import { useDiagnosticsSettings } from '@/app/diagnostics/settings'

describe('diagnostics recorder', () => {
  beforeEach(async () => {
    await diagnostics.clear()
  })

  test('records structured events and exports them', async () => {
    recordChatCompleted({ finishReason: 'stop' })

    const events = await diagnostics.list()
    expect(events).toHaveLength(1)
    expect(events[0]?.name).toBe('chat.completed')
    expect(await diagnostics.export()).toContain('chat.completed')
  })

  test('exports correlated AI metadata without transcript or tool payloads', async () => {
    const context = { sessionId: 'conversation-one', runId: 'request-one' }
    const tool = {
      tool: 'create_node',
      durationMs: 5,
      mutates: true,
      failed: false,
      input: 'private tool input',
      output: 'private tool output'
    }
    recordToolCompleted(tool, context)
    recordModelStepCompleted(
      {
        provider: 'openrouter',
        model: 'test',
        inputTokens: 10,
        outputTokens: 2,
        cacheReadTokens: null,
        cacheWriteTokens: null
      },
      context
    )
    recordChatCompleted({ finishReason: 'stop' }, context)
    const events = await diagnostics.list()
    expect(events).toHaveLength(3)
    for (const event of events) {
      expect(event.sessionId).toBe(context.sessionId)
      expect(event.runId).toBe(context.runId)
    }
    const output = await diagnostics.export()
    expect(output).toContain('"cacheReadTokens": null')
    expect(output).not.toContain('private tool')
    expect(output).not.toContain('messages')
  })

  test('disabling diagnostics also disables tool telemetry', async () => {
    const { diagnosticsEnabled } = useDiagnosticsSettings()
    const previous = diagnosticsEnabled.value
    try {
      diagnosticsEnabled.value = false
      recordToolCompleted(
        { tool: 'create_node', durationMs: 5, mutates: true, failed: false },
        { sessionId: 'disabled', runId: 'disabled-run' }
      )
      expect(await diagnostics.list()).toEqual([])
    } finally {
      diagnosticsEnabled.value = previous
    }
  })

  test('clears recorded events', async () => {
    recordChatCompleted({ finishReason: 'stop' })
    await diagnostics.clear()
    expect(await diagnostics.list()).toHaveLength(0)
  })

  test('exposes bounded WASM stacks from memory without transcript or credential content', async () => {
    recordChatCompleted({ finishReason: 'private transcript sentinel' })
    const error = new WebAssembly.RuntimeError('Out of bounds memory access')
    error.stack =
      'RuntimeError: Out of bounds memory access\nwasm-function[17]@[wasm code]\nrender@tauri://localhost/assets/app.js?token=private:8:9'
    recordRuntimeError(error, 'window')
    const status = diagnostics.getRuntimeStatus()
    expect(status.wasmFailures).toHaveLength(1)
    expect(status.wasmFailures[0]).toMatchObject({ kind: 'out-of-bounds', source: 'window' })
    const receipt = JSON.stringify(status)
    expect(receipt).toContain('wasm-function[17]')
    expect(receipt).not.toContain('private')
    expect(receipt).not.toContain('chat.completed')
    const privateMessage = new WebAssembly.RuntimeError('Aborted(private project draft @ local)')
    privateMessage.stack =
      'RuntimeError: Aborted(private project draft @ local)\n    at render (tauri://localhost/assets/app.js:8:9)'
    recordRuntimeError(privateMessage, 'window')
    expect(JSON.stringify(diagnostics.getRuntimeStatus())).not.toContain('private project draft')
    expect(diagnostics.getRuntimeStatus().wasmFailures[0]?.stack).toContain('at render')
    for (let index = 0; index < 8; index++) {
      const next = new WebAssembly.RuntimeError('Aborted(). Build with -sASSERTIONS for more info.')
      next.stack = `wasm-function[${index + 100}]@[wasm code]`
      recordRuntimeError(next, 'rejection')
    }
    expect(diagnostics.getRuntimeStatus().wasmFailures).toHaveLength(5)
    expect(diagnostics.getRuntimeStatus().wasmFailures[0]?.stack).toContain('wasm-function[107]')
    const { diagnosticsEnabled } = useDiagnosticsSettings()
    const previous = diagnosticsEnabled.value
    try {
      diagnosticsEnabled.value = false
      expect(diagnostics.getRuntimeStatus().wasmFailures).toEqual([])
    } finally {
      diagnosticsEnabled.value = previous
    }
  })
})
