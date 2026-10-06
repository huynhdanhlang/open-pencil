import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import type {
  Client,
  Agent,
  SessionNotification,
  RequestPermissionRequest,
  RequestPermissionResponse
} from '@agentclientprotocol/sdk'
import type { ChatTransport, FinishReason, UIMessage, UIMessageChunk } from 'ai'

import type { ACPAgentDef } from '@open-pencil/core/constants'

import { assertSnapshotHelperHandshake } from '@/app/ai/agents/policy'
import SYSTEM_PROMPT from '@/app/ai/chat/system-prompt'
import { createMutex } from '@/app/ai/tools/mutex'
import { describeDiagnosticError, recordACPTransportFailure } from '@/app/diagnostics'
import { buildACPMCPServers } from '@/app/integrations/mcp'

import { endReasoning, mapUpdate, textPartId } from './map-update'
import { spawnACPProcess } from './process'
import { buildACPPrompt } from './prompt'

type TauriChild = Awaited<ReturnType<typeof spawnACPProcess>>['child']

interface ACPSession {
  connection: ClientSideConnection
  sessionId: string
  child: TauriChild
  onUpdate: ((params: SessionNotification) => void) | null
  dead: boolean
  supportsImages: boolean
  permissionSignal?: AbortSignal
  cancelPermissions?: () => void
  modelId?: string | null
}

function isMissingCommandError(message: string): boolean {
  const normalized = message.toLowerCase()
  return normalized.includes('enoent') || normalized.includes('program not found')
}

function missingCommandMessage(agentDef?: ACPAgentDef): string {
  if (!agentDef) return 'ACP agent CLI is not installed.'
  if (!agentDef.installCommand) {
    return `"${agentDef.command}" is not installed. Install it and restart OpenPencil.`
  }
  return `"${agentDef.command}" is not installed. Install it with: ${agentDef.installCommand}`
}

export function formatConnectionError(e: unknown, agentDef?: ACPAgentDef): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (
    msg.includes('ECONNREFUSED') ||
    msg.includes('fetch failed') ||
    msg.includes('Failed to fetch')
  ) {
    return 'MCP server is not running. Make sure the editor is open.'
  }
  if (msg.includes('timeout') || msg.includes('Timeout') || msg.includes('ETIMEDOUT')) {
    return 'MCP server did not respond in time.'
  }
  if (isMissingCommandError(msg)) {
    return missingCommandMessage(agentDef)
  }
  return msg
}

function startupError(error: unknown, agentDef: ACPAgentDef): Error {
  recordACPTransportFailure({ operation: 'start', ...describeDiagnosticError(error) })
  return new Error(formatConnectionError(error, agentDef))
}

export function buildCrashChunks(
  destroying: boolean,
  textId: string,
  textStarted: boolean
): { chunks: UIMessageChunk[]; shouldNullSession: boolean } {
  if (destroying) return { chunks: [], shouldNullSession: false }
  const chunks: UIMessageChunk[] = []
  if (textStarted) chunks.push({ type: 'text-end', id: textId })
  chunks.push({ type: 'error', errorText: 'Agent process exited unexpectedly.' })
  chunks.push({ type: 'finish-step' })
  chunks.push({ type: 'finish', finishReason: 'error' })
  return { chunks, shouldNullSession: true }
}

export class ACPChatTransport implements ChatTransport<UIMessage> {
  private session: ACPSession | null = null
  private agentDef: ACPAgentDef
  private cwd: string
  private sentContext = false
  private destroying = false
  private acquireRequest = createMutex()
  private startingChild: TauriChild | null = null
  private readonly mode: 'chat' | 'snapshot-helper'
  private readonly instructions: string
  private readonly expectedModel: string | null
  private readonly expectedEffort: string | null

