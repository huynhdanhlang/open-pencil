import { expect, spyOn, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { parseFigFile } from '@open-pencil/core/io/formats/fig'

import { createDocumentSourceActions, createDocumentSourceState } from '@/app/document/io/source'
import { getRecoveryStore } from '@/app/document/recovery'
import { toast } from '@/app/shell/ui'

import { fontManager } from '#core/text/fonts'

import { asDouble } from '#tests/helpers/doubles'

test('Save preserves editable data after a renderer abort, warns despite cleanup failure and can save again', async () => {
  const editor = createEditor()
  const state = Object.assign(editor.state, { documentName: 'Recovery', autosaveEnabled: false })
  const source = createDocumentSourceState()
  let written = new Uint8Array()
  source.setFileHandle(
    asDouble<FileSystemFileHandle>({
      name: 'Recovery.fig',
      createWritable: async () => ({
        write: async (bytes: Uint8Array) => {
          written = bytes.slice()
        },
        close: async () => undefined
      })
    })
  )
  const actions = createDocumentSourceActions({
    ...source,
    editor,
    state,
    stopWatchingFile: () => undefined,
    startWatchingFile: async () => undefined,
    getRenderer: () => null
  })
  const text = editor.graph.createNode('TEXT', state.currentPageId, { text: 'Design survives' })
  const warning = spyOn(toast, 'warning').mockImplementation(() => 1)
  const cleanup = spyOn(getRecoveryStore(), 'remove').mockRejectedValue(new Error('cleanup failed'))
  const provider = spyOn(fontManager, 'providerCanvasKit').mockImplementation(() => {
    // A repaint can advance the scene version during asynchronous preparation.
    state.sceneVersion++
    throw new WebAssembly.RuntimeError('Aborted(). Build with -sASSERTIONS for more info.')
  })
  try {
    expect(actions.hasUnsavedChanges()).toBe(true)
    const version = actions.getPersistenceStatus().contentRevision
    expect(await actions.saveFigFile()).toBe(true)
    expect(source.getSavedVersion()).toBe(version)
    expect(warning).toHaveBeenCalledTimes(1)
    const restored = await parseFigFile(written.slice().buffer)
    expect([...restored.getAllNodes()].some((node) => node.text === 'Design survives')).toBe(true)
    expect(actions.hasUnsavedChanges()).toBe(false)
    let releaseQueue!: () => void
    const queuedEdit = actions.runDocumentOperation(async () => {
      await new Promise<void>((resolve) => {
        releaseQueue = resolve
      })
      editor.graph.updateNode(text.id, { text: 'Queued edit survives' })
    })
    await Promise.resolve()
    const queuedSave = actions.saveFigFile()
    releaseQueue()
    await queuedEdit
    expect(await queuedSave).toBe(true)
    expect(warning).toHaveBeenCalledTimes(2)
    // The captured Save revision cannot clear an edit made before its queued build starts.
    expect(actions.hasUnsavedChanges()).toBe(true)
    const calls = provider.mock.calls.length
    editor.graph.updateNode(text.id, { text: 'Second save works' })
    expect(await actions.saveFigFile()).toBe(true)
    expect(provider).toHaveBeenCalledTimes(calls)
    expect(warning).toHaveBeenCalledTimes(3)
    expect(actions.hasUnsavedChanges()).toBe(false)
    const second = await parseFigFile(written.slice().buffer)
    expect([...second.getAllNodes()].some((node) => node.text === 'Second save works')).toBe(true)
  } finally {
    provider.mockRestore()
    warning.mockRestore()
    cleanup.mockRestore()
    actions.disposeDocumentIO()
    editor.dispose()
  }
})
