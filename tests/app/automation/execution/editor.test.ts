import { expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'

import { executeWithPageUndo } from '@/app/automation/execution/editor'
import type { EditorStore } from '@/app/editor/active-store'

import { asDouble } from '#tests/helpers/doubles'

test.each(['returned error', 'thrown error'])(
  'grouped page edits roll back on %s without an Undo entry',
  async (failure) => {
    const editor = createEditor()
    const first = editor.state.currentPageId
    const second = editor.graph.addPage('Related').id
    const a = editor.graph.createNode('RECTANGLE', first, { x: 1 })
    const b = editor.graph.createNode('RECTANGLE', second, { x: 2 })
    const before = editor.snapshotPage(first, undefined, [second])
    const entries: unknown[] = []
    const store = asDouble<EditorStore>({
      ...editor,
      pushUndoStep: (entry) => entries.push(entry)
    })
    const run = executeWithPageUndo(
      store,
      first,
      'Agent: diff_apply',
      async () => {
        editor.graph.updateNode(a.id, { x: 10 })
        editor.graph.deleteNode(b.id)
        editor.graph.createNode('RECTANGLE', second)
        if (failure === 'thrown error') throw new Error('Late failure')
        return { error: 'Late failure' }
      },
      undefined,
      { rollbackOnError: true, additionalPageIds: [second] }
    )
    if (failure === 'thrown error') await expect(run).rejects.toThrow('Late failure')
    else expect(await run).toEqual({ error: 'Late failure' })
    expect(editor.snapshotPage(first, undefined, [second])).toEqual(before)
    expect(entries).toHaveLength(0)
    editor.dispose()
  }
)

test('related pages use one Undo entry and both replay directions', async () => {
  const editor = createEditor()
  const first = editor.state.currentPageId
  const second = editor.graph.addPage('Related').id
  const a = editor.graph.createNode('RECTANGLE', first, { x: 1 })
  const b = editor.graph.createNode('RECTANGLE', second, { x: 2 })
  const entries: { forward: () => void; inverse: () => void }[] = []
  const store = asDouble<EditorStore>({ ...editor, pushUndoStep: (entry) => entries.push(entry) })
  await executeWithPageUndo(
    store,
    first,
    'Agent: diff_apply',
    async () => {
      editor.graph.updateNode(a.id, { x: 10 })
      editor.graph.deleteNode(b.id)
      return { applied: 2 }
    },
    undefined,
    { rollbackOnError: true, additionalPageIds: [second] }
  )
  expect(entries).toHaveLength(1)
  entries[0].inverse()
  expect(editor.graph.getNode(a.id)?.x).toBe(1)
  expect(editor.graph.getNode(b.id)?.x).toBe(2)
  entries[0].forward()
  expect(editor.graph.getNode(a.id)?.x).toBe(10)
  expect(editor.graph.getNode(b.id)).toBeUndefined()
  editor.dispose()
})
