import type { SessionUpdate } from '@agentclientprotocol/sdk'
import type { UIMessageChunk } from 'ai'

import type { JSONObject } from '@open-pencil/scene-graph/primitives'

export interface MapResult {
  chunks: UIMessageChunk[]
  textStarted: boolean
}

export interface ACPStreamState {
  active: boolean
  segment: number
  textSegment?: number
}

export function textPartId(textId: string, state: ACPStreamState): string {
  return state.textSegment ? `${textId}-${state.textSegment}` : textId
}

function interruptsText(update: SessionUpdate): boolean {
  if (update.sessionUpdate === 'tool_call') return true
  return (
    update.sessionUpdate === 'agent_thought_chunk' &&
    update.content.type === 'text' &&
    Boolean(update.content.text)
  )
}

function closeInterruptedText(
  update: SessionUpdate,
  textId: string,
  started: boolean,
  state: ACPStreamState
): UIMessageChunk[] {
  if (!started || !interruptsText(update)) return []
  const id = textPartId(textId, state)
  state.textSegment = (state.textSegment ?? 0) + 1
  return [{ type: 'text-end', id }]
}

export function endReasoning(textId: string, state: ACPStreamState): UIMessageChunk[] {
  if (!state.active) return []
  state.active = false
  return [{ type: 'reasoning-end', id: `reasoning-${textId}-${state.segment++}` }]
}

function thoughtChunks(
  update: Extract<SessionUpdate, { sessionUpdate: 'agent_thought_chunk' }>,
  textId: string,
  state: ACPStreamState
): UIMessageChunk[] {
  if (update.content.type !== 'text' || !update.content.text) return []
  const id = `reasoning-${textId}-${state.segment}`
  const chunks: UIMessageChunk[] = []
  if (!state.active) {
    chunks.push({ type: 'reasoning-start', id })
    state.active = true
  }
  chunks.push({ type: 'reasoning-delta', id, delta: update.content.text })
  return chunks
}

export function mapUpdate(
  update: SessionUpdate,
  textId: string,
  textStarted: boolean,
  reasoning: ACPStreamState = { active: false, segment: 0 }
): MapResult {
  const chunks = closeInterruptedText(update, textId, textStarted, reasoning)
  if (chunks.length > 0) textStarted = false

  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      if (update.content.type === 'text' && update.content.text) {
        chunks.push(...endReasoning(textId, reasoning))
        if (!textStarted) {
          chunks.push({ type: 'text-start', id: textPartId(textId, reasoning) })
          textStarted = true
        }
        chunks.push({
          type: 'text-delta',
          id: textPartId(textId, reasoning),
          delta: update.content.text
        })
      } else if (update.content.type !== 'text') {
        console.warn('[ACP] Unhandled content type:', update.content.type)
      }
      break
    }
    case 'agent_thought_chunk': {
      chunks.push(...thoughtChunks(update, textId, reasoning))
      break
    }
    case 'tool_call': {
      chunks.push(...endReasoning(textId, reasoning))
      if (!update.title) {
        console.warn('[ACP] Tool call without title:', update.toolCallId)
      }
      const toolName = update.title || 'unknown'
      chunks.push({
        type: 'tool-input-start',
        toolCallId: update.toolCallId,
        toolName,
        providerExecuted: true,
        title: update.title
      })
      if (update.rawInput) {
        chunks.push({
          type: 'tool-input-available',
          toolCallId: update.toolCallId,
          toolName,
          input: update.rawInput,
          providerExecuted: true,
          title: update.title
        })
      }
      break
    }
    case 'tool_call_update': {
      if (update.status === 'completed') {
        chunks.push({
          type: 'tool-output-available',
          toolCallId: update.toolCallId,
          output: update.rawOutput ?? textFromContent(update.content ?? undefined),
          providerExecuted: true
        })
      } else if (update.status === 'failed') {
        chunks.push({
          type: 'tool-output-error',
          toolCallId: update.toolCallId,
          errorText: textFromContent(update.content ?? undefined) ?? 'Tool call failed',
          providerExecuted: true
        })
      }
      break
    }
  }

  return { chunks, textStarted }
}

export function textFromContent(content: JSONObject[] | undefined): string | undefined {
  if (!content) return undefined
  const parts: string[] = []
  for (const c of content) {
    if (c.type !== 'content') continue
    const inner = c.content as JSONObject | undefined
    if (inner?.type === 'text' && typeof inner.text === 'string') {
      parts.push(inner.text)
    }
  }
  return parts.length > 0 ? parts.join('\n') : undefined
}
