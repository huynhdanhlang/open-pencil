import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { McpServer } from '@modelcontextprotocol/server'

import { FigmaAPI } from '@open-pencil/core/figma-api'
import { ALL_TOOLS } from '@open-pencil/core/tools'
import { SceneGraph } from '@open-pencil/scene-graph'

import { writeToolOutput } from '#mcp/tool/output'
import { registerTools } from '#mcp/tool/registration'

test('truncated legacy JSX cannot overwrite a complete export or create a partial file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openpencil-jsx-output-'))
  try {
    const existing = join(root, 'complete.jsx')
    await writeFile(existing, '<Frame name="Keep" />')
    for (const path of [existing, join(root, 'new.jsx')]) {
      await expect(
        writeToolOutput(
          'get_jsx',
          { jsx: '<Frame', truncated: true, totalLength: 20_000 },
          path,
          root
        )
      ).rejects.toThrow('truncated')
    }
    expect(await readFile(existing, 'utf8')).toBe('<Frame name="Keep" />')
    await expect(readFile(join(root, 'new.jsx'))).rejects.toThrow()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('MCP passes path to the actual Core tool and writes JSX beyond its inline result budget', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openpencil-jsx-mcp-'))
  const graph = new SceneGraph()
  const frame = graph.createNode('FRAME', graph.getPages()[0].id, { name: 'Full export' })
  graph.createNode('TEXT', frame.id, { text: 'Thiết kế đầy đủ. '.repeat(80_000) })
  const api = new FigmaAPI(graph)
  const tool = ALL_TOOLS.find((entry) => entry.name === 'get_jsx')
  if (!tool) throw new Error('get_jsx missing')
  const server = new McpServer({ name: 'jsx-output', version: '1' })
  const client = new Client({ name: 'jsx-reader', version: '1' })
  registerTools(server, {
    policy: { allowEval: false, disabledTools: [] },
    mcpRoot: root,
    sendRPC: async (request) => {
      const payload = request.args as { name: string; args: Record<string, unknown> }
      expect(request.command).toBe('tool')
      expect(payload.name).toBe('get_jsx')
      return { ok: true, result: await tool.execute(api, payload.args) }
    }
  })
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  try {
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    const path = join(root, 'full.jsx')
    const result = await client.callTool({ name: 'get_jsx', arguments: { id: frame.id, path } })
    if (result.isError) throw new Error(JSON.stringify(result.content))
    expect(result.isError).not.toBe(true)
    const bytes = await readFile(path)
    expect(bytes.byteLength).toBeGreaterThan(900_000)
    expect(bytes.toString('utf8').trimEnd()).toEndWith('</Frame>')
    expect(result.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify({ written: path, byteLength: bytes.byteLength }, null, 2)
      }
    ])
  } finally {
    await client.close()
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('complete JSX writes all UTF-8 bytes and reports actual disk length', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openpencil-jsx-output-'))
  try {
    const jsx = `<Text>${'Nội dung '.repeat(2_000)}</Text>`
    const path = join(root, 'complete.jsx')
    const result = await writeToolOutput('get_jsx', { jsx }, path, root)
    expect(await readFile(path, 'utf8')).toBe(jsx)
    expect(result?.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify({ written: path, byteLength: Buffer.byteLength(jsx, 'utf8') }, null, 2)
      }
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