  constructor(options: {
    agentDef: ACPAgentDef
    cwd?: string
    mode?: 'chat' | 'snapshot-helper'
    instructions?: string
    expectedModel?: string | null
    expectedEffort?: string | null
  }) {
    this.agentDef = options.agentDef
    this.cwd = options.cwd ?? '.'
    this.mode = options.mode ?? 'chat'
    this.instructions = options.instructions ?? SYSTEM_PROMPT
    this.expectedModel = options.expectedModel ?? null
    this.expectedEffort =
      options.expectedEffort ?? options.expectedModel?.match(/\[([^\]]+)\]$/)?.[1] ?? null
  }

  getAgentIdentity(): { model: string | null; effort: string | null } {
    const model = this.session?.modelId ?? null
    return { model, effort: model?.match(/\[([^\]]+)\]$/)?.[1] ?? null }
  }

  private processArgs(): string[] {
    return this.mode === 'snapshot-helper'
      ? [
          '--openpencil-snapshot-helper',
          JSON.stringify({ model: this.expectedModel, effort: this.expectedEffort }),
          ...this.agentDef.args
        ]
      : this.agentDef.args
  }

  private processCommand(): string {
    if (this.mode !== 'snapshot-helper') return this.agentDef.command
    if (this.agentDef.command !== 'codex-acp') {
      throw new Error(
        'unsupported_helper_boundary: snapshot helpers require the configured Codex adapter'
      )
    }
    return 'codex-acp-snapshot-helper'
  }

  private async mcpServers() {
    if (this.mode === 'snapshot-helper') return []
    const { getAutomationAuthToken } = await import('@/app/automation/mcp/spawn')
    return buildACPMCPServers({ authorizationToken: await getAutomationAuthToken() })
  }

  private checkHelperSession(
    session: Awaited<ReturnType<ClientSideConnection['newSession']>>
  ): void {
    if (this.mode !== 'snapshot-helper') return
    if (session.modes?.currentModeId !== 'read-only')
      throw new Error('unsupported_helper_boundary: helper must remain read-only')
    if (
      this.expectedModel &&
      this.expectedModel !== 'default' &&
      session.models?.currentModelId.split('[')[0] !== this.expectedModel.split('[')[0]
    ) {
      throw new Error(
        'configured_model_mismatch: helper adapter selected a different configured model'
      )
    }
    if (
      this.expectedEffort &&
      session.models?.currentModelId.match(/\[([^\]]+)\]$/)?.[1] !== this.expectedEffort
    )
      throw new Error(
        'configured_effort_mismatch: helper adapter selected a different reasoning effort'
      )
  }

  private assertOpen(): void {
    if (this.destroying) throw new Error('Agent session is closed.')
  }

  async sendMessages({
    messages,
    abortSignal
  }: Parameters<ChatTransport<UIMessage>['sendMessages']>[0]): Promise<
    ReadableStream<UIMessageChunk>
  > {
    abortSignal?.throwIfAborted()
    const release = await this.acquireRequest()
    try {
      abortSignal?.throwIfAborted()
      this.assertOpen()
      const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')

      if (this.session?.dead) {
        this.session = null
      }

      if (!this.session) {
        this.session = await this.spawnAgent(abortSignal)
        this.sentContext = false
      }

      abortSignal?.throwIfAborted()
      this.assertOpen()
      const prompt = buildACPPrompt(
        lastUserMessage,
        this.session.supportsImages,
        this.sentContext ? undefined : this.instructions
      )

      const { connection, sessionId } = this.session
      const session = this.session

      let cancelStream: () => void = () => undefined
      return new ReadableStream<UIMessageChunk>({
        start: (controller) => {
          const textId = `text-${Date.now()}`
          let textStarted = false
          const reasoning = { active: false, segment: 0 }
          let closed = false
          let settled = false
          let cancelTimer: ReturnType<typeof setTimeout> | undefined
          const permissions = new AbortController()
          session.permissionSignal = permissions.signal
          session.cancelPermissions = () => permissions.abort()

          function finish(reason: FinishReason, errorText?: string) {
            if (closed) return
            closed = true
            if (errorText) controller.enqueue({ type: 'error', errorText })
            for (const chunk of endReasoning(textId, reasoning)) controller.enqueue(chunk)
            if (textStarted)
              controller.enqueue({ type: 'text-end', id: textPartId(textId, reasoning) })
            controller.enqueue({ type: 'finish-step' })
            controller.enqueue({ type: 'finish', finishReason: reason })
            session.onUpdate = null
            permissions.abort()
            abortSignal?.removeEventListener('abort', onAbort)
            controller.close()
          }

          const cancelAgent = () => {
            const terminate = async () => {
              if (settled) return
              session.dead = true
              await session.child.kill().catch((error) => {
                this.destroying = true
                recordACPTransportFailure({
                  operation: 'message',
                  ...describeDiagnosticError(error)
                })
              })
              release()
            }
            // A stalled cancel must not leave the next message waiting on the old process.
            cancelTimer ??= setTimeout(() => void terminate(), 5000)
            void connection.cancel({ sessionId }).catch(() => void terminate())
          }
          function onAbort() {
            cancelAgent()
            finish('stop')
          }
          cancelStream = () => {
            closed = true
            session.onUpdate = null
            permissions.abort()
            abortSignal?.removeEventListener('abort', onAbort)
            cancelAgent()
          }

          session.onUpdate = (params) => {
            if (closed) return
            const result = mapUpdate(params.update, textId, textStarted, reasoning)
            for (const chunk of result.chunks) {
              controller.enqueue(chunk)
            }
            textStarted = result.textStarted
          }

          abortSignal?.addEventListener('abort', onAbort, { once: true })

          controller.enqueue({ type: 'start' })
          controller.enqueue({ type: 'start-step' })

          void connection
            .prompt({
              sessionId,
              prompt
            })
            .then(({ stopReason }) => {
              if (!closed && this.session === session && stopReason !== 'cancelled')
                this.sentContext = true
              let reason: FinishReason = 'stop'
              if (stopReason === 'max_tokens') reason = 'length'
              else if (stopReason === 'refusal') reason = 'content-filter'
              else if (stopReason === 'max_turn_requests') reason = 'other'
              return finish(reason)
            })
            .catch((e) => {
              if (abortSignal?.aborted) {
                finish('stop')
                return
              }
              recordACPTransportFailure({
                operation: 'message',
                ...describeDiagnosticError(e)
              })
              finish('error', formatConnectionError(e, this.agentDef))
            })
            .finally(() => {
              settled = true
              clearTimeout(cancelTimer)
              release()
            })
        },
        cancel: () => {
          cancelStream()
        }
      })
    } catch (error) {
      release()
      throw error
    }
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null
  }

  async destroy(): Promise<void> {
    this.destroying = true
    if (this.session) {
      this.session.cancelPermissions?.()
      await this.session.child.kill()
      this.session = null
    } else if (this.startingChild) {
      await this.startingChild.kill()
    }
  }

  private processClosed(session: ACPSession | null): void {
    if (!session) return
    session.dead = true
    if (this.session === session) this.session = null
  }

  private async spawnAgent(abortSignal?: AbortSignal): Promise<ACPSession> {
    let ownedSession: ACPSession | null = null
    let process: Awaited<ReturnType<typeof spawnACPProcess>>
    try {
      process = await spawnACPProcess({
        command: this.processCommand(),
        args: this.processArgs(),
        logId: this.agentDef.id,
        destroying: () => this.destroying,
        onUnexpectedClose: () => this.processClosed(ownedSession)
      })
    } catch (e) {
      recordACPTransportFailure({ operation: 'start', ...describeDiagnosticError(e) })
      throw new Error(formatConnectionError(e, this.agentDef))
    }
    const { child, input, output } = process
    this.startingChild = child
    if (this.destroying || abortSignal?.aborted) {
      await child.kill()
      this.startingChild = null
      abortSignal?.throwIfAborted()
      throw new Error('Agent session is closed.')
    }
    const onAbort = () => void child.kill().catch(() => undefined)
    abortSignal?.addEventListener('abort', onAbort, { once: true })
    try {
      const stream = ndJsonStream(input, output)
      let onUpdate: ACPSession['onUpdate'] = null
      const permissionTools = new Map<string, RequestPermissionRequest['toolCall']>()
      const snapshotHelper = this.mode === 'snapshot-helper'

      const clientImpl: Client = {
        async requestPermission(
          params: RequestPermissionRequest
        ): Promise<RequestPermissionResponse> {
          if (snapshotHelper) return { outcome: { outcome: 'cancelled' } }
          const { requestPermissionFromUser, permissionWithToolContext } =
            await import('@/app/ai/acp/permission')
          const known = permissionTools.get(params.toolCall.toolCallId)
          return requestPermissionFromUser(
            permissionWithToolContext(params, known),
            ownedSession?.permissionSignal
          )
        },

        async sessionUpdate(params: SessionNotification): Promise<void> {
          const update = params.update
          if (update.sessionUpdate === 'tool_call') {
            permissionTools.set(update.toolCallId, {
              toolCallId: update.toolCallId,
              title: update.title,
              rawInput: update.rawInput
            })
          } else if (
            update.sessionUpdate === 'tool_call_update' &&
            (update.status === 'completed' || update.status === 'failed')
          ) {
            permissionTools.delete(update.toolCallId)
          }
          onUpdate?.(params)
        }
      }

      const connection = new ClientSideConnection((_agent: Agent) => clientImpl, stream)
      let supportsImages = false
      const initialized = await connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {}
      })
      if (snapshotHelper) assertSnapshotHelperHandshake(initialized)
      supportsImages = initialized.agentCapabilities?.promptCapabilities?.image ?? false

      const sessionResult = await connection.newSession({
        cwd: this.cwd,
        mcpServers: await this.mcpServers()
      })
      this.checkHelperSession(sessionResult)

      const session: ACPSession = {
        connection,
        sessionId: sessionResult.sessionId,
        child,
        dead: false,
        supportsImages,
        modelId: sessionResult.models?.currentModelId ?? null,
        get onUpdate() {
          return onUpdate
        },
        set onUpdate(fn) {
          onUpdate = fn
        }
      }

      abortSignal?.throwIfAborted()
      this.assertOpen()
      ownedSession = session
      return session
    } catch (e) {
      await child.kill().catch(() => undefined)
      abortSignal?.throwIfAborted()
      throw startupError(e, this.agentDef)
    } finally {
      abortSignal?.removeEventListener('abort', onAbort)
      if (this.startingChild === child) this.startingChild = null
    }
  }
}
