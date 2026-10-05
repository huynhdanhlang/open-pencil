import type { Editor, EditorState } from '@open-pencil/core/editor'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'

import { createAutosave } from '@/app/document/autosave'
import { createDocumentChanges } from '@/app/document/io/changes'
import {
  documentNameFromFigPath,
  downloadNameFromPath,
  figDownloadName
} from '@/app/document/io/names'
import { createSaveActions } from '@/app/document/io/save'
import { createDocumentSourceState } from '@/app/document/io/source-state'
import type { DocumentSourceAccess } from '@/app/document/io/types'
import { createDocumentRecovery } from '@/app/document/recovery'
import { recoveryEnabled } from '@/app/document/recovery/preferences'
import { notificationMessages } from '@/app/i18n/notifications'
import type { StorageDocumentBinding } from '@/app/integrations/storage/types'
import { toast } from '@/app/shell/ui'

type DocumentSourceState = EditorState & {
  documentName: string
  autosaveEnabled: boolean
}

export { createDocumentSourceState }

type DocumentSourceOptions = DocumentSourceAccess & {
  editor: Editor
  state: DocumentSourceState
  stopWatchingFile: () => void
  startWatchingFile: () => Promise<void>
  getRenderer: () => Editor['renderer']
}

export function createDocumentSourceActions({
  editor,
  state,
  stopWatchingFile,
  startWatchingFile,
  getFileHandle,
  setFileHandle,
  getFilePath,
  setFilePath,
  getDownloadName,
  setDownloadName,
  getStorageBinding,
  setStorageBinding,
  setSourceIdentity,
  getSavedVersion,
  setSavedVersion,
  setLastWriteTime,
  getRenderer
}: DocumentSourceOptions) {
  const changes = createDocumentChanges(editor)
  let renderingFailed = false
  let rendererIndependentVersion: number | null = null

  async function saveAndTrack(save: () => Promise<boolean>) {
    const revision = changes.capture()
    const saved = await save()
    if (saved) changes.markSaved(revision)
    return saved
  }

  async function buildFigFile() {
    const version = state.sceneVersion
    if (renderingFailed) return buildRendererIndependentFigFile(version)
    const renderer = getRenderer()
    try {
      return await exportFigFile(
        editor.graph,
        renderer?.ck,
        renderer ?? undefined,
        state.currentPageId
      )
    } catch (error) {
      if (
        !(error instanceof WebAssembly.RuntimeError) ||
        !/Aborted\(|out of memory|memory access out of bounds/i.test(error.message)
      )
        throw error
      renderingFailed = true
      console.warn(
        '[Save] CanvasKit failed; preserving editable FIG data without a new preview',
        error
      )
      return buildRendererIndependentFigFile(version)
    }
  }

  function buildRendererIndependentFigFile(version: number) {
    rendererIndependentVersion = version
    return buildRecoveryFigFile()
  }

  function buildRecoveryFigFile() {
    return exportFigFile(editor.graph, undefined, undefined, state.currentPageId, false, {
      rendering: 'none'
    })
  }

  const recovery = createDocumentRecovery({
    state,
    isEnabled: () => recoveryEnabled.value,
    buildFigFile: buildRecoveryFigFile,
    hasWritableSource: () => !!getFileHandle() || !!getFilePath() || !!getStorageBinding()
  })

  async function markProtectedVersion(version: number) {
    if (rendererIndependentVersion === version) {
      rendererIndependentVersion = null
      toast.warning(notificationMessages.get().savedWithoutPreview)
    }
    await recovery.markProtectedVersion(version)
  }

  const { saveFigFile, saveFigFileAs, writeFile } = createSaveActions({
    state,
    buildFigFile,
    getFilePath,
    setFilePath,
    getFileHandle,
    setFileHandle,
    getDownloadName,
    setDownloadName,
    getStorageBinding,
    setStorageBinding,
    setSourceIdentity,
    setSavedVersion,
    setLastWriteTime,
    startWatchingFile: () => {
      void startWatchingFile()
    },
    onWriteSuccess: markProtectedVersion,
    onDownloadSuccess: markProtectedVersion
  })

  const autosave = createAutosave({
    state,
    getSavedVersion,
    hasWritableSource: () => !!getFileHandle() || !!getFilePath() || !!getStorageBinding(),
    saveCurrentDocument: async (version) => {
      const revision = changes.capture()
      const data = await buildFigFile()
      if (await writeFile(data, version)) changes.markSaved(revision)
    }
  })

  function setDocumentSource(
    fileName: string,
    sourceFormat: string,
    handle?: FileSystemFileHandle,
    path?: string
  ) {
    stopWatchingFile()
    setStorageBinding(null)
    const isFig = sourceFormat === 'fig'
    setFileHandle(isFig ? (handle ?? null) : null)
    setFilePath(isFig ? (path ?? null) : null)
    setDownloadName(figDownloadName(fileName, sourceFormat))
    setSourceIdentity({ handle: handle ?? null, path: path ?? null })
    setSavedVersion(state.sceneVersion)
    changes.markSaved()
    void recovery.markProtectedVersion(state.sceneVersion)
    if (isFig && (handle || path)) {
      void startWatchingFile()
    }
  }

  function setStorageDocumentSource(binding: StorageDocumentBinding, documentName: string) {
    stopWatchingFile()
    setFileHandle(null)
    setFilePath(null)
    setDownloadName(`${documentName}.fig`)
    setSourceIdentity({ handle: null, path: null })
    setStorageBinding(binding)
    state.documentName = documentName
    state.autosaveEnabled = true
    setSavedVersion(state.sceneVersion)
    changes.markSaved()
    void recovery.markProtectedVersion(state.sceneVersion)
  }

  function setPlannedFilePath(path: string) {
    stopWatchingFile()
    setStorageBinding(null)
    setFileHandle(null)
    setFilePath(path)
    const downloadName = downloadNameFromPath(path)
    setDownloadName(downloadName)
    state.documentName = documentNameFromFigPath(downloadName)
  }

  /** Save to a new path; when the write fails, the document keeps the source it had. */
  async function saveFigFileToPath(path: string): Promise<boolean> {
    const previous = {
      filePath: getFilePath(),
      fileHandle: getFileHandle(),
      storageBinding: getStorageBinding(),
      downloadName: getDownloadName(),
      documentName: state.documentName
    }
    const restore = () => {
      setStorageBinding(previous.storageBinding)
      setFileHandle(previous.fileHandle)
      setFilePath(previous.filePath)
      setDownloadName(previous.downloadName)
      state.documentName = previous.documentName
      if (previous.filePath || previous.fileHandle) void startWatchingFile()
    }
    setPlannedFilePath(path)
    try {
      const saved = await saveAndTrack(saveFigFile)
      if (saved) void startWatchingFile()
      else restore()
      return saved
    } catch (error) {
      restore()
      throw error
    }
  }

  function startWatchingCurrentFile() {
    void startWatchingFile()
  }

  function disposeDocumentIO() {
    changes.dispose()
    stopWatchingFile()
    autosave.disposeAutosave()
    recovery.disposeRecovery()
  }

  return {
    setDocumentSource,
    setStorageDocumentSource,
    setPlannedFilePath,
    saveFigFileToPath,
    startWatchingCurrentFile,
    disposeDocumentIO,
    saveFigFile: () => saveAndTrack(saveFigFile),
    saveFigFileAs: () => saveAndTrack(saveFigFileAs),
    hasUnsavedChanges: changes.hasUnsavedChanges,
    markDocumentSaved: changes.markSaved,
    getStorageBinding,
    getRecoveryId: () => recovery.getRecoveryId(),
    adoptRecoverySnapshot: (id: string, version: number) => {
      changes.markChanged()
      return recovery.adoptRecoverySnapshot(id, version)
    },
    persistRecoveryNow: () => recovery.persistNow(),
    discardRecovery: () => recovery.discardRecovery()
  }
}
