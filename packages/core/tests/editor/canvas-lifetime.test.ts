import { expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

import { SkiaRenderer } from '@open-pencil/core'
import { createEditor } from '@open-pencil/core/editor'
import { initCanvasKit } from '@open-pencil/core/io'

import { getTextMeasurer } from '#core/layout/text-measurement'

test('closing the newest canvas pane measures text with the surviving renderer', async () => {
  const ck = await initCanvasKit()
  const editor = createEditor()
  const first = new SkiaRenderer(ck, expectDefined(ck.MakeSurface(16, 16)))
  const second = new SkiaRenderer(ck, expectDefined(ck.MakeSurface(16, 16)))
  let secondDestroyed = false
  first.measureTextNode = () => ({ width: 10, height: 12 })
  second.measureTextNode = () => {
    if (secondDestroyed) throw new Error('Destroyed renderer used')
    return { width: 20, height: 12 }
  }
  const node = editor.graph.createNode('TEXT', editor.state.currentPageId, { text: 'Keep editing' })
  try {
    editor.setCanvasKit(ck, first)
    editor.setCanvasKit(ck, second)
    expect(getTextMeasurer()?.(node)?.width).toBe(20)
    editor.removeCanvasRenderer(second)
    second.destroy()
    secondDestroyed = true
    expect(getTextMeasurer()?.(node)?.width).toBe(10)
    editor.removeCanvasRenderer(first)
    expect(getTextMeasurer()).toBeNull()
  } finally {
    editor.dispose()
    if (!secondDestroyed) second.destroy()
    first.destroy()
  }
})
