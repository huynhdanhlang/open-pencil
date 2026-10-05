import { describe, expect, test } from 'bun:test'

import type { SessionUpdate } from '@agentclientprotocol/sdk'

import type { ACPAgentDef } from '@open-pencil/core/constants'

import { mapUpdate } from '@/app/ai/acp/map-update'
import { ACPChatTransport, formatConnectionError, buildCrashChunks } from '@/app/ai/acp/transport'

const TEXT_ID = 'text-1'

test('a delayed old-process close cannot clear its replacement session', () => {
  const transport = new ACPChatTransport({
    agentDef: { id: 'codex', name: 'Codex', command: 'codex-acp', args: [] }
  })
  const previous = { dead: false }
  const replacement = { dead: false }
  Reflect.set(transport, 'session', replacement)
  Reflect.apply(Reflect.get(transport, 'processClosed'), transport, [previous])
  expect(previous.dead).toBe(true)
  expect(replacement.dead).toBe(false)
  expect(Reflect.get(transport, 'session')).toBe(replacement)
  Reflect.apply(Reflect.get(transport, 'processClosed'), transport, [replacement])
  expect(Reflect.get(transport, 'session')).toBeNull()
})

test('a successful ACP response finishes the UI stream and allows the next turn', async () => {
  const transport = new ACPChatTransport({
    agentDef: { id: 'codex', name: 'Codex', command: 'codex-acp', args: [] }
  })
  const session = {
    sessionId: 'test',
    supportsImages: true,
    dead: false,
    onUpdate: null as ((params: { update: SessionUpdate }) => void) | null,
    child: { write: async () => undefined, kill: async () => undefined },
    connection: {
      prompt: async () => {
        session.onUpdate?.({
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Ready' } }
        })
        return { stopReason: 'end_turn' }
      },
      cancel: async () => undefined
    }
  }
  Reflect.set(transport, 'session', session)
  const stream = await transport.sendMessages({
    trigger: 'submit-message',
    chatId: 'test',
    messageId: undefined,
    abortSignal: undefined,
    messages: [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }]
  })
  const reader = stream.getReader()
  const chunks: unknown[] = []
  const read = async () => {
    for (;;) {
      const r = await reader.read()
      if (r.done) break
      chunks.push(r.value)
    }
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      read(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('ACP stream did not finish')), 500)
      })
    ])
  } finally {
    clearTimeout(timer)
    await reader.cancel()
    reader.releaseLock()
  }
  expect(chunks).toContainEqual({ type: 'finish', finishReason: 'stop' })
  const next = await transport.sendMessages({
    trigger: 'submit-message',
    chatId: 'test',
    messageId: undefined,
    abortSignal: undefined,
    messages: [{ id: 'u2', role: 'user', parts: [{ type: 'text', text: 'Again' }] }]
  })
  expect(await Array.fromAsync(next)).toContainEqual({ type: 'finish', finishReason: 'stop' })
})

test('aborting an active reply cancels the agent and releases the following turn', async () => {
  const transport = new ACPChatTransport({
    agentDef: { id: 'codex', name: 'Codex', command: 'codex-acp', args: [] }
  })
  let complete: (value: { stopReason: string }) => void = () => undefined
  let cancelled = 0
  let prompts = 0
  const session = {
    sessionId: 'test',
    supportsImages: true,
    dead: false,
    onUpdate: null,
    child: { kill: async () => undefined },
    connection: {
      prompt: () =>
        ++prompts === 1
          ? new Promise((resolve) => {
              complete = resolve
            })
          : Promise.resolve({ stopReason: 'end_turn' }),
      cancel: async () => {
        cancelled++
        complete({ stopReason: 'cancelled' })
      }
    }
  }
  Reflect.set(transport, 'session', session)
  const abort = new AbortController()
  const request = {
    trigger: 'submit-message' as const,
    chatId: 'test',
    messageId: undefined,
    abortSignal: undefined,
    messages: [{ id: 'u', role: 'user' as const, parts: [{ type: 'text' as const, text: 'Hi' }] }]
  }
  const stream = await transport.sendMessages({ ...request, abortSignal: abort.signal })
  abort.abort()
  expect(await Array.fromAsync(stream)).toContainEqual({ type: 'finish', finishReason: 'stop' })
  expect(cancelled).toBe(1)
  expect(await Array.fromAsync(await transport.sendMessages(request))).toContainEqual({
    type: 'finish',
    finishReason: 'stop'
  })
  expect(prompts).toBe(2)
})

