import { describe, expect, test } from 'bun:test'

import { getTool, setupToolTest } from '#tests/helpers/tools'

type ExportImageResult = {
  width?: unknown
  height?: unknown
  scale?: unknown
}

function exportImageResult(value: unknown): ExportImageResult {
  return typeof value === 'object' && value !== null ? value : {}
}

describe('export_image tool', () => {
  test('bounds unclipped descendant overflow using the actual raster extent', async () => {
    const { figma } = setupToolTest()
    const frame = figma.createFrame()
    frame.resize(100, 100)
    frame.clipsContent = false
    const child = figma.createRectangle()
    frame.appendChild(child)
    child.x = 9900
    child.resize(100, 100)
    let scale = 0
    figma.exportImage = async (_ids, options) => {
      scale = options.scale ?? 0
      return new Uint8Array([1])
    }
    const result = exportImageResult(
      await getTool('export_image').execute(figma, {
        ids: [frame.id],
        scale: 1,
        maxEdge: 1280
      })
    )
    expect(scale).toBe(0.128)
    expect(result.width).toBe(1280)
    expect(result.height).toBe(13)
  })

  test('bounds model-facing image output by its longest edge without upscaling', async () => {
    const { figma } = setupToolTest()
    const frame = figma.createFrame()
    frame.resize(2560, 1600)
    const calls: Array<{ scale?: number; format?: string }> = []
    figma.exportImage = async (_ids, options) => {
      calls.push(options)
      return new Uint8Array([1, 2, 3])
    }

    const result = exportImageResult(
      await getTool('export_image').execute(figma, {
        ids: [frame.id],
        format: 'PNG',
        scale: 2,
        maxEdge: 1280
      })
    )

    expect(calls).toEqual([{ scale: 0.5, format: 'PNG' }])
    expect(result.width).toBe(1280)
    expect(result.height).toBe(800)
    expect(result.scale).toBe(0.5)
  })

  test('keeps the requested scale when the image already fits', async () => {
    const { figma } = setupToolTest()
    const frame = figma.createFrame()
    frame.resize(640, 400)
    const calls: Array<{ scale?: number; format?: string }> = []
    figma.exportImage = async (_ids, options) => {
      calls.push(options)
      return new Uint8Array([1])
    }

    await getTool('export_image').execute(figma, {
      ids: [frame.id],
      scale: 1,
      maxEdge: 1280
    })

    expect(calls[0]?.scale).toBe(1)
  })
})
