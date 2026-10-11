import { expect, test } from 'bun:test'
import { computed, shallowRef } from 'vue'

import { createEditor } from '@open-pencil/core/editor'
import type { SceneNode } from '@open-pencil/scene-graph'

import { createTypographyActions } from '#vue/controls/typography/actions'

/** Two text layers, the typography actions over a selection, and a font load that waits. */
function setup() {
  const editor = createEditor()
  const page = editor.state.currentPageId
  const first = editor.graph.createNode('TEXT', page, { name: 'First', text: 'a' })
  const second = editor.graph.createNode('TEXT', page, { name: 'Second', text: 'b' })
  const selection = shallowRef<SceneNode[]>([first])
  let resolveLoading: (() => void) | undefined
  const loading = new Promise<void>((resolve) => {
    resolveLoading = resolve
  })
  const finishLoading = () => resolveLoading?.()
  const actions = createTypographyActions({
    editor,
    nodes: computed(() => selection.value),
    activeFormatting: computed(() => []),
    options: { fontLoader: { load: () => loading } }
  })
  return { editor, first, second, selection, actions, finishLoading }
}

test('a weight waits for its face, then changes the layers selected when it was chosen', async () => {
  const { first, second, selection, actions, finishLoading } = setup()
  const applied = actions.setWeight(700)
  expect(first.fontWeight).toBe(400)
  selection.value = [second]
  finishLoading()
  await applied
  expect(first.fontWeight).toBe(700)
  expect(second.fontWeight).toBe(400)
})

test('a later choice wins over an earlier one whose face loads after it', async () => {
  const editor = createEditor()
  const text = editor.graph.createNode('TEXT', editor.state.currentPageId, { text: 'a' })
  const loads = new Map<string, () => void>()
  const actions = createTypographyActions({
    editor,
    nodes: computed(() => [text]),
    activeFormatting: computed(() => []),
    options: {
      fontLoader: {
        load: (family) =>
          new Promise<void>((resolve) => {
            loads.set(family, resolve)
          })
      }
    }
  })
  const slow = actions.setFamily('Roboto')
  const fast = actions.setFamily('Lora')
  loads.get('Lora')?.()
  await fast
  loads.get('Roboto')?.()
  await slow
  expect(text.fontFamily).toBe('Lora')
})

test('a family chosen while loading skips layers deleted in the meantime', async () => {
  const { editor, first, second, selection, actions, finishLoading } = setup()
  selection.value = [first, second]
  const applied = actions.setFamily('Roboto')
  editor.graph.deleteNode(first.id)
  finishLoading()
  await applied
  expect(editor.graph.getNode(second.id)?.fontFamily).toBe('Roboto')
  expect(editor.graph.getNode(first.id)).toBeUndefined()
})
