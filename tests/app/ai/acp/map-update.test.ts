import { expect, test } from 'bun:test'

import { readUIMessageStream, type UIMessageChunk } from 'ai'

import { mapUpdate } from '@/app/ai/acp/map-update'

test('a streamed thought is one reasoning part and does not obscure the reply', async () => {
  const reasoning = { active: false, segment: 0 }
  const chunks: UIMessageChunk[] = [{ type: 'start' }, { type: 'start-step' }]
  for (let i = 0; i < 16; i++) {
    chunks.push(
      ...mapUpdate(
        { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Thinking. ' } },
        'reply',
        false,
        reasoning
      ).chunks
    )
  }
  chunks.push(
    ...mapUpdate(
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello!' } },
      'reply',
      false,
      reasoning
    ).chunks
  )
  chunks.push(
    { type: 'text-end', id: 'reply' },
    { type: 'finish-step' },
    { type: 'finish', finishReason: 'stop' }
  )
  const stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    }
  })
  const messages = await Array.fromAsync(readUIMessageStream({ stream }))
  const message = messages.at(-1)
  expect(chunks.filter((c) => c.type === 'reasoning-start')).toHaveLength(1)
  expect(chunks.filter((c) => c.type === 'reasoning-end')).toHaveLength(1)
  expect(message?.parts.filter((p) => p.type === 'reasoning')).toHaveLength(1)
  expect(message?.parts.filter((p) => p.type === 'text')).toEqual([
    { type: 'text', text: 'Hello!', state: 'done' }
  ])
})

test('tool boundaries close reasoning and following reasoning uses a fresh ID', () => {
  const state = { active: false, segment: 0 }
  const thought = {
    sessionUpdate: 'agent_thought_chunk' as const,
    content: { type: 'text' as const, text: 'Check.' }
  }
  const first = mapUpdate(thought, 'reply', false, state).chunks
  const tool = mapUpdate(
    { sessionUpdate: 'tool_call', toolCallId: 'inspect', title: 'get_node' },
    'reply',
    false,
    state
  ).chunks
  const second = mapUpdate(thought, 'reply', false, state).chunks
  expect(tool[0]).toEqual({ type: 'reasoning-end', id: 'reasoning-reply-0' })
  expect(first[0]).toEqual({ type: 'reasoning-start', id: 'reasoning-reply-0' })
  expect(second[0]).toEqual({ type: 'reasoning-start', id: 'reasoning-reply-1' })
})

test('empty thought chunks do not create a reasoning card', () => {
  expect(
    mapUpdate(
      { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '' } },
      'reply',
      false,
      { active: false, segment: 0 }
    ).chunks
  ).toEqual([])
})

test('the final reply starts after the tool instead of appending above it', () => {
  const state = { active: false, segment: 0 }
  const first = mapUpdate(
    { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Checking.' } },
    'reply',
    false,
    state
  )
  const tool = mapUpdate(
    { sessionUpdate: 'tool_call', toolCallId: 'inspect', title: 'get_node' },
    'reply',
    first.textStarted,
    state
  )
  expect(tool.textStarted).toBe(false)
  expect(tool.chunks[0]).toEqual({ type: 'text-end', id: 'reply' })
  const final = mapUpdate(
    { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Done.' } },
    'reply',
    tool.textStarted,
    state
  )
  expect(final.chunks).toEqual([
    { type: 'text-start', id: 'reply-1' },
    { type: 'text-delta', id: 'reply-1', delta: 'Done.' }
  ])
})
