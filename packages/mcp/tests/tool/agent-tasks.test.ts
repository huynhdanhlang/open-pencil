import { expect, test } from 'bun:test'

import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { McpServer } from '@modelcontextprotocol/server'

import { registerTools } from '#mcp/tool/registration'

async function connect(disabledTools: string[] = []) {
  const requests: Record<string, unknown>[] = []
  const server = new McpServer({ name: 'test', version: '1' })
  registerTools(server, {
    policy: { allowEval: false, disabledTools },
    mcpRoot: null,
    sendRPC: async (request) => {
      requests.push(request)
      return { ok: true, result: { task_id: 'task-test', status: 'queued' } }
    }
  })
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'test-client', version: '1' })
  await client.connect(clientTransport)
  return {
    client,
    requests,
    close: async () => {
      await client.close()
      await server.close()
    }
  }
}

test('MCP exposes real dispatch/status/cancel schemas and forwards explicit scope', async () => {
  const { client, requests, close } = await connect()
  try {
    const names = (await client.listTools()).tools.map((tool) => tool.name)
    expect(names).toContain('agent_dispatch')
    expect(names).toContain('agent_status')
    expect(names).toContain('agent_cancel')
    const arguments_ = {
      request_id: 'review-1',
      prompt: 'Review selected card',
      document_id: 'tab-test',
      page_id: '0:1',
      node_ids: ['0:2']
    }
    const result = await client.callTool({ name: 'agent_dispatch', arguments: arguments_ })
    expect(result.isError).not.toBe(true)
    expect(requests).toEqual([{ command: 'agent_dispatch', args: arguments_ }])
    await client.callTool({ name: 'agent_status', arguments: { task_id: 'task-test' } })
    expect(requests[1]).toEqual({ command: 'agent_status', args: { task_id: 'task-test' } })
  } finally {
    await close()
  }
})

test('disabled helper commands are omitted from MCP tools', async () => {
  const { client, close } = await connect(['agent_dispatch'])
  try {
    expect((await client.listTools()).tools.map((tool) => tool.name)).not.toContain(
      'agent_dispatch'
    )
  } finally {
    await close()
  }
})
