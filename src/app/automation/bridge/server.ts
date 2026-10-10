/**
 * Browser-side automation handler.
 *
 * Connects to the bridge via WebSocket, receives RPC requests,
 * executes them against the live EditorStore, and sends results back.
 */
import * as v from 'valibot'

import { AUTOMATION_CLOSE_CODES } from '@open-pencil/core/rpc'
import { randomHex } from '@open-pencil/scene-graph/random'

import { endAgentSession, readAgentSession } from '@/app/automation/agents'
import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import { createAutomationCommandHandlers } from '@/app/automation/bridge/handlers'
import type { AutomationRequestContext } from '@/app/automation/bridge/render-admission'
import { isUnknownRecord } from '@/app/automation/bridge/target'
import type { EditorStore } from '@/app/editor/active-store'

/** Requests from the MCP bridge; other message types (such as the register prompt) are ignored. */
const AutomationRequestJSON = v.pipe(
  v.string(),
  v.parseJson(),
  v.union([
    v.object({
      type: v.literal('request'),
      id: v.pipe(v.string(), v.nonEmpty()),
      command: v.string(),
      args: v.optional(v.unknown()),
      deadlineAt: v.optional(v.pipe(v.number(), v.finite()))
    }),
    v.object({ type: v.literal('cancel'), id: v.pipe(v.string(), v.nonEmpty()) })
  ])
)

/**
 * The connections each MCP session's calls came over, across bridges: restarting MCP opens a new
 * bridge while the old socket is still closing, and that close must not end a session the new
 * connection carries, so a session ends only with its last connection.
 */
const sessionSockets = new Map<string, Set<WebSocket>>()

export function connectAutomation(
  getStore: () => EditorStore,
  authToken: string | null = null,
  automationURL = __OPENPENCIL_LOCAL_AUTOMATION_URL__
) {
  const token = authToken ?? randomHex(32)
  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let intentionalDisconnect = false

  const { handleRequest: handleAutomationRequest } =
    createAutomationCommandHandlers(makeFigmaFromStore)

  async function handleRequest(
    context: AutomationRequestContext,
    command: string,
    args: unknown
  ): Promise<unknown> {
    return handleAutomationRequest(getStore(), command, args, context)
  }

  function connect() {
    let socket: WebSocket
    try {
      socket = new WebSocket(automationURL)
      ws = socket
    } catch (e) {
      console.error(
        '[Automation] WebSocket constructor failed:',
        e instanceof Error ? e.message : e
      )
      scheduleReconnect()
      return
    }

    const requests = new Map<string, AbortController>()
    socket.onopen = () => {
      console.debug('[Automation] WebSocket connected to MCP server')
      socket.send(JSON.stringify({ type: 'register', token }))
    }

    socket.onmessage = async (event) => {
      try {
        const parsed = v.safeParse(AutomationRequestJSON, event.data)
        if (!parsed.success) {
          if (parsed.issues.some((issue) => issue.type === 'parse_json'))
            console.warn('Failed to parse WebSocket message:', v.summarize(parsed.issues))
          return
        }
        const msg = parsed.output
        if (msg.type === 'cancel') {
          requests.get(msg.id)?.abort(new Error('Automation request timed out'))
          return
        }
        if (requests.has(msg.id)) return
        const legacyRender =
          msg.command === 'tool' && isUnknownRecord(msg.args) && msg.args.name === 'render'
        const deadlineAt = msg.deadlineAt ?? (legacyRender ? Date.now() + 20_000 : undefined)
        const controller = new AbortController()
        requests.set(msg.id, controller)
        const deadlineTimer =
          deadlineAt === undefined
            ? undefined
            : setTimeout(
                () => controller.abort(new Error('Automation request timed out')),
                Math.max(0, deadlineAt - Date.now())
              )
        const session = isUnknownRecord(msg.args) ? readAgentSession(msg.args.agent) : null
        if (session) {
          const sockets = sessionSockets.get(session.session) ?? new Set<WebSocket>()
          sockets.add(socket)
          sessionSockets.set(session.session, sockets)
        }
        try {
          const result = await handleRequest(
            {
              id: msg.id,
              deadlineAt,
              signal: controller.signal,
              cancel: () => controller.abort(new Error('Design operation cancelled before start')),
              onAccepted: async (target) => {
                if (target && socket.readyState === WebSocket.OPEN)
                  socket.send(JSON.stringify({ type: 'accepted', id: msg.id, target }))
                // Let the acknowledgement leave before synchronous canvas work.
                await new Promise<void>((resolve) => setTimeout(resolve, 0))
              }
            },
            msg.command,
            msg.args
          )
          if (socket.readyState !== WebSocket.OPEN) return
          socket.send(JSON.stringify({ type: 'response', id: msg.id, ...(result as object) }))
        } catch (e) {
          if (socket.readyState !== WebSocket.OPEN) return
          socket.send(
            JSON.stringify({
              type: 'response',
              id: msg.id,
              ok: false,
              error: e instanceof Error ? e.message : String(e)
            })
          )
        } finally {
          clearTimeout(deadlineTimer)
          requests.delete(msg.id)
        }
      } catch (e) {
        console.warn('Failed to parse WebSocket message:', e)
      }
    }

    socket.onclose = (event) => {
      for (const controller of requests.values())
        controller.abort(new Error('Automation connection closed'))
      requests.clear()
      if (ws === socket) ws = null
      // Sessions that reached the app only over this connection cannot any more, so their agents
      // leave; ones that also came another way, such as over a newer connection, stay.
      for (const [id, sockets] of sessionSockets) {
        if (!sockets.delete(socket) || sockets.size > 0) continue
        sessionSockets.delete(id)
        endAgentSession(id)
      }
      if (intentionalDisconnect) return
      console.warn('[Automation] WebSocket closed:', `code=${event.code} reason=${event.reason}`)
      if (
        event.code === AUTOMATION_CLOSE_CODES.unauthorized ||
        event.code === AUTOMATION_CLOSE_CODES.replaced
      )
        return
      scheduleReconnect()
    }

    socket.onerror = (event) => {
      console.warn('[Automation] WebSocket error:', event)
      socket.close()
    }
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(connect, 2000)
  }

  function disconnect() {
    intentionalDisconnect = true
    clearTimeout(reconnectTimer)
    ws?.close()
    ws = null
  }

  connect()
  return { disconnect, token }
}
