import { expect, test } from 'bun:test'

import { exportFigFile, initCodec, parseFigFile } from '@open-pencil/core'

import { createEditor, executeAtomicTool } from '#core/editor'
import { FigmaAPI } from '#core/figma-api'
import { updateNode } from '#core/tools/modify/update'

test.each(['editor', 'atomic'] as const)(
  'an imported Hug frame saves constrained movement through %s Undo',
  async (mode) => {
    await initCodec()
    const editor = createEditor()
    const { graph } = editor
    const frame = graph.createNode('FRAME', editor.state.currentPageId, {
      name: 'Button',
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'HUG',
      paddingLeft: 16,
      paddingRight: 16,
      paddingTop: 12,
      paddingBottom: 12
    })
    graph.createNode('RECTANGLE', frame.id, { name: 'Label', width: 60, height: 24 })
    editor.runLayoutForNode(frame.id)
    graph.createNode('FRAME', frame.id, {
      name: 'Badge',
      x: 84,
      y: -8,
      width: 24,
      height: 24,
      layoutPositioning: 'ABSOLUTE',
      horizontalConstraint: 'MAX'
    })
    const imported = await parseFigFile((await exportFigFile(graph)).slice().buffer)
    editor.replaceGraph(imported)
    const find = (name: string) => {
      const node = [...editor.graph.nodes.values()].find((item) => item.name === name)
      if (!node) throw new Error(`Missing ${name}`)
      return node
    }
    const label = find('Label')
    const button = find('Button')
    const badge = find('Badge')
    editor.runLayoutForNode(button.id)
    if (mode === 'atomic')
      executeAtomicTool(editor, new FigmaAPI(editor.graph), updateNode, {
        id: label.id,
        width: 150
      })
    else editor.updateNodeWithUndo(label.id, { width: 150 })
    expect([button.width, badge.x]).toEqual([182, 174])
    const reopened = await parseFigFile((await exportFigFile(editor.graph)).slice().buffer)
    expect([...reopened.nodes.values()].find((node) => node.name === 'Button')?.width).toBe(182)
    expect([...reopened.nodes.values()].find((node) => node.name === 'Badge')?.x).toBe(174)
    editor.undoAction()
    const undone = await parseFigFile((await exportFigFile(editor.graph)).slice().buffer)
    expect([...undone.nodes.values()].find((node) => node.name === 'Badge')?.x).toBe(84)
    editor.redoAction()
    const redone = await parseFigFile((await exportFigFile(editor.graph)).slice().buffer)
    expect([...redone.nodes.values()].find((node) => node.name === 'Badge')?.x).toBe(174)
    editor.dispose()
  }
)
