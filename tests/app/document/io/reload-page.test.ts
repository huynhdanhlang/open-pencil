import { expect, spyOn, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { BUILTIN_IO_FORMATS, IORegistry, parseFigFile } from '@open-pencil/core/io'
import { SceneGraph } from '@open-pencil/scene-graph'

import { createReloadActions } from '@/app/document/io/read'
import * as reloadSource from '@/app/document/io/reload-source'
import { createEditorPreparationController } from '@/app/editor/preparation/controller'
import { createInitialAppEditorState } from '@/app/editor/session/types'

test('reloading a lazy FIG materializes the restored shown page before publishing it', async () => {
  const source = new SceneGraph()
  const second = source.addPage('Bank')
  source.createNode('RECTANGLE', second.id, { name: 'Retained component content', width: 30 })
  const written = await new IORegistry(BUILTIN_IO_FORMATS).writeDocument('fig', source)
  const bytes = written.data as Uint8Array
  const live = await parseFigFile(bytes.slice().buffer, { populate: 'all' })
  const imported = await parseFigFile(bytes.slice().buffer, { populate: 'first-page' })
  const page = imported.getPages().find((item) => item.name === 'Bank')
  if (!page) throw new Error('Missing copied bank page')
  expect(imported.getChildren(page.id)).toHaveLength(0)
  const state = createInitialAppEditorState(page.id)
  const editor = createEditor({ graph: live, state, skipInitialGraphSetup: true })
  const read = spyOn(reloadSource, 'readReloadSource').mockResolvedValue(imported)
  let saved = 0
  let shownPage = ''
  const stop = editor.onEditorEvent('page:changed', (id) => {
    shownPage = id
  })
  try {
    const { reloadFromDisk } = createReloadActions({
      editor,
      state,
      getFilePath: () => '/owned.fig',
      getFileHandle: () => null,
      markDocumentSaved: () => {
        saved++
      },
      preparationController: createEditorPreparationController(state)
    })
    await reloadFromDisk()
    expect(state.currentPageId).toBe(page.id)
    expect(shownPage).toBe(page.id)
    expect(editor.graph.getChildren(page.id)).toHaveLength(1)
    expect(editor.graph.getChildren(page.id)[0].name).toBe('Retained component content')
    expect(saved).toBe(1)
  } finally {
    stop()
    read.mockRestore()
    editor.dispose()
  }
})
