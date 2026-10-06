import { expect, test } from 'bun:test'
import { once } from 'node:events'

import { WebSocketServer, type WebSocket } from 'ws'

import { connectAutomation } from '@/app/automation/bridge/server'

import { createBrowserRPCBridge } from '#mcp/browser-rpc'

async function waitFor(predicate: () => boolean, timeout = 3500) {
  const start = Date.now()
  while (!predicate() && Date.now() - start < timeout) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return predicate()
}

async function withConnection(
  run: (fixture: {
    sockets: WebSocket[]
    registered: () => number
    disconnect: () => void
    url: string
  }) => Promise<void>
) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await once(server, 'listening')
  const address = server.address()
  if (typeof address === 'string' || !address) throw new Error('Missing test server address')
  const url = `ws://127.0.0.1:${address.port}`
  const bridge = createBrowserRPCBridge({ authToken: 'test-token', onConnectionChange() {} })
  const sockets: WebSocket[] = []
  let registrations = 0
  server.on('connection', (socket) => {
    sockets.push(socket)
    bridge.handleConnection(socket)
    socket.on('message', (data) => {
      if (data.toString().includes('"type":"register"')) registrations++
      bridge.handleMessage(data.toString(), socket)
    })
    socket.on('close', () => bridge.handleClose(socket))
  })
  const getUnusedStore = () => {
    throw new Error('Handshake must not access the editor')
  }
  const connection = connectAutomation(getUnusedStore, 'test-token', url)
  try {
    expect(await waitFor(() => registrations === 1)).toBe(true)
    await run({ sockets, registered: () => registrations, disconnect: connection.disconnect, url })
  } finally {
    connection.disconnect()
    bridge.close()
    for (const socket of sockets) socket.terminate()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

test('a server graceful close reconnects without restarting the editor', async () => {
  await withConnection(async ({ sockets, registered }) => {
    sockets[0].close(1000, 'Server restarting')
    expect(await waitFor(() => registered() === 2)).toBe(true)
  })
}, 7000)

test('intentional disconnect does not reconnect', async () => {
  await withConnection(async ({ disconnect, registered }) => {
    disconnect()
    expect(await waitFor(() => registered() > 1, 2300)).toBe(false)
  })
}, 7000)

test('policy rejection stops reconnect attempts', async () => {
  await withConnection(async ({ sockets, registered }) => {
    sockets[0].close(1008, 'Unauthorized')
    expect(await waitFor(() => registered() > 1, 2300)).toBe(false)
  })
}, 7000)

test('a rejected token cannot replace the connected editor or retry endlessly', async () => {
  await withConnection(async ({ sockets, registered, url }) => {
    const rejected = connectAutomation(
      () => {
        throw new Error('Handshake must not access the editor')
      },
      'wrong-token',
      url
    )
    try {
      expect(await waitFor(() => registered() === 2)).toBe(true)
      expect(await waitFor(() => sockets[1].readyState === sockets[1].CLOSED)).toBe(true)
      expect(sockets[0].readyState).toBe(sockets[0].OPEN)
      expect(await waitFor(() => registered() > 2, 2300)).toBe(false)
    } finally {
      rejected.disconnect()
    }
  })
}, 7000)

test('a replaced editor stays disconnected instead of stealing the new registration', async () => {
  await withConnection(async ({ sockets, registered, url }) => {
    const second = connectAutomation(
      () => {
        throw new Error('Handshake must not access the editor')
      },
      'test-token',
      url
    )
    try {
      expect(await waitFor(() => registered() === 2)).toBe(true)
      expect(await waitFor(() => sockets[0].readyState === sockets[0].CLOSED)).toBe(true)
      expect(await waitFor(() => registered() > 2, 2300)).toBe(false)
    } finally {
      second.disconnect()
    }
  })
}, 7000)
