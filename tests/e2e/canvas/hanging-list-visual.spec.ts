import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'

const editor = useEditorSetupWithClear('/?test&no-chrome&no-rulers')

test('fixed-height hanging lists preserve their markers and clip lower lines', async () => {
  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('Missing editor')
    const frame = store.graph.createNode('FRAME', store.state.currentPageId, {
      x: 40,
      y: 40,
      width: 720,
      height: 420,
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, visible: true, opacity: 1 }]
    })
    for (const [index, direction] of (['LTR', 'RTL'] as const).entries()) {
      for (const [row, listType] of (['ORDERED', 'UNORDERED'] as const).entries()) {
        store.graph.createNode('TEXT', frame.id, {
          x: 70 + index * 360,
          y: 50 + row * 160,
          width: 200,
          height: 72,
          fontFamily: 'Inter',
          fontSize: 28,
          text: 'Tiếng Việt\nDòng thứ hai\nDòng bị cắt',
          textAutoResize: 'NONE',
          textDirection: direction,
          hangingList: true,
          textParagraphs: Array.from({ length: 3 }, () => ({ listType, indentation: 1 })),
          fills: [
            { type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1, a: 1 }, visible: true, opacity: 1 }
          ]
        })
      }
    }
    store.requestRender()
  })
  expect(await editor.canvas.screenshotCanvasRegion(800, 500)).toMatchSnapshot(
    'hanging-list-fixed-box.png'
  )
})