test('an already cancelled request does not send an ACP prompt', async () => {
  const transport = new ACPChatTransport({
    agentDef: { id: 'codex', name: 'Codex', command: 'codex-acp', args: [] }
  })
  const controller = new AbortController()
  controller.abort()
  await expect(
    transport.sendMessages({
      trigger: 'submit-message',
      chatId: 'test',
      messageId: undefined,
      abortSignal: controller.signal,
      messages: [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }]
    })
  ).rejects.toMatchObject({ name: 'AbortError' })
})

describe('mapUpdate', () => {
  test('agent_message_chunk with non-empty text starts text and emits delta', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'Hello' }
    }
    const result = mapUpdate(update, TEXT_ID, false)
    expect(result.textStarted).toBe(true)
    expect(result.chunks).toEqual([
      { type: 'text-start', id: TEXT_ID },
      { type: 'text-delta', id: TEXT_ID, delta: 'Hello' }
    ])
  })

  test('agent_message_chunk with empty text is skipped', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: '' }
    }
    const result = mapUpdate(update, TEXT_ID, false)
    expect(result.textStarted).toBe(false)
    expect(result.chunks).toEqual([])
  })

  test('subsequent agent_message_chunk does not re-emit text-start', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'world' }
    }
    const result = mapUpdate(update, TEXT_ID, true)
    expect(result.textStarted).toBe(true)
    expect(result.chunks).toEqual([{ type: 'text-delta', id: TEXT_ID, delta: 'world' }])
  })

  test('agent_thought_chunk starts reasoning without finishing a streamed thought', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'thinking...' }
    }
    const result = mapUpdate(update, TEXT_ID, false)
    expect(result.chunks).toHaveLength(2)
    expect(result.chunks[0].type).toBe('reasoning-start')
    expect(result.chunks[1]).toEqual({
      type: 'reasoning-delta',
      id: `reasoning-${TEXT_ID}-0`,
      delta: 'thinking...'
    })
  })

  test('tool_call emits tool-input-start', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'tool_call',
      toolCallId: 'tc-1',
      title: 'create_shape',
      kind: 'edit',
      status: 'pending'
    }
    const result = mapUpdate(update, TEXT_ID, false)
    expect(result.chunks).toEqual([
      {
        type: 'tool-input-start',
        toolCallId: 'tc-1',
        toolName: 'create_shape',
        providerExecuted: true,
        title: 'create_shape'
      }
    ])
  })

  test('tool_call with rawInput emits tool-input-available', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'tool_call',
      toolCallId: 'tc-2',
      title: 'set_fill',
      kind: 'edit',
      status: 'pending',
      rawInput: { id: '1:2', color: '#ff0000' }
    }
    const result = mapUpdate(update, TEXT_ID, false)
    expect(result.chunks).toHaveLength(2)
    expect(result.chunks[1]).toEqual({
      type: 'tool-input-available',
      toolCallId: 'tc-2',
      toolName: 'set_fill',
      input: { id: '1:2', color: '#ff0000' },
      providerExecuted: true,
      title: 'set_fill'
    })
  })

  test('tool_call with empty title falls back to "unknown"', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'tool_call',
      toolCallId: 'tc-3',
      title: '',
      kind: 'other',
      status: 'pending'
    }
    const result = mapUpdate(update, TEXT_ID, false)
    expect(result.chunks[0]).toMatchObject({ toolName: 'unknown' })
  })

  test('tool_call_update completed emits tool-output-available', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc-1',
      status: 'completed',
      rawOutput: { id: '1:5', type: 'RECTANGLE' }
    }
    const result = mapUpdate(update, TEXT_ID, false)
    expect(result.chunks).toEqual([
      {
        type: 'tool-output-available',
        toolCallId: 'tc-1',
        output: { id: '1:5', type: 'RECTANGLE' },
        providerExecuted: true
      }
    ])
  })

  test('tool_call_update failed emits tool-output-error', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc-1',
      status: 'failed',
      content: [{ type: 'content', content: { type: 'text', text: 'Node not found' } }]
    }
    const result = mapUpdate(update, TEXT_ID, false)
    expect(result.chunks).toEqual([
      {
        type: 'tool-output-error',
        toolCallId: 'tc-1',
        errorText: 'Node not found',
        providerExecuted: true
      }
    ])
  })

  test('agent_message_chunk with non-text content produces no chunks', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'agent_message_chunk',
      content: {
        type: 'image',
        mimeType: 'image/png',
        data: '',
        uri: 'https://example.com/img.png'
      }
    }
    const result = mapUpdate(update, TEXT_ID, false)
    expect(result.textStarted).toBe(false)
    expect(result.chunks).toEqual([])
  })

  test('unhandled update type produces no chunks', () => {
    const update = {
      sessionUpdate: 'available_commands_update',
      availableCommands: []
    } as SessionUpdate
    const result = mapUpdate(update, TEXT_ID, false)
    expect(result.chunks).toEqual([])
    expect(result.textStarted).toBe(false)
  })
})

