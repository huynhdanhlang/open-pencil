import { expect, test } from 'bun:test'
import { createServer } from 'node:http'

import { WebSocket, WebSocketServer } from 'ws'

import { createBrowserRPCBridge } from '#mcp/browser-rpc'

test('render deadline and timeout cancellation travel over the authenticated browser connection', async () => {
  const http = createServer()
  const wss = new WebSocketServer({ server: http })
  const bridge = createBrowserRPCBridge({
    authToken: 'owned-test-token',
    onConnectionChange: () => undefined
  })
  wss.on('connection', (socket) => {
    socket.on('message', (raw) => bridge.handleMessage(raw.toString(), socket))
    socket.on('close', () => bridge.handleClose(socket))
    bridge.handleConnection(socket)
  })
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  const address = http.address()
  if (!address || typeof address === 'string') throw new Error('Missing test listener')
  const client = new WebSocket(`ws://127.0.0.1:${address.port}`)
  const messages: Record<string, unknown>[] = []
  client.on('message', (raw) => {
    messages.push(JSON.parse(raw.toString()))
  })
  try {
    await new Promise<void>((resolve) => client.once('open', resolve))
    client.send(JSON.stringify({ type: 'register', token: 'owned-test-token' }))
    for (let i = 0; i < 100 && !bridge.isConnected(); i++) await Bun.sleep(5)
    expect(bridge.isConnected()).toBe(true)
    const started = Date.now()
    await expect(
      bridge.sendRPC({ command: 'tool', args: { name: 'render', args: { jsx: '<Frame />' } } })
    ).rejects.toThrow('Inspect get_runtime_status before retrying')
    for (let i = 0; i < 20 && !messages.some((m) => m.type === 'cancel'); i++) await Bun.sleep(5)
    const request = messages.find((m) => m.type === 'request')
    const cancel = messages.find((m) => m.type === 'cancel')
    expect(request?.deadlineAt).toBeGreaterThanOrEqual(started + 20_000)
    expect(cancel?.id).toBe(request?.id)
    expect(messages.some((m) => m.token === 'owned-test-token')).toBe(false)
  } finally {
    bridge.close()
    client.terminate()
    for (const socket of wss.clients) socket.terminate()
    await new Promise<void>((resolve) => wss.close(() => resolve()))
    await new Promise<void>((resolve) => http.close(() => resolve()))
  }
}, 25_000)