describe('formatConnectionError', () => {
  const claudeAgent: ACPAgentDef = {
    id: 'claude-code',
    name: 'Claude Code',
    command: 'claude-agent-acp',
    args: [],
    installCommand: 'npm i -g @agentclientprotocol/claude-agent-acp'
  }

  test('ECONNREFUSED maps to MCP not running', () => {
    const msg = formatConnectionError(new Error('connect ECONNREFUSED 127.0.0.1:7600'))
    expect(msg).toBe('MCP server is not running. Make sure the editor is open.')
  })

  test('fetch failed maps to MCP not running', () => {
    const msg = formatConnectionError(new Error('fetch failed'))
    expect(msg).toBe('MCP server is not running. Make sure the editor is open.')
  })

  test('timeout maps to timeout message', () => {
    const msg = formatConnectionError(new Error('Request timeout after 30s'))
    expect(msg).toBe('MCP server did not respond in time.')
  })

  test('ENOENT maps to install instructions', () => {
    const msg = formatConnectionError(new Error('spawn claude-agent-acp ENOENT'), claudeAgent)
    expect(msg).toBe(
      '"claude-agent-acp" is not installed. Install it with: npm i -g @agentclientprotocol/claude-agent-acp'
    )
  })

  test('other errors pass through', () => {
    const msg = formatConnectionError(new Error('Something unexpected'))
    expect(msg).toBe('Something unexpected')
  })

  test('non-Error values converted to string', () => {
    const msg = formatConnectionError('raw string error')
    expect(msg).toBe('raw string error')
  })
})

describe('buildCrashChunks', () => {
  test('destroying=true returns empty chunks, no session null', () => {
    const result = buildCrashChunks(true, TEXT_ID, false)
    expect(result.chunks).toEqual([])
    expect(result.shouldNullSession).toBe(false)
  })

  test('destroying=false with no text emits error + finish', () => {
    const result = buildCrashChunks(false, TEXT_ID, false)
    expect(result.shouldNullSession).toBe(true)
    expect(result.chunks).toEqual([
      { type: 'error', errorText: 'Agent process exited unexpectedly.' },
      { type: 'finish-step' },
      { type: 'finish', finishReason: 'error' }
    ])
  })

  test('destroying=false with active text emits text-end before error', () => {
    const result = buildCrashChunks(false, TEXT_ID, true)
    expect(result.shouldNullSession).toBe(true)
    expect(result.chunks[0]).toEqual({ type: 'text-end', id: TEXT_ID })
    expect(result.chunks[1]).toEqual({
      type: 'error',
      errorText: 'Agent process exited unexpectedly.'
    })
  })
})
